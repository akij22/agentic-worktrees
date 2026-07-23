import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  createOpencodeClient,
  type GlobalEvent,
  type Message,
  type Part,
  type SessionStatus,
} from '@opencode-ai/sdk';
import type {
  CodingAgentAdapter,
  CodingAgentDiff,
  CodingAgentEvent,
  CodingAgentMessage,
  CodingAgentModel,
  CodingAgentSessionUsage,
} from './types';
import { readOpenCodeSessionId, reserveLocalPort } from './opencode-utils';

const START_TIMEOUT_MS = 10_000;
const HEALTH_RETRY_MS = 150;
const INTERNAL_DONE_MESSAGE = "*Done. I'll confirm to the user.*";
const REASONING_VARIANT_IDS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const readReasoningVariants = (model: unknown): string[] => {
  if (!model || typeof model !== 'object' || !('variants' in model)) return [];
  const variants = model.variants;
  if (!variants || typeof variants !== 'object') return [];
  return Object.entries(variants)
    .filter(
      ([id, configuration]) =>
        REASONING_VARIANT_IDS.has(id) &&
        (!configuration ||
          typeof configuration !== 'object' ||
          !('disabled' in configuration) ||
          configuration.disabled !== true),
    )
    .map(([id]) => id);
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const removeInternalDoneMessage = (content: string): string =>
  content.replaceAll(INTERNAL_DONE_MESSAGE, '').trim();

export const toOpenCodeRunStatus = (
  status: SessionStatus | undefined,
): 'idle' | 'busy' => {
  // OpenCode's status endpoint lists active sessions only. An omitted session
  // has completed and must clear any busy state previously persisted by us.
  if (!status) return 'idle';
  return status.type === 'idle' ? 'idle' : 'busy';
};

type OpenCodeDiffPayload = {
  file?: unknown;
  path?: unknown;
  before?: unknown;
  after?: unknown;
  patch?: unknown;
  additions?: unknown;
  deletions?: unknown;
};

const readPatchContent = (patch: string): { before: string; after: string } => {
  const before: string[] = [];
  const after: string[] = [];

  for (const line of patch.replaceAll('\r\n', '\n').split('\n')) {
    if (
      line.startsWith('+++') ||
      line.startsWith('---') ||
      line.startsWith('@@') ||
      line.startsWith('\\ No newline at end of file')
    ) {
      continue;
    }
    if (line.startsWith('+')) {
      after.push(line.slice(1));
    } else if (line.startsWith('-')) {
      before.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      const content = line.slice(1);
      before.push(content);
      after.push(content);
    }
  }

  return { before: before.join('\n'), after: after.join('\n') };
};

const normalizeDiff = (value: unknown): CodingAgentDiff => {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenCode returned an invalid session diff.');
  }
  const diff = value as OpenCodeDiffPayload;
  const file =
    typeof diff.file === 'string'
      ? diff.file
      : typeof diff.path === 'string'
        ? diff.path
        : null;
  if (!file) throw new Error('OpenCode returned a session diff without a file path.');

  const patchContent =
    typeof diff.patch === 'string'
      ? readPatchContent(diff.patch)
      : { before: '', after: '' };
  return {
    file,
    before: typeof diff.before === 'string' ? diff.before : patchContent.before,
    after: typeof diff.after === 'string' ? diff.after : patchContent.after,
    additions: typeof diff.additions === 'number' ? diff.additions : 0,
    deletions: typeof diff.deletions === 'number' ? diff.deletions : 0,
  };
};

const toMessage = (info: Message, parts: Part[]): CodingAgentMessage => ({
  id: info.id,
  role: info.role,
  content: removeInternalDoneMessage(
    parts
      .filter(
        (part): part is Extract<Part, { type: 'text' }> => part.type === 'text',
      )
      .map((part) => part.text)
      .join(''),
  ),
  reasoning: removeInternalDoneMessage(
    parts
      .filter(
        (part): part is Extract<Part, { type: 'reasoning' }> =>
          part.type === 'reasoning',
      )
      .at(-1)?.text ?? '',
  ),
  createdAt: info.time.created,
  completedAt:
    info.role === 'assistant'
      ? info.time.completed ?? (info.finish ? info.time.created : null)
      : null,
});

export class OpenCodeAdapter implements CodingAgentAdapter {
  private process: ChildProcess | null = null;
  private client: ReturnType<typeof createOpencodeClient> | null = null;
  private baseUrl: string | null = null;
  private password: string | null = null;
  private version: string | null = null;
  private error: string | null = null;
  private eventAbortController: AbortController | null = null;
  private readonly listeners = new Set<(event: CodingAgentEvent) => void>();

  getStatus() {
    return {
      running: this.process !== null && this.process.exitCode === null,
      version: this.version,
      error: this.error,
    };
  }

  async start(executablePath: string, cwd: string): Promise<string> {
    if (this.process && this.process.exitCode === null && this.version) {
      return this.version;
    }

    const port = await reserveLocalPort();
    const password = randomBytes(32).toString('base64url');
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(
      executablePath,
      ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
      {
        cwd,
        env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    this.process = child;
    this.password = password;
    this.baseUrl = baseUrl;
    this.error = null;

    child.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim();
      if (line) console.info(`[opencode] ${line}`);
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim();
      if (line) console.info(`[opencode] ${line}`);
    });
    child.once('error', (error) => {
      this.error = error.message;
    });
    child.once('exit', (code, signal) => {
      if (this.process === child) {
        this.process = null;
        this.client = null;
        this.eventAbortController?.abort();
        this.error =
          code === 0 ? null : `OpenCode exited (${signal ?? `code ${code}`}).`;
        this.emit({
          directory: '',
          sessionId: null,
          type: 'server.exit',
          properties: { code, signal, error: this.error },
        });
      }
    });

    const authFetch = (request: Request): ReturnType<typeof fetch> => {
      const headers = new Headers(request.headers);
      headers.set(
        'Authorization',
        `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      );
      return fetch(new Request(request, { headers }));
    };

    this.client = createOpencodeClient({
      baseUrl,
      fetch: authFetch,
      throwOnError: true,
    });

    const startedAt = Date.now();
    let detectedVersion: string | null = null;
    while (Date.now() - startedAt < START_TIMEOUT_MS) {
      if (child.exitCode !== null) break;
      try {
        const response = await authFetch(new Request(`${baseUrl}/global/health`));
        if (response.ok) {
          const health = (await response.json()) as {
            healthy?: boolean;
            version?: string;
          };
          if (health.healthy && health.version) {
            detectedVersion = health.version;
            break;
          }
        }
      } catch {
        // The process may still be starting; retry until the bounded timeout.
      }
      await delay(HEALTH_RETRY_MS);
    }

    if (!detectedVersion) {
      await this.stop();
      throw new Error('OpenCode did not become healthy before the startup timeout.');
    }

    this.version = detectedVersion;
    this.startEventStream();
    return detectedVersion;
  }

  async stop(): Promise<void> {
    this.eventAbortController?.abort();
    this.eventAbortController = null;
    const child = this.process;
    this.process = null;
    this.client = null;
    this.baseUrl = null;
    this.password = null;
    if (!child || child.exitCode !== null) return;

    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      delay(2_000).then(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }),
    ]);
  }

  private requireClient(): ReturnType<typeof createOpencodeClient> {
    if (!this.client) throw new Error('OpenCode server is not running.');
    return this.client;
  }

  async listModels(directory: string): Promise<CodingAgentModel[]> {
    const result = await this.requireClient().provider.list({
      query: { directory },
      throwOnError: true,
    });
    const connected = new Set(result.data.connected);
    return result.data.all
      .filter((provider) => connected.has(provider.id))
      .flatMap((provider) =>
        Object.values(provider.models).map((model) => ({
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          modelName: model.name,
          reasoningVariants: readReasoningVariants(model),
          isDefault: false,
        })),
      )
      .sort((a, b) =>
        `${a.providerName}/${a.modelName}`.localeCompare(
          `${b.providerName}/${b.modelName}`,
        ),
      );
  }

  async createSession(directory: string, title: string) {
    const result = await this.requireClient().session.create({
      body: { title },
      query: { directory },
      throwOnError: true,
    });
    return { id: result.data.id };
  }

  async getSession(directory: string, sessionId: string) {
    const client = this.requireClient();
    const [sessionResult, statusesResult] = await Promise.all([
      client.session.get({
        path: { id: sessionId },
        query: { directory },
        throwOnError: true,
      }),
      client.session.status({
        query: { directory },
        throwOnError: true,
      }),
    ]);
    return {
      id: sessionResult.data.id,
      status: toOpenCodeRunStatus(statusesResult.data[sessionId]),
    };
  }

  async listMessages(
    directory: string,
    sessionId: string,
  ): Promise<CodingAgentMessage[]> {
    const result = await this.requireClient().session.messages({
      path: { id: sessionId },
      query: { directory },
      throwOnError: true,
    });
    return result.data.map(({ info, parts }) => toMessage(info, parts));
  }

  async getDiff(
    directory: string,
    sessionId: string,
    messageId?: string,
  ): Promise<CodingAgentDiff[]> {
    const result = await this.requireClient().session.diff({
      path: { id: sessionId },
      query: { directory, ...(messageId ? { messageID: messageId } : {}) },
      throwOnError: true,
    });
    return (result.data as unknown[]).map(normalizeDiff);
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
    await this.requireClient().session.promptAsync({
      path: { id: sessionId },
      query: { directory },
      body: {
        agent: 'build',
        model: {
          providerID: input.providerId,
          modelID: input.modelId,
          ...(input.reasoningVariant ? { variant: input.reasoningVariant } : {}),
        } as { providerID: string; modelID: string },
        parts: [{ type: 'text', text: input.content }],
      },
      throwOnError: true,
    });
  }

  async compact(
    directory: string,
    sessionId: string,
    input: { providerId: string; modelId: string },
  ): Promise<void> {
    await this.requireClient().session.summarize({
      path: { id: sessionId },
      query: { directory },
      body: {
        providerID: input.providerId,
        modelID: input.modelId,
      },
      throwOnError: true,
    });
  }

  async getUsage(
    directory: string,
    sessionId: string,
    input: { providerId: string; modelId: string },
  ): Promise<CodingAgentSessionUsage> {
    const client = this.requireClient();
    const [messagesResult, providersResult] = await Promise.all([
      client.session.messages({
        path: { id: sessionId },
        query: { directory },
        throwOnError: true,
      }),
      client.provider.list({ query: { directory }, throwOnError: true }),
    ]);
    const assistantMessages = messagesResult.data
      .map(({ info }) => info)
      .filter((message) => message.role === 'assistant');
    const latest = assistantMessages.at(-1);
    const contextTokens = latest
      ? latest.tokens.input +
        latest.tokens.output +
        latest.tokens.reasoning +
        latest.tokens.cache.read +
        latest.tokens.cache.write
      : 0;
    const provider = providersResult.data.all.find(
      (candidate) => candidate.id === input.providerId,
    );
    const contextWindow = provider?.models[input.modelId]?.limit.context ?? 0;
    if (contextWindow <= 0) {
      throw new Error('OpenCode did not report the selected model context window.');
    }
    return {
      contextTokens,
      contextWindow,
      contextPercentage: Math.min(100, (contextTokens / contextWindow) * 100),
      totalCost: assistantMessages.reduce(
        (total, message) => total + message.cost,
        0,
      ),
      providerId: input.providerId,
      modelId: input.modelId,
    };
  }

  async abort(directory: string, sessionId: string): Promise<void> {
    await this.requireClient().session.abort({
      path: { id: sessionId },
      query: { directory },
      throwOnError: true,
    });
  }

  async respondPermission(
    directory: string,
    sessionId: string,
    permissionId: string,
    response: 'once' | 'always' | 'reject',
  ): Promise<void> {
    await this.requireClient().postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      query: { directory },
      body: { response },
      throwOnError: true,
    });
  }

  subscribe(listener: (event: CodingAgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CodingAgentEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private startEventStream(): void {
    const client = this.requireClient();
    const controller = new AbortController();
    this.eventAbortController = controller;
    void (async () => {
      try {
        const events = await client.global.event({ signal: controller.signal });
        for await (const event of events.stream) {
          if (controller.signal.aborted) break;
          this.forwardGlobalEvent(event);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          this.error = error instanceof Error ? error.message : String(error);
          this.emit({
            directory: '',
            sessionId: null,
            type: 'server.event_error',
            properties: { error: this.error },
          });
        }
      }
    })();
  }

  private forwardGlobalEvent(event: GlobalEvent): void {
    this.emit({
      directory: event.directory,
      sessionId: readOpenCodeSessionId(event.payload.properties),
      type: event.payload.type,
      properties: event.payload.properties,
    });
  }
}
