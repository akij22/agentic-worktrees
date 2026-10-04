import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  CodingAgentInstallationStatusDto,
  CodingAgentKindDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
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
  sessions: { id: string; worktreeId: string; updatedAt: Date; isDraft: boolean }[];
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
  const [agentKind, setAgentKind] = useState<CodingAgentKindDto | undefined>();
  const [draft, setDraft] = useState("");
  const sendingRef = useRef(false);
  const pendingSessionRef = useRef<{
    id: string;
    worktreeId: string;
    agentKind: CodingAgentKindDto;
  } | undefined>(undefined);
  const [createState, setCreateState] = useState<CreateState>({
    status: "idle",
  });

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

  const createAndOpen = useCallback(
    async (kind: CodingAgentKindDto) => {
      const content = draft.trim();
      if (!worktreeId || !content || sendingRef.current) return;
      sendingRef.current = true;
      setCreateState({ status: "creating" });
      try {
        const pending = pendingSessionRef.current;
        const reusable =
          pending?.worktreeId === worktreeId && pending.agentKind === kind
            ? pending
            : findReusableDraft(sessions, worktreeId);
        const session = reusable ??
          await window.api.codingAgent.createSession({
            agentKind: kind,
            worktreeId,
            title: context?.worktree.name ?? "New thread",
          });
        pendingSessionRef.current = { id: session.id, worktreeId, agentKind: kind };
        await window.api.codingAgent.sendMessage({ runId: session.id, content });
        setDraft("");
        navigate(
          `/chat/${encodeURIComponent(worktreeId)}/${encodeURIComponent(session.id)}`,
        );
      } catch (cause) {
        setCreateState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        sendingRef.current = false;
      }
    },
    [context, draft, navigate, sessions, worktreeId],
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
              <span className="session-composer__label">Agent</span>
              <HarnessModelPicker
                installations={installations}
                selectedKind={activeHarness}
                onSelect={setAgentKind}
              />
            </div>
          }
          contextToolbar={
            <WorktreeRow
              contexts={contexts}
              selectedWorktreeId={worktreeId}
              activeCapabilityCount={0}
              onSelectWorktree={(next) => {
                setWorktreeId(next);
              }}
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
          locked={createState.status === "creating" || !worktreeId}
          onDraftChange={setDraft}
          onModelChange={() => undefined}
          onReasoningChange={() => undefined}
          onSend={() => {
            if (activeHarness) void createAndOpen(activeHarness);
          }}
          onStop={() => undefined}
          onSlashCommand={() => undefined}
        />
      </div>

      {createState.status === "error" ? (
        <p role="alert" className="max-w-[40rem] text-sm text-destructive">
          {createState.message}
        </p>
      ) : null}
    </div>
  );
};
