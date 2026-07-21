import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
} from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

export type CodexRequestId = string | number;

export type CodexIncomingMessage =
  | { id: CodexRequestId; result: unknown }
  | {
      id: CodexRequestId;
      error: { code: number; message: string; data?: unknown };
    }
  | { method: string; params?: unknown; id?: CodexRequestId };

type SpawnCodex = (
  executablePath: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequestId(value: unknown): value is CodexRequestId {
  return typeof value === 'number' || typeof value === 'string';
}

const STOP_GRACE_MS = 1_000;
const STOP_FORCE_MS = 1_000;

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private lineReader: Interface | null = null;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly listeners = new Set<
    (message: CodexIncomingMessage) => void
  >();
  private nextRequestId = 1;
  private initialized = false;
  private stoppingChild: ChildProcessWithoutNullStreams | null = null;
  private stopPromise: Promise<void> | null = null;
  private readonly exitedChildren = new WeakSet<ChildProcessWithoutNullStreams>();
  private readonly reapingChildren = new WeakMap<
    ChildProcessWithoutNullStreams,
    Promise<void>
  >();
  private readonly cleanupOperations = new Set<Promise<void>>();
  private status: { running: boolean; error: string | null } = {
    running: false,
    error: null,
  };

  constructor(
    private readonly spawnCodex: SpawnCodex = (
      executablePath,
      args,
      options,
    ) =>
      spawn(
        executablePath,
        args,
        options,
      ) as ChildProcessWithoutNullStreams,
  ) {}

  async start(executablePath: string, cwd: string): Promise<void> {
    if (this.process) {
      throw new Error('Codex app-server is already running');
    }
    if (this.cleanupOperations.size > 0) {
      await Promise.all(this.cleanupOperations);
    }
    if (this.process) {
      throw new Error('Codex app-server is already running');
    }

    this.initialized = false;
    this.nextRequestId = 1;
    this.status = { running: true, error: null };

    let childProcess: ChildProcessWithoutNullStreams | null = null;
    try {
      const spawned = this.spawnCodex(executablePath, ['app-server'], {
        cwd,
        shell: false,
        stdio: 'pipe',
      });
      childProcess = spawned;
      this.process = spawned;
      this.lineReader = createInterface({ input: spawned.stdout });
      this.lineReader.on('line', (line) =>
        this.handleLine(spawned, line),
      );
      spawned.stdin.on('error', (error) =>
        this.handleStdinError(spawned, error),
      );
      spawned.once('error', (error) =>
        this.handleProcessError(spawned, error),
      );
      spawned.once('exit', (code, signal) =>
        this.handleProcessExit(spawned, code, signal),
      );
      spawned.once('close', (code, signal) =>
        this.handleProcessExit(spawned, code, signal),
      );

      await this.sendRequest('initialize', {
        clientInfo: {
          name: 'agentic_worktrees',
          title: 'Agentic Worktrees',
          version: '1.0.0',
        },
      });
      this.writeMessage({ method: 'initialized', params: {} });
      this.initialized = true;
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error(errorMessage(error));
      if (childProcess && this.process === childProcess) {
        this.finalize(childProcess, failure, true);
        await this.reapChild(childProcess);
      } else if (childProcess) {
        await this.reapChild(childProcess);
      } else if (!childProcess) {
        this.status = { running: false, error: failure.message };
        this.initialized = false;
      }
      throw failure;
    }
  }

  request<Result>(method: string, params: unknown): Promise<Result> {
    if (!this.initialized) {
      return Promise.reject(new Error('Codex app-server is not initialized'));
    }

    return this.sendRequest<Result>(method, params);
  }

  notify(method: string, params: unknown): void {
    this.writeMessage({ method, params });
  }

  respond(id: CodexRequestId, result: unknown): void {
    this.writeMessage({ id, result });
  }

  subscribe(listener: (message: CodexIncomingMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): { running: boolean; error: string | null } {
    return { ...this.status };
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    const childProcess = this.process;
    if (!childProcess) {
      if (this.cleanupOperations.size > 0) {
        await Promise.all(this.cleanupOperations);
      }
      return;
    }

    this.stoppingChild = childProcess;
    this.initialized = false;
    const operation = this.stopChild(childProcess);
    const tracked = operation.finally(() => {
      if (this.stopPromise === tracked) {
        this.stopPromise = null;
      }
    });
    this.stopPromise = tracked;
    return tracked;
  }

  private sendRequest<Result>(method: string, params: unknown): Promise<Result> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<Result>((resolve, reject) => {
      this.pendingRequests.set(id, {
        method,
        resolve: (result) => resolve(result as Result),
        reject,
      });

      try {
        this.writeMessage({ id, method, params });
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private writeMessage(message: Record<string, unknown>): void {
    const childProcess = this.process;
    if (!childProcess || !this.status.running) {
      throw new Error('Codex app-server is not running');
    }

    try {
      childProcess.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          this.handleStdinError(childProcess, error);
        }
      });
    } catch (error) {
      const failure = new Error(
        `Codex app-server stdin: ${errorMessage(error)}`,
      );
      this.finalize(childProcess, failure, true);
      throw failure;
    }
  }

  private handleLine(
    childProcess: ChildProcessWithoutNullStreams,
    line: string,
  ): void {
    if (this.process !== childProcess) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      this.failProtocol(childProcess, `invalid JSON: ${errorMessage(error)}`);
      return;
    }

    if (!isRecord(parsed)) {
      this.failProtocol(childProcess, 'message is not an object');
      return;
    }

    if (isRequestId(parsed.id) && typeof parsed.method !== 'string') {
      const hasResult = Object.prototype.hasOwnProperty.call(parsed, 'result');
      const hasError = Object.prototype.hasOwnProperty.call(parsed, 'error');
      if (hasResult === hasError) {
        this.failProtocol(childProcess, 'invalid response envelope');
        return;
      }

      if (
        hasError &&
        (!isRecord(parsed.error) ||
          typeof parsed.error.code !== 'number' ||
          typeof parsed.error.message !== 'string')
      ) {
        this.failProtocol(childProcess, 'invalid error response');
        return;
      }

      if (typeof parsed.id !== 'number') {
        return;
      }
      const pending = this.pendingRequests.get(parsed.id);
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(parsed.id);
      if (hasError && isRecord(parsed.error)) {
        pending.reject(new Error(`${pending.method}: ${parsed.error.message}`));
      } else {
        pending.resolve(parsed.result);
      }
      return;
    }

    if (typeof parsed.method === 'string') {
      if (
        ('id' in parsed && !isRequestId(parsed.id)) ||
        'result' in parsed ||
        'error' in parsed
      ) {
        this.failProtocol(childProcess, 'invalid method envelope');
        return;
      }

      const message: CodexIncomingMessage = {
        method: parsed.method,
        ...('params' in parsed ? { params: parsed.params } : {}),
        ...(isRequestId(parsed.id) ? { id: parsed.id } : {}),
      };
      for (const listener of this.listeners) {
        listener(message);
      }
      return;
    }

    this.failProtocol(childProcess, 'unsupported message envelope');
  }

  private handleStdinError(
    childProcess: ChildProcessWithoutNullStreams,
    error: Error,
  ): void {
    if (this.stoppingChild === childProcess) {
      this.finalize(childProcess, null, false);
      return;
    }

    this.finalize(
      childProcess,
      new Error(`Codex app-server stdin: ${error.message}`),
      true,
    );
  }

  private handleProcessError(
    childProcess: ChildProcessWithoutNullStreams,
    error: Error,
  ): void {
    const failure = this.stoppingChild === childProcess
      ? null
      : new Error(`Codex app-server error: ${error.message}`);
    this.finalize(childProcess, failure, true);
  }

  private handleProcessExit(
    childProcess: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    this.exitedChildren.add(childProcess);
    const detail = code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`;
    const failure = this.stoppingChild === childProcess
      ? null
      : new Error(`Codex app-server exited with ${detail}`);
    this.finalize(childProcess, failure, false);
  }

  private failProtocol(
    childProcess: ChildProcessWithoutNullStreams,
    detail: string,
  ): void {
    this.finalize(
      childProcess,
      new Error(`Codex app-server protocol error: ${detail}`),
      true,
    );
  }

  private finalize(
    childProcess: ChildProcessWithoutNullStreams,
    failure: Error | null,
    terminateChild: boolean,
  ): void {
    if (this.process !== childProcess) {
      return;
    }

    this.lineReader?.close();
    this.lineReader = null;
    this.process = null;
    this.initialized = false;
    this.status = { running: false, error: failure?.message ?? null };
    if (this.stoppingChild === childProcess) {
      this.stoppingChild = null;
    }
    this.rejectPending(failure ?? new Error('Codex app-server stopped'));

    if (terminateChild) {
      void this.reapChild(childProcess);
    } else {
      this.closePipes(childProcess);
    }
  }

  private async stopChild(
    childProcess: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    await this.reapChild(childProcess);

    if (this.process === childProcess) {
      this.finalize(childProcess, null, false);
    }
  }

  private reapChild(
    childProcess: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    const existing = this.reapingChildren.get(childProcess);
    if (existing) {
      return existing;
    }

    const operation = this.performChildReap(childProcess);
    this.reapingChildren.set(childProcess, operation);
    this.cleanupOperations.add(operation);
    void operation.then(
      () => this.cleanupOperations.delete(operation),
      () => this.cleanupOperations.delete(operation),
    );
    return operation;
  }

  private async performChildReap(
    childProcess: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    try {
      if (this.exitedChildren.has(childProcess)) {
        return;
      }

      const gracefulExit = this.waitForExit(childProcess, STOP_GRACE_MS);
      this.safeKill(childProcess, 'SIGTERM');
      if (await gracefulExit) {
        return;
      }

      const forcedExit = this.waitForExit(childProcess, STOP_FORCE_MS);
      this.safeKill(childProcess, 'SIGKILL');
      await forcedExit;
    } finally {
      this.closePipes(childProcess);
    }
  }

  private waitForExit(
    childProcess: ChildProcessWithoutNullStreams,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (exited: boolean) => {
        childProcess.removeListener('exit', handleExit);
        childProcess.removeListener('close', handleExit);
        clearTimeout(timer);
        resolve(exited);
      };
      const handleExit = () => finish(true);
      childProcess.once('exit', handleExit);
      childProcess.once('close', handleExit);
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  private closePipes(childProcess: ChildProcessWithoutNullStreams): void {
    childProcess.stdin.destroy();
    childProcess.stdout.destroy();
    childProcess.stderr.destroy();
  }

  private safeKill(
    childProcess: ChildProcessWithoutNullStreams,
    signal: NodeJS.Signals,
  ): boolean {
    try {
      return childProcess.kill(signal);
    } catch {
      return false;
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
