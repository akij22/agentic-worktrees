import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  CodingAgentDiffDto,
  CodingAgentModelDto,
  CodingAgentSessionDto,
  CodingAgentSessionSnapshotDto,
  CodingAgentStatusDto,
  CodingAgentUiEventDto,
  CodingAgentWorktreeContextDto,
} from '../../shared/ipc/schemas';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';

type PendingPermission = {
  id: string;
  title: string;
  type: string;
  metadata: Record<string, unknown>;
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const readPermission = (payload: unknown): PendingPermission | null => {
  if (!payload || typeof payload !== 'object') return null;
  if (!('id' in payload) || typeof payload.id !== 'string') return null;
  return {
    id: payload.id,
    title:
      'title' in payload && typeof payload.title === 'string'
        ? payload.title
        : 'OpenCode requests permission',
    type:
      'type' in payload && typeof payload.type === 'string'
        ? payload.type
        : 'operation',
    metadata:
      'metadata' in payload &&
      payload.metadata &&
      typeof payload.metadata === 'object'
        ? (payload.metadata as Record<string, unknown>)
        : {},
  };
};

const readToolActivity = (event: CodingAgentUiEventDto): string | null => {
  if (event.type !== 'message.part.updated') return null;
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || !('part' in payload)) return null;
  const part = payload.part;
  if (!part || typeof part !== 'object' || !('type' in part) || part.type !== 'tool') {
    if (
      part &&
      typeof part === 'object' &&
      'type' in part &&
      part.type === 'reasoning'
    ) {
      const delta =
        'delta' in payload && typeof payload.delta === 'string'
          ? payload.delta
          : 'text' in part && typeof part.text === 'string'
            ? part.text
            : '';
      return delta ? `Thinking… ${delta}` : 'Thinking…';
    }
    return null;
  }
  const tool = 'tool' in part && typeof part.tool === 'string' ? part.tool : 'tool';
  const state =
    'state' in part && part.state && typeof part.state === 'object' &&
    'status' in part.state && typeof part.state.status === 'string'
      ? part.state.status
      : 'running';
  return `${tool} · ${state}`;
};

const NewSessionDialog = ({
  open,
  contexts,
  initialWorktreeId,
  onClose,
}: {
  open: boolean;
  contexts: CodingAgentWorktreeContextDto[];
  initialWorktreeId?: string;
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const [worktreeId, setWorktreeId] = useState(initialWorktreeId ?? '');
  const [title, setTitle] = useState('New coding session');
  const [models, setModels] = useState<CodingAgentModelDto[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) setWorktreeId(initialWorktreeId ?? contexts[0]?.worktree.id ?? '');
  }, [contexts, initialWorktreeId, open]);

  useEffect(() => {
    if (!open || !worktreeId) {
      setModels([]);
      setModelKey('');
      return;
    }
    setLoadingModels(true);
    setError(undefined);
    void window.api.codingAgent
      .listModels({ worktreeId })
      .then((nextModels) => {
        setModels(nextModels);
        const first = nextModels[0];
        setModelKey(first ? `${first.providerId}::${first.modelId}` : '');
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setLoadingModels(false));
  }, [open, worktreeId]);

  if (!open) return null;

  const create = async () => {
    const model = models.find(
      (candidate) => `${candidate.providerId}::${candidate.modelId}` === modelKey,
    );
    if (!model || !worktreeId || !title.trim()) return;
    setCreating(true);
    setError(undefined);
    try {
      const session = await window.api.codingAgent.createSession({
        worktreeId,
        title: title.trim(),
        providerId: model.providerId,
        modelId: model.modelId,
      });
      navigate(`/coding-agent/${worktreeId}/${session.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCreating(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogHeader>
        <DialogTitle>New coding session</DialogTitle>
        <DialogDescription>
          Select the worktree and one of the models connected in OpenCode.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="agent-worktree">Worktree</Label>
          <Select
            id="agent-worktree"
            value={worktreeId}
            onChange={(event) => setWorktreeId(event.target.value)}
          >
            {contexts.map(({ worktree, repository }) => (
              <option key={worktree.id} value={worktree.id}>
                {repository.fullName} · {worktree.name} ({worktree.branchName})
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-model">Model</Label>
          <Select
            id="agent-model"
            value={modelKey}
            onChange={(event) => setModelKey(event.target.value)}
            disabled={loadingModels || models.length === 0}
          >
            {loadingModels ? <option>Loading models…</option> : null}
            {!loadingModels && models.length === 0 ? (
              <option value="">No connected models</option>
            ) : null}
            {models.map((model) => (
              <option
                key={`${model.providerId}:${model.modelId}`}
                value={`${model.providerId}::${model.modelId}`}
              >
                {model.providerName} · {model.modelName}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-title">Session title</Label>
          <Input
            id="agent-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={creating}>
          Cancel
        </Button>
        <Button
          onClick={() => void create()}
          disabled={creating || !worktreeId || !modelKey || !title.trim()}
        >
          {creating ? 'Creating…' : 'Create chat'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

const CodingAgentLanding = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CodingAgentStatusDto>();
  const [contexts, setContexts] = useState<CodingAgentWorktreeContextDto[]>([]);
  const [sessions, setSessions] = useState<CodingAgentSessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const requestedWorktreeId = searchParams.get('worktreeId') ?? undefined;
  const [dialogOpen, setDialogOpen] = useState(searchParams.get('new') === '1');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, nextContexts, nextSessions] = await Promise.all([
        window.api.codingAgent.getStatus(),
        window.api.codingAgent.listWorktrees(),
        window.api.codingAgent.listSessions(),
      ]);
      setStatus(nextStatus);
      setContexts(nextContexts);
      setSessions(nextSessions);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const contextByWorktree = useMemo(
    () => new Map(contexts.map((context) => [context.worktree.id, context])),
    [contexts],
  );

  if (loading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (!status?.configured) {
    return (
      <div className="mx-auto grid min-h-[32rem] max-w-2xl place-items-center text-center">
        <div>
          <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-dashed border-border bg-muted/30 font-mono text-xl">
            &gt;_
          </div>
          <h2 className="text-xl font-semibold">Configure OpenCode first</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Select your local OpenCode executable. Provider credentials remain in
            OpenCode and are never exposed to this renderer.
          </p>
          <Button className="mt-5" onClick={() => navigate('/settings')}>
            Open Settings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            OpenCode · {status.version}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Coding sessions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Persistent conversations, each isolated to one Git worktree.
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={contexts.length === 0}
        >
          + New chat
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
          <h3 className="text-sm font-semibold">No coding sessions yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a chat and assign it to one of your worktrees.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {sessions.map((session) => {
            const context = contextByWorktree.get(session.worktreeId);
            return (
              <button
                key={session.id}
                type="button"
                onClick={() =>
                  navigate(`/coding-agent/${session.worktreeId}/${session.id}`)
                }
                className="group rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{session.title}</h3>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {context?.repository.fullName ?? 'Unavailable repository'} ·{' '}
                      {context?.worktree.branchName ?? 'missing worktree'}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {session.status.replace('_', ' ')}
                  </Badge>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">{session.providerId}/{session.modelId}</span>
                  <span>{formatDate(session.updatedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <NewSessionDialog
        open={dialogOpen}
        contexts={contexts}
        initialWorktreeId={requestedWorktreeId}
        onClose={() => {
          setDialogOpen(false);
          setSearchParams({});
        }}
      />
    </div>
  );
};

const CodingAgentSession = ({ runId }: { runId: string }) => {
  const [snapshot, setSnapshot] = useState<CodingAgentSessionSnapshotDto>();
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [permission, setPermission] = useState<PendingPermission>();
  const [activity, setActivity] = useState<string>();
  const [selectedFile, setSelectedFile] = useState<string>();

  const load = useCallback(async () => {
    try {
      const next = await window.api.codingAgent.getSession({ runId });
      setSnapshot(next);
      setSelectedFile((current) =>
        current && next.diff.some((file) => file.file === current)
          ? current
          : next.diff[0]?.file,
      );
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      setSending(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
    return window.api.codingAgent.onEvent((event) => {
      if (event.runId === null && event.type === 'server.exit') {
        const serverMessage =
          typeof event.payload === 'object' &&
          event.payload !== null &&
          'message' in event.payload &&
          typeof event.payload.message === 'string'
            ? event.payload.message
            : undefined;
        setError(
          serverMessage ?? 'The OpenCode server stopped unexpectedly.',
        );
        void load();
        return;
      }
      if (event.runId !== runId) return;
      const nextActivity = readToolActivity(event);
      if (nextActivity) setActivity(nextActivity);
      if (event.type === 'permission.updated') {
        const nextPermission = readPermission(event.payload);
        if (nextPermission) setPermission(nextPermission);
      }
      if (
        event.type === 'messages.updated' ||
        event.type === 'session.diff' ||
        event.type === 'session.idle' ||
        event.type === 'session.error' ||
        event.type === 'session.status'
      ) {
        void load();
      }
    });
  }, [load, runId]);

  useEffect(() => {
    if (!snapshot || !['busy', 'creating'].includes(snapshot.session.status)) {
      return;
    }
    // SSE is the primary update path; this bounded reconciliation closes the
    // gap when an event is lost and keeps streamed assistant messages visible.
    const timer = window.setInterval(() => void load(), 750);
    return () => window.clearInterval(timer);
  }, [load, snapshot]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setDraft('');
    try {
      await window.api.codingAgent.sendMessage({ runId, content });
      setActivity('OpenCode is working…');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSending(false);
    }
  };

  const respondPermission = async (
    response: 'once' | 'always' | 'reject',
  ) => {
    if (!permission) return;
    try {
      await window.api.codingAgent.respondPermission({
        runId,
        permissionId: permission.id,
        response,
      });
      setPermission(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (loading) return <Skeleton className="h-[calc(100vh-7rem)] w-full" />;
  if (!snapshot) {
    return <p className="text-sm text-destructive">{error ?? 'Session unavailable.'}</p>;
  }

  const { session, context, messages, diff } = snapshot;
  const currentDiff = diff.find((file) => file.file === selectedFile);
  const busy = ['busy', 'creating', 'aborting'].includes(session.status);
  // OpenCode's busy state describes the current turn, but it must not make
  // the conversation one-shot when an idle SSE event is delayed or missed.
  const composerLocked =
    sending ||
    session.status === 'creating' ||
    session.status === 'aborting' ||
    session.status === 'waiting_permission' ||
    Boolean(permission);

  return (
    <div className="flex h-full min-h-[42rem] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <section className="shrink-0 border-b border-border bg-gradient-to-r from-card via-card to-muted/40 px-5 py-4">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <span className={`size-2 rounded-full ${busy ? 'animate-pulse bg-chart-4' : 'bg-chart-3'}`} />
              {session.status.replace('_', ' ')}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="font-mono text-base font-semibold">{context.worktree.name}</h2>
              <span className="font-mono text-sm text-muted-foreground">
                {context.worktree.branchName}
              </span>
              <Badge variant="outline" className="font-mono text-[11px]">
                {context.repository.fullName}
              </Badge>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background/70 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Model</div>
            <div className="mt-0.5 font-mono text-xs font-medium">
              {session.providerId}/{session.modelId}
            </div>
          </div>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <section className="flex min-h-0 flex-col border-b border-border xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="truncate text-xs font-medium">{session.title}</span>
            {busy ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void window.api.codingAgent.abortSession({ runId })}
              >
                Stop
              </Button>
            ) : null}
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
            {messages.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                Ask OpenCode to make a change in this worktree.
              </div>
            ) : null}
            {messages.map((message) => (
              <article
                key={message.id}
                className={message.role === 'user' ? 'ml-auto max-w-[46rem]' : 'max-w-[48rem]'}
              >
                <div className="mb-1.5 text-xs font-semibold">
                  {message.role === 'user' ? 'You' : 'OpenCode'}
                </div>
                {message.content.trim() ? (
                  <div
                    className={
                      message.role === 'user'
                        ? 'whitespace-pre-wrap rounded-xl rounded-tr-sm border border-primary/25 bg-primary/10 px-4 py-3 text-sm leading-6'
                        : 'whitespace-pre-wrap border-l-2 border-primary/70 bg-muted/35 px-4 py-3 text-sm leading-6'
                    }
                  >
                    {message.content}
                  </div>
                ) : null}
                {message.role === 'assistant' && message.reasoning ? (
                  <div className="whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs italic leading-5 text-muted-foreground/75">
                    {message.reasoning}
                  </div>
                ) : null}
              </article>
            ))}

            {activity && busy ? (
              <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                {activity}
              </div>
            ) : null}

            {permission ? (
              <div className="rounded-xl border border-chart-4/50 bg-chart-4/10 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Permission required · {permission.type}
                </div>
                <p className="mt-2 text-sm font-medium">{permission.title}</p>
                {Object.keys(permission.metadata).length > 0 ? (
                  <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-background/70 p-2 text-[11px] text-muted-foreground">
                    {JSON.stringify(permission.metadata, null, 2)}
                  </pre>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void respondPermission('once')}>Allow once</Button>
                  <Button size="sm" variant="outline" onClick={() => void respondPermission('always')}>Always allow</Button>
                  <Button size="sm" variant="ghost" onClick={() => void respondPermission('reject')}>Deny</Button>
                </div>
              </div>
            ) : null}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <div className="border-t border-border bg-muted/15 p-4">
            <div className="rounded-xl border border-input bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Describe the change you want OpenCode to make…"
                rows={3}
                disabled={composerLocked}
                className="block w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
              />
              <div className="flex items-center justify-between px-1 pt-2">
                <span className="text-xs text-muted-foreground">Enter to send · Shift + Enter for newline</span>
                <Button size="sm" onClick={() => void send()} disabled={!draft.trim() || composerLocked}>
                  Send ↗
                </Button>
              </div>
            </div>
          </div>
        </section>

        <aside className="min-h-0 bg-muted/20 xl:overflow-y-auto">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Inspection</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Session diff</p>
              </div>
              <Badge variant="outline">{diff.length} files</Badge>
            </div>
          </div>

          {diff.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground">
              No changes to inspect yet.
            </div>
          ) : (
            <div>
              <div className="border-b border-border p-3">
                {diff.map((file) => (
                  <button
                    key={file.file}
                    type="button"
                    onClick={() => setSelectedFile(file.file)}
                    className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs last:mb-0 ${
                      file.file === selectedFile ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    <span className="truncate font-mono">{file.file}</span>
                    <span className="ml-2 shrink-0 font-mono">
                      <span className="text-chart-3">+{file.additions}</span>{' '}
                      <span className="text-destructive">-{file.deletions}</span>
                    </span>
                  </button>
                ))}
              </div>
              {currentDiff ? <DiffPreview diff={currentDiff} /> : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

const DiffPreview = ({ diff }: { diff: CodingAgentDiffDto }) => (
  <div className="p-3">
    <div className="mb-2 truncate font-mono text-xs font-medium">{diff.file}</div>
    <div className="grid gap-2">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Before</div>
        <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[10px] leading-4 text-muted-foreground">
          {diff.before || '∅'}
        </pre>
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">After</div>
        <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[10px] leading-4">
          {diff.after || '∅'}
        </pre>
      </div>
    </div>
  </div>
);

export const CodingAgent = () => {
  const { runId } = useParams();
  return runId ? <CodingAgentSession runId={runId} /> : <CodingAgentLanding />;
};
