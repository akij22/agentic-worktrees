import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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

type SessionGridDetail = {
  lastActivity: string | undefined;
  additions: number;
  deletions: number;
  changedFiles: number;
};

type SessionStatusTone = {
  label: string;
  badgeClassName: string;
  indicatorClassName: string;
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const formatElapsedTime = (value: Date) => {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (elapsedMinutes < 1) return 'just started';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m elapsed`;
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m elapsed` : `${hours}h elapsed`;
};

const getSessionStatusTone = (status: string): SessionStatusTone => {
  switch (status) {
    case 'busy':
    case 'creating':
      return {
        label: 'Running',
        badgeClassName: 'border-chart-3/35 bg-chart-3/10 text-chart-3',
        indicatorClassName: 'animate-pulse bg-chart-3',
      };
    case 'waiting_permission':
      return {
        label: 'Awaiting input',
        badgeClassName: 'border-chart-4/35 bg-chart-4/10 text-chart-4',
        indicatorClassName: 'bg-chart-4',
      };
    case 'error':
      return {
        label: 'Failed',
        badgeClassName: 'border-destructive/35 bg-destructive/10 text-destructive',
        indicatorClassName: 'bg-destructive',
      };
    case 'idle':
    default:
      return {
        label: status.replaceAll('_', ' '),
        badgeClassName: 'border-primary/30 bg-primary/10 text-primary',
        indicatorClassName: 'bg-primary',
      };
  }
};

const compactActivity = (content: string | undefined) => {
  if (!content?.trim()) return 'Session is ready for the next instruction.';
  return content.replaceAll(/\s+/g, ' ').trim();
};

const GridIcon = ({ name }: { name: 'branch' | 'bot' | 'clock' | 'files' | 'arrow' }) => {
  const paths = {
    branch: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><path d="M6 7v4a4 4 0 0 0 4 4h6" /><path d="M18 7v4" /></>,
    bot: <><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6" /></>,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
    files: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      {paths[name]}
    </svg>
  );
};

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
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) setWorktreeId(initialWorktreeId ?? contexts[0]?.worktree.id ?? '');
  }, [contexts, initialWorktreeId, open]);

  if (!open) return null;

  const create = async () => {
    if (!worktreeId || !title.trim()) return;
    setCreating(true);
    setError(undefined);
    try {
      const session = await window.api.codingAgent.createSession({
        worktreeId,
        title: title.trim(),
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
          Select a worktree. You can choose the AI model directly from the chat.
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
          disabled={creating || !worktreeId || !title.trim()}
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
  const [sessionDetails, setSessionDetails] = useState<Map<string, SessionGridDetail>>(
    () => new Map(),
  );
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
      const detailResults = await Promise.all(
        nextSessions.map(async (session) => {
          try {
            const snapshot = await window.api.codingAgent.getSession({ runId: session.id });
            return {
              id: session.id,
              detail: {
                lastActivity: snapshot.messages.at(-1)?.content,
                additions: snapshot.diff.reduce((total, file) => total + file.additions, 0),
                deletions: snapshot.diff.reduce((total, file) => total + file.deletions, 0),
                changedFiles: snapshot.diff.length,
              },
              error: undefined,
            };
          } catch (cause) {
            return {
              id: session.id,
              detail: {
                lastActivity: undefined,
                additions: 0,
                deletions: 0,
                changedFiles: 0,
              },
              error: cause instanceof Error ? cause.message : String(cause),
            };
          }
        }),
      );
      setSessionDetails(
        new Map(
          detailResults.map(({ id, detail }) => [id, detail]),
        ),
      );
      const detailFailures = detailResults.filter((result) => result.error);
      setError(
        detailFailures.length > 0
          ? `Could not load details for ${detailFailures.length} session${detailFailures.length === 1 ? '' : 's'}. Open a session to retry.`
          : undefined,
      );
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

  const activeSessionCount = sessions.filter((session) =>
    ['busy', 'creating', 'waiting_permission'].includes(session.status),
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            OpenCode · {status.version}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Coding sessions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {sessions.length === 0
              ? 'Persistent conversations, each isolated to one Git worktree.'
              : `Monitoring ${sessions.length} session${sessions.length === 1 ? '' : 's'} across isolated worktrees${activeSessionCount > 0 ? ` · ${activeSessionCount} active` : ''}.`}
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
        <div className="grid gap-4 xl:grid-cols-2">
          {sessions.map((session) => {
            const context = contextByWorktree.get(session.worktreeId);
            const detail = sessionDetails.get(session.id);
            const tone = getSessionStatusTone(session.status);
            return (
              <button
                key={session.id}
                type="button"
                onClick={() =>
                  navigate(`/coding-agent/${session.worktreeId}/${session.id}`)
                }
                className="group flex min-h-72 flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3.5">
                  <div className="min-w-0 space-y-1.5">
                    <h3 className="truncate text-base font-semibold tracking-tight">
                      {session.title}
                    </h3>
                    <div className="flex items-center gap-1.5 font-mono text-xs text-primary">
                      <GridIcon name="branch" />
                      <span className="truncate">
                        {context?.worktree.branchName ?? 'missing worktree'}
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 gap-1.5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] ${tone.badgeClassName}`}
                  >
                    <span className={`size-1.5 rounded-full ${tone.indicatorClassName}`} />
                    {tone.label}
                  </Badge>
                </div>

                <div className="flex flex-1 flex-col gap-4 px-4 py-4">
                  <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
                    <span className="flex min-w-0 items-center gap-1.5 font-mono">
                      <GridIcon name="bot" />
                      <span className="truncate">{session.providerId}/{session.modelId}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 font-mono">
                      <GridIcon name="clock" />
                      {formatElapsedTime(session.createdAt)}
                    </span>
                  </div>

                  <div className="min-h-16 rounded-lg border border-border bg-background/70 px-3 py-2.5 font-mono text-xs leading-5 text-muted-foreground shadow-inner">
                    <span className="mr-2 text-primary">&gt;</span>
                    <span className="line-clamp-2">{compactActivity(detail?.lastActivity)}</span>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
                      <GridIcon name="files" />
                      {detail?.changedFiles ?? 0} file{(detail?.changedFiles ?? 0) === 1 ? '' : 's'}
                    </span>
                    {(detail?.additions ?? 0) > 0 || (detail?.deletions ?? 0) > 0 ? (
                      <span className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
                        <span className="text-chart-3">+{detail?.additions ?? 0}</span>{' '}
                        <span className="text-destructive">−{detail?.deletions ?? 0}</span>
                      </span>
                    ) : null}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      updated {formatDate(session.updatedAt)}
                    </span>
                  </div>
                </div>

                <div className="h-px w-full bg-primary" aria-hidden="true" />
                <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-2.5">
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {context?.worktree.name ?? 'Unavailable worktree'}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary transition-transform group-hover:translate-x-0.5">
                    Open session
                    <GridIcon name="arrow" />
                  </span>
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
  const [models, setModels] = useState<CodingAgentModelDto[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [reasoningVariant, setReasoningVariant] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [changingModel, setChangingModel] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [permission, setPermission] = useState<PendingPermission>();
  const [activity, setActivity] = useState<string>();
  const [selectedFile, setSelectedFile] = useState<string>();
  const refreshSequence = useRef(0);
  const splitRef = useRef<HTMLDivElement>(null);
  const [diffPanelWidth, setDiffPanelWidth] = useState(368);
  const [isResizing, setIsResizing] = useState(false);

  const load = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const next = await window.api.codingAgent.getSession({ runId });
      if (sequence !== refreshSequence.current) return;
      setSnapshot(next);
      setSelectedFile((current) =>
        current && next.diff.some((file) => file.file === current)
          ? current
          : next.diff[0]?.file,
      );
      setError(undefined);
    } catch (cause) {
      if (sequence !== refreshSequence.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === refreshSequence.current) {
        setLoading(false);
        setSending(false);
      }
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
    if (!snapshot) return;
    let cancelled = false;
    const currentModelKey = `${snapshot.session.providerId}::${snapshot.session.modelId}`;
    setLoadingModels(true);
    void window.api.codingAgent
      .listModels({ worktreeId: snapshot.context.worktree.id })
      .then((nextModels) => {
        if (cancelled) return;
        setModels(nextModels);
        setModelKey(currentModelKey);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    snapshot?.context.worktree.id,
    snapshot?.session.modelId,
    snapshot?.session.providerId,
  ]);

  useEffect(() => {
    if (!snapshot || !['busy', 'creating'].includes(snapshot.session.status)) {
      return;
    }
    // SSE is the primary update path; this bounded reconciliation closes the
    // gap when an event is lost and keeps streamed assistant messages visible.
    const timer = window.setInterval(() => void load(), 750);
    return () => window.clearInterval(timer);
  }, [load, snapshot]);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = splitRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const maxWidth = Math.max(280, Math.min(720, bounds.width - 420));
      const nextWidth = bounds.right - event.clientX;
      setDiffPanelWidth(Math.min(maxWidth, Math.max(280, nextWidth)));
    };
    const stopResizing = () => setIsResizing(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
    };
  }, [isResizing]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setDraft('');
    try {
      await window.api.codingAgent.sendMessage({
        runId,
        content,
        reasoningVariant: reasoningVariant || undefined,
      });
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

  if (loading) return <Skeleton className="h-full w-full" />;
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

  const changeModel = async (nextModelKey: string) => {
    const model = models.find(
      (candidate) => `${candidate.providerId}::${candidate.modelId}` === nextModelKey,
    );
    if (!model || nextModelKey === modelKey) return;
    setChangingModel(true);
    setError(undefined);
    try {
      await window.api.codingAgent.setSessionModel({
        runId,
        providerId: model.providerId,
        modelId: model.modelId,
      });
      setModelKey(nextModelKey);
      setReasoningVariant('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChangingModel(false);
    }
  };

  const selectedModel = models.find(
    (model) => `${model.providerId}::${model.modelId}` === modelKey,
  );
  const reasoningVariants = selectedModel?.reasoningVariants ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <section className="shrink-0 border-b border-border bg-gradient-to-r from-card via-card to-muted/30 px-6 py-4">
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
        </div>
      </section>

      <div
        ref={splitRef}
        style={{
          '--inspection-panel-width': `${diffPanelWidth}px`,
        } as CSSProperties}
        className="grid min-h-0 flex-1 grid-cols-1 xl:[grid-template-columns:minmax(0,1fr)_0.5rem_var(--inspection-panel-width)]"
      >
        <section className="flex min-h-0 flex-col border-b border-border xl:border-b-0">
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
                <div className="flex min-w-0 items-center gap-2">
                  <Select
                    aria-label="AI model"
                    value={modelKey}
                    onChange={(event) => void changeModel(event.target.value)}
                    disabled={
                      loadingModels || changingModel || busy || models.length === 0
                    }
                    className="h-7 w-44 border-border bg-muted/40 px-2 font-mono text-[11px] shadow-none"
                  >
                    {loadingModels ? <option>Loading models…</option> : null}
                    {!loadingModels && models.length === 0 ? (
                      <option value={`${session.providerId}::${session.modelId}`}>
                        {session.providerId}/{session.modelId}
                      </option>
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
                  {reasoningVariants.length > 0 ? (
                    <Select
                      aria-label="Reasoning level"
                      value={reasoningVariant}
                      onChange={(event) => setReasoningVariant(event.target.value)}
                      disabled={composerLocked}
                      className="h-7 w-32 border-border bg-muted/40 px-2 font-mono text-[11px] capitalize shadow-none"
                    >
                      <option value="">Reasoning · default</option>
                      {reasoningVariants.map((variant) => (
                        <option key={variant} value={variant} className="capitalize">
                          Reasoning · {variant}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  <span className="hidden text-xs text-muted-foreground 2xl:inline">
                    Enter to send · Shift + Enter for newline
                  </span>
                </div>
                <Button size="sm" onClick={() => void send()} disabled={!draft.trim() || composerLocked}>
                  Send ↗
                </Button>
              </div>
            </div>
          </div>
        </section>

        <div
          role="separator"
          aria-label="Resize chat and diff panels"
          aria-orientation="vertical"
          aria-valuemin={280}
          aria-valuemax={720}
          aria-valuenow={diffPanelWidth}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setDiffPanelWidth((width) => Math.min(720, width + 24));
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              setDiffPanelWidth((width) => Math.max(280, width - 24));
            }
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            setIsResizing(true);
          }}
          className={`group relative hidden touch-none cursor-col-resize items-center justify-center border-x border-border/60 bg-transparent transition-colors xl:flex ${isResizing ? 'bg-primary/10' : 'hover:bg-primary/5'}`}
        >
          <span
            className={`h-8 w-px rounded-full transition-all ${isResizing ? 'h-12 bg-primary' : 'bg-border group-hover:h-12 group-hover:bg-primary/70'}`}
          />
        </div>

        <aside className="flex min-h-0 flex-col bg-muted/20 xl:overflow-hidden">
          <div className="shrink-0 border-b border-border px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Inspection</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Session diff</p>
              </div>
              <Badge variant="outline">{diff.length} files</Badge>
            </div>
          </div>

          {diff.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              No changes to inspect yet.
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-border p-3">
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

type DiffLine = {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  oldLine: number | null;
  newLine: number | null;
};

const splitDiffLines = (content: string): string[] => {
  if (!content) return [];
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
};

const createDiffLines = (before: string, after: string): DiffLine[] => {
  const oldLines = splitDiffLines(before);
  const newLines = splitDiffLines(after);
  const table = Array.from({ length: oldLines.length + 1 }, () =>
    new Uint32Array(newLines.length + 1),
  );

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  let oldLine = 1;
  let newLine = 1;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      lines.push({
        type: 'context',
        content: oldLines[oldIndex],
        oldLine,
        newLine,
      });
      oldIndex += 1;
      newIndex += 1;
      oldLine += 1;
      newLine += 1;
    } else if (
      newIndex >= newLines.length ||
      (oldIndex < oldLines.length &&
        table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1])
    ) {
      lines.push({
        type: 'deletion',
        content: oldLines[oldIndex],
        oldLine,
        newLine: null,
      });
      oldIndex += 1;
      oldLine += 1;
    } else {
      lines.push({
        type: 'addition',
        content: newLines[newIndex],
        oldLine: null,
        newLine,
      });
      newIndex += 1;
      newLine += 1;
    }
  }

  return lines;
};

const DiffPreview = ({ diff }: { diff: CodingAgentDiffDto }) => {
  const lines = useMemo(() => createDiffLines(diff.before, diff.after), [diff.before, diff.after]);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0 truncate font-mono text-xs font-medium text-foreground">
          {diff.file}
        </div>
        <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] font-semibold">
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400">
            +{diff.additions}
          </span>
          <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-400">
            −{diff.deletions}
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-inner">
        <div className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[11px] leading-5">
          {lines.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No line changes to display.
            </div>
          ) : (
            lines.map((line, index) => {
              const tone =
                line.type === 'addition'
                  ? 'border-l-2 border-emerald-400 bg-emerald-500/10 text-emerald-100'
                  : line.type === 'deletion'
                    ? 'border-l-2 border-rose-400 bg-rose-500/10 text-rose-100'
                    : 'border-l-2 border-transparent text-muted-foreground hover:bg-muted/30';
              const marker = line.type === 'addition' ? '+' : line.type === 'deletion' ? '−' : ' ';
              return (
                <div key={`${line.type}-${line.oldLine ?? 'new'}-${line.newLine ?? 'old'}-${index}`} className={`flex min-w-max ${tone}`}>
                  <span className="w-10 shrink-0 select-none px-2 text-right text-muted-foreground/50">
                    {line.oldLine ?? ''}
                  </span>
                  <span className="w-10 shrink-0 select-none px-1 text-right text-muted-foreground/50">
                    {line.newLine ?? ''}
                  </span>
                  <span className="w-5 shrink-0 select-none text-center font-semibold opacity-80">
                    {marker}
                  </span>
                  <span className="whitespace-pre px-2">{line.content || ' '}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export const CodingAgent = () => {
  const { runId } = useParams();
  return runId ? <CodingAgentSession runId={runId} /> : <CodingAgentLanding />;
};
