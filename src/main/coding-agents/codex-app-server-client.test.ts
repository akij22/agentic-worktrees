import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from './codex-app-server-client';

interface JsonRpcMessage {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface FakeTransportOptions {
  exitOnKill?: boolean;
  killResult?: boolean;
}

function createFakeCodexTransport(options: FakeTransportOptions = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const process = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };
  const requests: JsonRpcMessage[] = [];
  const kills: (NodeJS.Signals | number | undefined)[] = [];
  let buffered = '';

  process.stdin = stdin;
  process.stdout = stdout;
  process.stderr = stderr;
  process.kill = (signal) => {
    kills.push(signal);
    if (options.exitOnKill !== false) {
      process.emit('exit', null, typeof signal === 'string' ? signal : null);
    }
    return options.killResult ?? true;
  };

  stdin.setEncoding('utf8');
  stdin.on('data', (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > 0) {
        requests.push(JSON.parse(line) as JsonRpcMessage);
      }
    }
  });

  return {
    process: process as unknown as ChildProcessWithoutNullStreams,
    stdin,
    stdout,
    stderr,
    kills,
    send(message: JsonRpcMessage) {
      stdout.write(`${JSON.stringify(message)}\n`);
    },
    sendRaw(line: string) {
      stdout.write(`${line}\n`);
    },
    takeRequest() {
      const request = requests.shift();
      if (!request) {
        throw new Error('Expected the client to write a JSON-RPC message');
      }
      return request;
    },
    exit(code: number | null) {
      process.emit('exit', code, null);
    },
    fail(error: Error) {
      process.emit('error', error);
    },
    failStdin(error: Error) {
      stdin.emit('error', error);
    },
  };
}

async function startFakeClient() {
  const transport = createFakeCodexTransport();
  const client = new CodexAppServerClient(() => transport.process);
  const started = client.start('/usr/local/bin/codex', '/repo');
  const initialize = transport.takeRequest();
  transport.send({ id: initialize.id, result: { userAgent: 'codex-test' } });
  await started;
  transport.takeRequest();
  return { client, transport };
}

describe('CodexAppServerClient', () => {
  it('initializes once before sending application requests', async () => {
    const transport = createFakeCodexTransport();
    const client = new CodexAppServerClient(() => transport.process);

    const started = client.start('/usr/local/bin/codex', '/repo');

    expect(transport.takeRequest()).toEqual({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'agentic_worktrees',
          title: 'Agentic Worktrees',
          version: '1.0.0',
        },
      },
    });
    transport.send({ id: 1, result: { userAgent: 'codex-test' } });
    await expect(started).resolves.toBeUndefined();
    expect(transport.takeRequest()).toEqual({ method: 'initialized', params: {} });
  });

  it('correlates responses and rejects JSON-RPC errors', async () => {
    const { client, transport } = await startFakeClient();
    const successful = client.request<{ models: string[] }>('model/list', {});
    const successfulRequest = transport.takeRequest();
    transport.send({ id: successfulRequest.id, result: { models: ['codex'] } });
    await expect(successful).resolves.toEqual({ models: ['codex'] });

    const pending = client.request('model/list', {});
    const request = transport.takeRequest();
    transport.send({
      id: request.id,
      error: { code: -32000, message: 'denied' },
    });
    await expect(pending).rejects.toThrow('model/list: denied');
  });

  it('forwards notifications and server requests', async () => {
    const { client, transport } = await startFakeClient();
    const events: unknown[] = [];
    client.subscribe((message) => events.push(message));

    transport.send({
      method: 'turn/completed',
      params: { threadId: 'thread-1' },
    });
    transport.send({
      method: 'item/fileChange/requestApproval',
      id: 9,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        startedAtMs: 1,
      },
    });

    expect(events).toEqual([
      { method: 'turn/completed', params: { threadId: 'thread-1' } },
      {
        method: 'item/fileChange/requestApproval',
        id: 9,
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'item-1',
          startedAtMs: 1,
        },
      },
    ]);
  });

  it('writes notifications and responses without request IDs', async () => {
    const { client, transport } = await startFakeClient();

    client.notify('thread/name/updated', { threadId: 'thread-1' });
    client.respond(9, { decision: 'accept' });

    expect(transport.takeRequest()).toEqual({
      method: 'thread/name/updated',
      params: { threadId: 'thread-1' },
    });
    expect(transport.takeRequest()).toEqual({
      id: 9,
      result: { decision: 'accept' },
    });
  });

  it('preserves string IDs when responding to server requests', async () => {
    const { client, transport } = await startFakeClient();
    client.subscribe((message) => {
      if ('method' in message && message.id === 'approval-9') {
        client.respond(message.id, { decision: 'accept' });
      }
    });

    transport.send({
      id: 'approval-9',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'command-1',
        startedAtMs: 1,
      },
    });

    expect(transport.takeRequest()).toEqual({
      id: 'approval-9',
      result: { decision: 'accept' },
    });
    expect(client.getStatus().running).toBe(true);
  });

  it('rejects every pending request when the process exits', async () => {
    const { client, transport } = await startFakeClient();
    const first = client.request('thread/read', { threadId: 'thread-1' });
    const second = client.request('model/list', {});

    transport.exit(1);

    await expect(first).rejects.toThrow('Codex app-server exited');
    await expect(second).rejects.toThrow('Codex app-server exited');
    expect(client.getStatus()).toEqual({
      running: false,
      error: 'Codex app-server exited with code 1',
    });
  });

  it('cleans up process errors during startup and permits restart', async () => {
    const first = createFakeCodexTransport();
    const second = createFakeCodexTransport();
    const transports = [first, second];
    const client = new CodexAppServerClient(() => {
      const transport = transports.shift();
      if (!transport) {
        throw new Error('No fake transport available');
      }
      return transport.process;
    });
    const firstStart = client.start('/usr/local/bin/codex', '/repo');
    first.takeRequest();

    first.fail(new Error('spawn failed'));

    await expect(firstStart).rejects.toThrow('spawn failed');
    expect(first.kills).toContain('SIGTERM');
    expect(first.stdout.listenerCount('data')).toBe(0);

    const secondStart = client.start('/usr/local/bin/codex', '/repo');
    const initialize = second.takeRequest();
    second.send({ id: initialize.id, result: {} });
    await expect(secondStart).resolves.toBeUndefined();
  });

  it('terminates and cleans up a child when initialization is rejected', async () => {
    const transport = createFakeCodexTransport();
    const client = new CodexAppServerClient(() => transport.process);
    const started = client.start('/usr/local/bin/codex', '/repo');
    const initialize = transport.takeRequest();

    transport.send({
      id: initialize.id,
      error: { code: -32000, message: 'unsupported client' },
    });

    await expect(started).rejects.toThrow('initialize: unsupported client');
    expect(client.getStatus()).toEqual({
      running: false,
      error: 'initialize: unsupported client',
    });
    expect(transport.kills).toContain('SIGTERM');
    expect(transport.stdout.listenerCount('data')).toBe(0);
  });

  it('reaps an initialization-failed child that accepts signals but never exits', async () => {
    vi.useFakeTimers();
    try {
      const first = createFakeCodexTransport({ exitOnKill: false });
      const second = createFakeCodexTransport();
      const transports = [first, second];
      const client = new CodexAppServerClient(() => {
        const transport = transports.shift();
        if (!transport) {
          throw new Error('No fake transport available');
        }
        return transport.process;
      });
      const started = client.start('/usr/local/bin/codex', '/repo');
      const rejected = expect(started).rejects.toThrow(
        'initialize: unsupported client',
      );
      const initialize = first.takeRequest();

      first.send({
        id: initialize.id,
        error: { code: -32000, message: 'unsupported client' },
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(first.kills).toEqual(['SIGTERM']);
      expect(client.getStatus()).toEqual({
        running: false,
        error: 'initialize: unsupported client',
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(first.kills).toEqual(['SIGTERM', 'SIGKILL']);
      await vi.advanceTimersByTimeAsync(1_000);
      await rejected;
      expect(first.stdin.destroyed).toBe(true);
      expect(first.stdout.destroyed).toBe(true);
      expect(first.stderr.destroyed).toBe(true);

      const restarted = client.start('/usr/local/bin/codex', '/repo');
      const secondInitialize = second.takeRequest();
      second.send({ id: secondInitialize.id, result: {} });
      await expect(restarted).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles asynchronous stdin errors without hanging requests', async () => {
    const { client, transport } = await startFakeClient();
    const pending = client.request('thread/read', { threadId: 'thread-1' });
    transport.takeRequest();
    const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });

    expect(() => transport.failStdin(epipe)).not.toThrow();

    await expect(pending).rejects.toThrow('Codex app-server stdin: write EPIPE');
    expect(client.getStatus()).toEqual({
      running: false,
      error: 'Codex app-server stdin: write EPIPE',
    });
    expect(transport.kills).toContain('SIGTERM');
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['an unsupported envelope', JSON.stringify({ unexpected: true })],
  ])('treats %s as a fatal protocol error', async (_name, line) => {
    const { client, transport } = await startFakeClient();
    const pending = client.request('thread/read', { threadId: 'thread-1' });
    transport.takeRequest();

    transport.sendRaw(line);

    expect(client.getStatus().running).toBe(false);
    await expect(pending).rejects.toThrow('Codex app-server protocol error');
    expect(transport.kills).toContain('SIGTERM');
  });

  it('bounds stop and escalates to SIGKILL when SIGTERM is ignored', async () => {
    vi.useFakeTimers();
    try {
      const transport = createFakeCodexTransport({
        exitOnKill: false,
        killResult: false,
      });
      const client = new CodexAppServerClient(() => transport.process);
      const started = client.start('/usr/local/bin/codex', '/repo');
      const initialize = transport.takeRequest();
      transport.send({ id: initialize.id, result: {} });
      await started;
      transport.takeRequest();

      const stopped = client.stop();
      expect(transport.kills).toEqual(['SIGTERM']);

      await vi.runAllTimersAsync();
      await expect(stopped).resolves.toBeUndefined();
      expect(transport.kills).toEqual(['SIGTERM', 'SIGKILL']);
      expect(client.getStatus()).toEqual({ running: false, error: null });
    } finally {
      vi.useRealTimers();
    }
  });
});
