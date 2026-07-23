import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import {
  CodexAppServerClient,
  type CodexIncomingMessage,
  type CodexRequestId,
} from './codex-app-server-client';
import {
  readCodexApprovalRequest,
  readCodexDiffs,
  readCodexMessages,
  readCodexModels,
  readCodexNotification,
  readCodexThread,
  readCodexThreadId,
  readCodexTurnId,
  type CodexApprovalRequest,
  type CodexThreadSnapshot,
} from './codex-protocol';
import type {
  CodingAgentAdapter,
  CodingAgentDiff,
  CodingAgentEvent,
  CodingAgentMessage,
  CodingAgentModel,
  CodingAgentPermission,
  CodingAgentSessionOptions,
} from './types';

const execFile = promisify(execFileCallback);

type CodexClient = Pick<
  CodexAppServerClient,
  'getStatus' | 'request' | 'respond' | 'start' | 'stop' | 'subscribe'
>;

type ReadCodexVersion = (executablePath: string) => Promise<string>;

interface PendingApproval {
  directory: string;
  request: CodexApprovalRequest;
}

const readVersionFromExecutable: ReadCodexVersion = async (executablePath) => {
  const { stdout } = await execFile(executablePath, ['--version'], {
    timeout: 5_000,
    windowsHide: true,
  });
  const version = stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0];
  if (!version) {
    throw new Error('Codex returned an invalid version string.');
  }
  return version;
};

const approvalDecision = (
  response: 'once' | 'always' | 'reject',
): 'accept' | 'acceptForSession' | 'decline' => {
  if (response === 'once') return 'accept';
  if (response === 'always') return 'acceptForSession';
  return 'decline';
};

const threadStatus = (
  thread: CodexThreadSnapshot,
): 'idle' | 'busy' | 'error' => {
  if (thread.status.type === 'active') return 'busy';
  if (thread.status.type === 'systemError') return 'error';
  return 'idle';
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class CodexAdapter implements CodingAgentAdapter {
  private version: string | null = null;
  private readonly listeners = new Set<(event: CodingAgentEvent) => void>();
  private readonly threadSnapshots = new Map<string, CodexThreadSnapshot>();
  private readonly directoryByThread = new Map<string, string>();
  private readonly activeTurnByThread = new Map<string, string>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(
    private readonly client: CodexClient = new CodexAppServerClient(),
    private readonly readVersion: ReadCodexVersion = readVersionFromExecutable,
  ) {
    this.client.subscribe((message) => this.handleIncomingMessage(message));
  }

  getStatus(): {
    running: boolean;
    version: string | null;
    error: string | null;
  } {
    return { ...this.client.getStatus(), version: this.version };
  }

  async start(executablePath: string, cwd: string): Promise<string> {
    if (this.client.getStatus().running && this.version) return this.version;
    const version = await this.readVersion(executablePath);
    await this.client.start(executablePath, cwd);
    this.version = version;
    return version;
  }

  async stop(): Promise<void> {
    await this.client.stop();
    this.threadSnapshots.clear();
    this.directoryByThread.clear();
    this.activeTurnByThread.clear();
    this.pendingApprovals.clear();
  }

  async listModels(directory: string): Promise<CodingAgentModel[]> {
    void directory;
    const result = await this.client.request<unknown>('model/list', {});
    return readCodexModels(result);
  }

  async createSession(
    directory: string,
    title: string,
    options: CodingAgentSessionOptions,
  ): Promise<{ id: string }> {
    const result = await this.client.request<unknown>('thread/start', {
      model: options.modelId,
      cwd: directory,
      sandbox: 'workspace-write',
      approvalPolicy: 'untrusted',
      ephemeral: false,
    });
    const threadId = readCodexThreadId(result);
    if (!threadId) throw new Error('Codex returned a thread without an ID.');

    this.directoryByThread.set(threadId, directory);
    await this.client.request<unknown>('thread/name/set', {
      threadId,
      name: title,
    });
    return { id: threadId };
  }

  async getSession(
    directory: string,
    sessionId: string,
  ): Promise<{ id: string; status: 'idle' | 'busy' | 'error' }> {
    this.directoryByThread.set(sessionId, directory);
    const resumed = await this.client.request<unknown>('thread/resume', {
      threadId: sessionId,
      cwd: directory,
    });
    const resumedThreadId = readCodexThreadId(resumed);
    if (resumedThreadId !== sessionId) {
      throw new Error('Codex resumed an unexpected thread.');
    }

    const thread = await this.refreshThread(sessionId);
    return { id: thread.id, status: threadStatus(thread) };
  }

  async listMessages(
    directory: string,
    sessionId: string,
  ): Promise<CodingAgentMessage[]> {
    this.directoryByThread.set(sessionId, directory);
    return readCodexMessages(await this.refreshThread(sessionId));
  }

  async getDiff(
    directory: string,
    sessionId: string,
    messageId?: string,
  ): Promise<CodingAgentDiff[]> {
    this.directoryByThread.set(sessionId, directory);
    const projected = readCodexDiffs(await this.refreshThread(sessionId));
    return messageId ? projected.turn : projected.session;
  }

  async sendPrompt(
    directory: string,
    sessionId: string,
    input: {
      content: string;
      providerId: string;
      modelId: string;
      reasoningVariant?: string;
    },
  ): Promise<void> {
    if (input.providerId !== 'openai') {
      throw new Error(`Codex does not support provider ${input.providerId}.`);
    }
    this.directoryByThread.set(sessionId, directory);
    const result = await this.client.request<unknown>('turn/start', {
      threadId: sessionId,
      input: [
        { type: 'text', text: input.content, text_elements: [] },
      ],
      cwd: directory,
      model: input.modelId,
      ...(input.reasoningVariant ? { effort: input.reasoningVariant } : {}),
    });
    const turnId = readCodexTurnId(result);
    if (!turnId) throw new Error('Codex returned a turn without an ID.');
    this.activeTurnByThread.set(sessionId, turnId);
  }

  async abort(directory: string, sessionId: string): Promise<void> {
    this.directoryByThread.set(sessionId, directory);
    const turnId = this.activeTurnByThread.get(sessionId);
    if (!turnId) return;
    await this.client.request<unknown>('turn/interrupt', {
      threadId: sessionId,
      turnId,
    });
    this.activeTurnByThread.delete(sessionId);
  }

  async compact(): Promise<void> {
    throw new Error('Session compaction is only available for OpenCode.');
  }

  async getUsage(): Promise<never> {
    throw new Error('Session usage is only available for OpenCode.');
  }

  async respondPermission(
    directory: string,
    sessionId: string,
    permissionId: string,
    response: 'once' | 'always' | 'reject',
  ): Promise<void> {
    const pending = this.pendingApprovals.get(permissionId);
    if (!pending) {
      throw new Error(`Unknown Codex permission request: ${permissionId}`);
    }
    if (pending.request.params.threadId !== sessionId) {
      throw new Error('Codex permission request belongs to another thread.');
    }
    if (pending.directory && pending.directory !== directory) {
      throw new Error('Codex permission request belongs to another directory.');
    }

    if (pending.request.type === 'permissions') {
      const requested = pending.request.params.permissions;
      const permissions =
        response === 'reject'
          ? {}
          : {
              ...(requested.network
                ? { network: requested.network }
                : {}),
              ...(requested.fileSystem
                ? { fileSystem: requested.fileSystem }
                : {}),
            };
      this.client.respond(pending.request.requestId, {
        permissions,
        scope: response === 'always' ? 'session' : 'turn',
      });
    } else {
      this.client.respond(pending.request.requestId, {
        decision: approvalDecision(response),
      });
    }
    this.pendingApprovals.delete(permissionId);
  }

  subscribe(listener: (event: CodingAgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async refreshThread(threadId: string): Promise<CodexThreadSnapshot> {
    const result = await this.client.request<unknown>('thread/read', {
      threadId,
      includeTurns: true,
    });
    const thread = readCodexThread(result);
    if (thread.id !== threadId) {
      throw new Error('Codex read returned an unexpected thread.');
    }
    this.threadSnapshots.set(threadId, thread);
    const activeTurn = thread.turns.find((turn) => turn.status === 'inProgress');
    if (activeTurn) {
      this.activeTurnByThread.set(threadId, activeTurn.id);
    } else {
      this.activeTurnByThread.delete(threadId);
    }
    return thread;
  }

  private emit(event: CodingAgentEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private handleIncomingMessage(message: CodexIncomingMessage): void {
    if (!('method' in message)) return;

    if (message.id !== undefined) {
      this.handleServerRequest(message.method, message.id, message.params);
      return;
    }

    try {
      const notification = readCodexNotification(message.method, message.params);
      if (!notification) return;

      if (notification.type === 'messageDelta') {
        const { threadId, turnId, itemId, delta } = notification.params;
        this.emit({
          directory: this.directoryByThread.get(threadId) ?? '',
          sessionId: threadId,
          type: 'message.part.updated',
          properties: {
            part: {
              id: itemId,
              sessionID: threadId,
              messageID: turnId,
              type: notification.partType,
              text: delta,
            },
            delta,
          },
        });
        return;
      }

      const threadId = notification.params.threadId;
      const terminalTurnId =
        notification.type === 'turnCompleted'
          ? notification.params.turn.id
          : notification.params.turnId;
      const activeTurnId = this.activeTurnByThread.get(threadId);
      if (activeTurnId && activeTurnId !== terminalTurnId) {
        return;
      }
      if (activeTurnId === terminalTurnId) {
        this.activeTurnByThread.delete(threadId);
      }
      if (notification.type === 'turnCompleted') {
        if (notification.params.turn.status === 'failed') {
          this.emit({
            directory: this.directoryByThread.get(threadId) ?? '',
            sessionId: threadId,
            type: 'session.error',
            properties: {
              threadId,
              turnId: notification.params.turn.id,
              error:
                notification.params.turn.error?.message ??
                'Codex turn failed.',
            },
          });
        } else {
          this.emit({
            directory: this.directoryByThread.get(threadId) ?? '',
            sessionId: threadId,
            type: 'session.idle',
            properties: {
              threadId,
              turnId: notification.params.turn.id,
            },
          });
        }
      } else {
        this.emit({
          directory: this.directoryByThread.get(threadId) ?? '',
          sessionId: threadId,
          type: 'session.error',
          properties: {
            threadId,
            turnId: notification.params.turnId,
            error: notification.params.error.message,
          },
        });
      }
    } catch (error) {
      this.emitProtocolError(message.method, error);
    }
  }

  private handleServerRequest(
    method: string,
    requestId: CodexRequestId,
    params: unknown,
  ): void {
    try {
      const request = readCodexApprovalRequest(method, requestId, params);
      if (!request) {
        if (method.endsWith('/requestApproval')) {
          this.client.respond(requestId, { decision: 'decline' });
          this.emitProtocolError(method, new Error('Unsupported approval request'));
        }
        return;
      }

      const permissionId = String(requestId);
      const directory =
        this.directoryByThread.get(request.params.threadId) ?? '';
      this.pendingApprovals.set(permissionId, { directory, request });
      this.emit({
        directory,
        sessionId: request.params.threadId,
        type: 'permission.updated',
        properties: this.toPermission(permissionId, request),
      });
    } catch (error) {
      this.client.respond(requestId, { decision: 'decline' });
      this.emitProtocolError(method, error);
    }
  }

  private toPermission(
    permissionId: string,
    request: CodexApprovalRequest,
  ): CodingAgentPermission {
    const common = {
      id: permissionId,
      sessionId: request.params.threadId,
    };
    if (request.type === 'command') {
      return {
        ...common,
        title: request.params.reason ?? 'Codex wants to run a command',
        type: 'command',
        metadata: {
          command: request.params.command ?? null,
          cwd: request.params.cwd ?? null,
          turnId: request.params.turnId,
          itemId: request.params.itemId,
        },
      };
    }
    if (request.type === 'file') {
      return {
        ...common,
        title: request.params.reason ?? 'Codex wants to change files',
        type: 'file_change',
        metadata: {
          turnId: request.params.turnId,
          itemId: request.params.itemId,
        },
      };
    }
    return {
      ...common,
      title: request.params.reason ?? 'Codex requests additional permissions',
      type: 'permissions',
      metadata: {
        cwd: request.params.cwd,
        permissions: request.params.permissions,
        turnId: request.params.turnId,
        itemId: request.params.itemId,
      },
    };
  }

  private emitProtocolError(method: string, error: unknown): void {
    this.emit({
      directory: '',
      sessionId: null,
      type: 'server.event_error',
      properties: { method, error: errorMessage(error) },
    });
  }
}
