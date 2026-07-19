import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CodingAgentDiffDto,
  CodingAgentModelDto,
  CodingAgentSessionSnapshotDto,
} from "../../../../shared/ipc/schemas";
import { readPermission, readToolActivity } from "../lib/agent-events";
import {
  isBusyLikeStatus,
  nextChangesSummaryUpdate,
} from "../lib/changes-summary";
import type { PendingPermission } from "../types";

export const useCodingAgentSession = (runId: string) => {
  const [snapshot, setSnapshot] = useState<CodingAgentSessionSnapshotDto>();
  const [models, setModels] = useState<CodingAgentModelDto[]>([]);
  const [modelKey, setModelKey] = useState("");
  const [reasoningVariant, setReasoningVariant] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [changingModel, setChangingModel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [permission, setPermission] = useState<PendingPermission>();
  const [activity, setActivity] = useState<string>();
  const [changesSummary, setChangesSummary] = useState<CodingAgentDiffDto[]>();
  const [selectedSummaryFile, setSelectedSummaryFile] = useState<string>();
  const refreshSequence = useRef(0);
  const wasBusyRef = useRef(false);
  const load = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const next = await window.api.codingAgent.getSession({ runId });
      if (sequence !== refreshSequence.current) return;
      setSnapshot(next);
      if (!isBusyLikeStatus(next.session.status)) setActivity(undefined);
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
      if (event.runId === null && event.type === "server.exit") {
        const message =
          typeof event.payload === "object" &&
          event.payload !== null &&
          "message" in event.payload &&
          typeof event.payload.message === "string"
            ? event.payload.message
            : undefined;
        setError(message ?? "The OpenCode server stopped unexpectedly.");
        void load();
        return;
      }
      if (event.runId !== runId) return;
      if (["session.idle", "session.error"].includes(event.type)) {
        setActivity(undefined);
      }
      const nextActivity = readToolActivity(event);
      if (nextActivity) setActivity(nextActivity);
      if (event.type === "permission.updated") {
        const nextPermission = readPermission(event.payload);
        if (nextPermission) setPermission(nextPermission);
      }
      if (
        [
          "messages.updated",
          "session.diff",
          "session.idle",
          "session.error",
          "session.status",
        ].includes(event.type)
      )
        void load();
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
        if (!cancelled) {
          setModels(nextModels);
          setModelKey(currentModelKey);
        }
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : String(cause));
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
    if (!snapshot || !["busy", "creating"].includes(snapshot.session.status))
      return;
    const timer = window.setInterval(() => void load(), 750);
    return () => window.clearInterval(timer);
  }, [load, snapshot]);
  // Surfaces the changes summary panel only when the agent finishes while the
  // session is being viewed; see nextChangesSummaryUpdate for the transition
  // rules (diff lagging behind completion, run status stuck on busy). The
  // panel summarizes only the current turn (turnDiff), not the whole session.
  useEffect(() => {
    if (!snapshot) return;
    const lastMessage = snapshot.messages.at(-1);
    const update = nextChangesSummaryUpdate(wasBusyRef.current, {
      status: snapshot.session.status,
      diff: snapshot.turnDiff,
      agentFinished:
        lastMessage?.role === "assistant" && lastMessage.completedAt !== null,
    });
    if (update.kind === "working") {
      wasBusyRef.current = true;
      setChangesSummary(undefined);
      setSelectedSummaryFile(undefined);
      return;
    }
    if (update.kind === "completed") {
      wasBusyRef.current = false;
      setChangesSummary(update.diff);
    }
  }, [snapshot]);
  const send = useCallback(
    async (content: string) => {
      if (!content.trim()) return;
      setSending(true);
      setChangesSummary(undefined);
      setSelectedSummaryFile(undefined);
      try {
        await window.api.codingAgent.sendMessage({
          runId,
          content,
          reasoningVariant: reasoningVariant || undefined,
        });
        // Arm the completion detector even if no busy snapshot is observed.
        wasBusyRef.current = true;
        setActivity("OpenCode is working…");
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setSending(false);
      }
    },
    [load, reasoningVariant, runId],
  );
  const changeModel = useCallback(
    async (nextModelKey: string) => {
      const model = models.find(
        (candidate) =>
          `${candidate.providerId}::${candidate.modelId}` === nextModelKey,
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
        setReasoningVariant("");
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setChangingModel(false);
      }
    },
    [load, modelKey, models, runId],
  );
  const respondPermission = useCallback(
    async (response: "once" | "always" | "reject") => {
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
    },
    [permission, runId],
  );
  const dismissChangesSummary = useCallback(() => {
    setChangesSummary(undefined);
    setSelectedSummaryFile(undefined);
  }, []);
  const selectSummaryFile = useCallback((file: string | undefined) => {
    setSelectedSummaryFile(file);
  }, []);
  return {
    snapshot,
    models,
    modelKey,
    reasoningVariant,
    loadingModels,
    changingModel,
    loading,
    sending,
    error,
    permission,
    activity,
    changesSummary,
    selectedSummaryFile,
    setReasoningVariant,
    load,
    send,
    changeModel,
    respondPermission,
    dismissChangesSummary,
    selectSummaryFile,
  };
};
