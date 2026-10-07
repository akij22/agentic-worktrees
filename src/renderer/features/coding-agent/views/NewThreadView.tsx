import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  CodingAgentInstallationStatusDto,
  CodingAgentKindDto,
  CodingAgentModelDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { CapabilityPanel } from "../components/CapabilityPanel";
import { useWorktreeCapabilities } from "../hooks/useWorktreeCapabilities";
import { HarnessModelPicker } from "../components/HarnessModelPicker";
import { SessionComposer } from "../components/SessionComposer";
import { WorktreeRow } from "../components/WorktreeRow";
import {
  findReusableDraft,
  resolveDefaultWorktreeId,
  resolveLandingPrompt,
} from "../lib/landing";

type Props = {
  contexts: CodingAgentWorktreeContextDto[];
  installations: CodingAgentInstallationStatusDto[];
  sessions: {
    id: string;
    worktreeId: string;
    updatedAt: Date;
    isDraft: boolean;
    agentKind?: CodingAgentKindDto;
    providerId?: string;
    modelId?: string;
  }[];
  initialWorktreeId?: string;
};

type CreateState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "error"; message: string };

export const NewThreadView = ({
  contexts,
  installations,
  sessions,
  initialWorktreeId,
}: Props) => {
  const navigate = useNavigate();
  const [worktreeId, setWorktreeId] = useState<string | undefined>(() => {
    const requested = contexts.find(
      ({ worktree }) => worktree.id === initialWorktreeId,
    );
    return (
      requested?.worktree.id ??
      resolveDefaultWorktreeId(contexts, sessions)
    );
  });
  useEffect(() => {
    if (contexts.length === 0) return;
    if (worktreeId && contexts.some(({ worktree }) => worktree.id === worktreeId)) {
      return;
    }
    const requested = contexts.find(
      ({ worktree }) => worktree.id === initialWorktreeId,
    );
    setWorktreeId(
      requested?.worktree.id ?? resolveDefaultWorktreeId(contexts, sessions),
    );
  }, [contexts, initialWorktreeId, sessions, worktreeId]);
  const [agentKind, setAgentKind] = useState<CodingAgentKindDto | undefined>();
  const [selectedModel, setSelectedModel] = useState<CodingAgentModelDto>();
  const [modelsByKind, setModelsByKind] = useState<
    Partial<Record<CodingAgentKindDto, CodingAgentModelDto[]>>
  >({});
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [createState, setCreateState] = useState<CreateState>({
    status: "idle",
  });
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const { activeCount: activeCapabilityCount } =
    useWorktreeCapabilities(worktreeId);

  const context = useMemo(
    () => contexts.find(({ worktree }) => worktree.id === worktreeId),
    [contexts, worktreeId],
  );
  const configured = useMemo(
    () => installations.filter((installation) => installation.configured),
    [installations],
  );
  const activeHarness =
    agentKind ?? configured[0]?.kind ?? installations[0]?.kind;
  const activeModel = selectedModel ?? (activeHarness
    ? (modelsByKind[activeHarness] ?? []).find((model) => model.isDefault) ??
      modelsByKind[activeHarness]?.[0]
    : undefined);

  useEffect(() => {
    let cancelled = false;
    if (!worktreeId || configured.length === 0) {
      setModelsByKind({});
      setSelectedModel(undefined);
      setLoadingModels(false);
      return;
    }
    setModelsByKind({});
    setSelectedModel(undefined);
    setModelLoadError(undefined);
    setLoadingModels(true);
    const modelErrors: string[] = [];
    void Promise.all(
      configured.map(async ({ kind }) => {
        try {
          const models = await window.api.codingAgent.listWorktreeModels({
            worktreeId,
            agentKind: kind,
          });
          return [kind, models] as const;
        } catch {
          modelErrors.push(kind);
          return [kind, []] as const;
        }
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        const next = Object.fromEntries(entries) as Partial<
          Record<CodingAgentKindDto, CodingAgentModelDto[]>
        >;
        setModelsByKind(next);
        setModelLoadError(
          modelErrors.length > 0
            ? "Could not load models for one or more providers."
            : undefined,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setModelLoadError("Could not load available models.");
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configured, worktreeId]);

  const createAndOpen = useCallback(
    async (
      kind: CodingAgentKindDto,
      model: CodingAgentModelDto | undefined,
    ) => {
      if (!worktreeId || !kind) return;
      const matchingDrafts = model
        ? sessions.filter(
            (session) =>
              session.agentKind === kind &&
              session.providerId === model.providerId &&
              session.modelId === model.modelId,
          )
        : [];
      const reusable = findReusableDraft(matchingDrafts, worktreeId);
      if (reusable) {
        navigate(`/chat/${encodeURIComponent(worktreeId)}/${encodeURIComponent(reusable.id)}`);
        return;
      }
      setCreateState({ status: "creating" });
      try {
        const session = await window.api.codingAgent.createSession({
          agentKind: kind,
          worktreeId,
          title: context?.worktree.name ?? "New thread",
          ...(model
            ? { providerId: model.providerId, modelId: model.modelId }
            : {}),
        });
        navigate(
          `/chat/${encodeURIComponent(worktreeId)}/${encodeURIComponent(session.id)}`,
        );
      } catch (cause) {
        setCreateState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [context, navigate, sessions, worktreeId],
  );

  if (contexts.length === 0) {
    return (
      <div className="grid h-full min-h-[24rem] place-items-center px-8 text-center">
        <div className="max-w-md">
          <h2 className="text-lg font-semibold tracking-tight">
            No repositories yet
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Import a repository on the Worktrees page to give your coding agents
            somewhere to work.
          </p>
          <Button
            className="mt-5"
            onClick={() => navigate("/worktrees")}
          >
            Open Worktrees
          </Button>
        </div>
      </div>
    );
  }

  if (configured.length === 0) {
    return (
      <div className="grid h-full min-h-[24rem] place-items-center px-8 text-center">
        <div className="max-w-md">
          <h2 className="text-lg font-semibold tracking-tight">
            Configure a coding agent first
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Select a local coding-agent executable before starting a thread.
          </p>
          <Button className="mt-5" onClick={() => navigate("/settings")}>
            Open Settings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 px-8 py-10">
      <h2 className="text-center text-xl font-semibold tracking-tight">
        {resolveLandingPrompt(context)}
      </h2>

      <div className="w-full max-w-[40rem]">
        <SessionComposer
          target={{
            kind: "detached",
            worktreeId: worktreeId ?? "",
            agentKind: activeHarness ?? "opencode",
            agentName:
              installations.find(
                (installation) => installation.kind === activeHarness,
              )?.name ?? "coding agent",
          }}
          leadingControl={
            <div className="session-composer__setting">
              <span className="session-composer__label">Provider / model</span>
              <HarnessModelPicker
                installations={installations}
                modelsByKind={modelsByKind}
                selectedKind={activeHarness}
                selectedModel={activeModel}
                loadingModels={loadingModels}
                errorMessage={modelLoadError}
                onSelect={(kind, model) => {
                  setAgentKind(kind);
                  setSelectedModel(model);
                }}
              />
            </div>
          }
          contextToolbar={
            <WorktreeRow
              contexts={contexts}
              selectedWorktreeId={worktreeId}
              activeCapabilityCount={activeCapabilityCount}
              onSelectWorktree={(next) => {
                setWorktreeId(next);
                setCapabilitiesOpen(false);
              }}
              onOpenCapabilities={() => setCapabilitiesOpen((open) => !open)}
              capabilitiesExpanded={capabilitiesOpen}
              capabilitiesPanelId="landing-capability-panel"
            />
          }
          draft={draft}
          models={[]}
          modelKey=""
          reasoningVariant=""
          reasoningVariants={[]}
          loadingModels={false}
          changingModel={false}
          busy={createState.status === "creating"}
          locked={createState.status === "creating" || !worktreeId || !activeModel}
          onDraftChange={setDraft}
          onModelChange={() => undefined}
          onReasoningChange={() => undefined}
          onSend={() => {
            if (activeHarness && activeModel)
              void createAndOpen(activeHarness, activeModel);
          }}
          onStop={() => undefined}
          onSlashCommand={() => undefined}
        />
      </div>

      {capabilitiesOpen ? (
        <CapabilityPanel
          context={context}
          onClose={() => setCapabilitiesOpen(false)}
        />
      ) : null}

      {createState.status === "error" ? (
        <p role="alert" className="max-w-[40rem] text-sm text-destructive">
          {createState.message}
        </p>
      ) : null}
      {modelLoadError ? (
        <p role="alert" className="max-w-[40rem] text-sm text-destructive">
          {modelLoadError}
        </p>
      ) : null}
    </div>
  );
};
