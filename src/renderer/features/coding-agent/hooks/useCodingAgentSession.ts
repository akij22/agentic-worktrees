import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CapabilitySummaryDto,
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
import { getAgentDisplay } from "../lib/agent-display";
import { CoalescingTaskQueue } from "../lib/coalescing-task-queue";

export const useCodingAgentSession = (runId: string) => {
  const [snapshot, setSnapshot] = useState<CodingAgentSessionSnapshotDto>();
  const [models, setModels] = useState<CodingAgentModelDto[]>([]);
  const [capabilityLibrary, setCapabilityLibrary] = useState<CapabilitySummaryDto[]>([]);
  const [modelKey, setModelKey] = useState("");
  const [reasoningVariant, setReasoningVariant] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [changingModel, setChangingModel] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [viewAcknowledgementError, setViewAcknowledgementError] =
    useState<string>();
  const [permission, setPermission] = useState<PendingPermission>();
  const [activity, setActivity] = useState<string>();
  const [changesSummary, setChangesSummary] = useState<CodingAgentDiffDto[]>();
  const [selectedSummaryFile, setSelectedSummaryFile] = useState<string>();
  const wasBusyRef = useRef(false);
  const agentRef = useRef({ kind: "", name: "coding agent" });
  const runIdRef = useRef(runId);
  const performLoadRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshQueueRef = useRef<CoalescingTaskQueue | null>(null);
  runIdRef.current = runId;
  if (!refreshQueueRef.current) {
    refreshQueueRef.current = new CoalescingTaskQueue(() =>
      performLoadRef.current(),
    );
  }
  useEffect(() => {
    wasBusyRef.current = false;
    agentRef.current = { kind: "", name: "coding agent" };
    setSnapshot(undefined);
    setModels([]);
    setCapabilityLibrary([]);
    setModelKey("");
    setReasoningVariant("");
    setLoadingModels(false);
    setChangingModel(false);
    setCompacting(false);
    setLoading(true);
    setSending(false);
    setError(undefined);
    setViewAcknowledgementError(undefined);
    setPermission(undefined);
    setActivity(undefined);
    setChangesSummary(undefined);
    setSelectedSummaryFile(undefined);
  }, [runId]);
  useEffect(() => {
    let cancelled = false;
    setViewAcknowledgementError(undefined);
    void window.api.codingAgent
      .markSessionViewed({ runId })
      .catch(() => {
        if (!cancelled) {
          setViewAcknowledgementError(
            "Could not update the chat status. Please try reopening this session.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);
  performLoadRef.current = async () => {
    const requestedRunId = runIdRef.current;
    try {
      const next = await window.api.codingAgent.getSession({
        runId: requestedRunId,
      });
      if (requestedRunId !== runIdRef.current) return;
      setSnapshot(next);
      agentRef.current = {
        kind: next.session.agentKind,
        name: next.session.agentName,
      };
      if (!isBusyLikeStatus(next.session.status)) setActivity(undefined);
      setError(undefined);
    } catch (cause) {
      if (requestedRunId !== runIdRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestedRunId === runIdRef.current) {
        setLoading(false);
        setSending(false);
      }
    }
  };
  const load = useCallback(
    () => refreshQueueRef.current?.request() ?? Promise.resolve(),
    [],
  );
  useEffect(() => {
    void load();
    const capabilityApi = window.api.capabilities;
    void capabilityApi?.list({ runId }).then(setCapabilityLibrary).catch(() => setError("Could not load chat capabilities."));
    const unsubscribeCapabilities = capabilityApi?.onChanged((event) => {
      if (event.runId !== runId) return;
      void load();
      void capabilityApi.list({ runId }).then(setCapabilityLibrary).catch(() => undefined);
    }) ?? (() => undefined);
    const unsubscribeAgent = window.api.codingAgent.onEvent((event) => {
      if (event.runId === null && event.type === "server.exit") {
        const eventAgentKind =
          typeof event.payload === "object" &&
          event.payload !== null &&
          "agentKind" in event.payload &&
          typeof event.payload.agentKind === "string"
            ? event.payload.agentKind
            : undefined;
        if (eventAgentKind && eventAgentKind !== agentRef.current.kind) return;
        const message =
          typeof event.payload === "object" &&
          event.payload !== null &&
          "message" in event.payload &&
          typeof event.payload.message === "string"
            ? event.payload.message
            : undefined;
        setError(message ?? getAgentDisplay(agentRef.current.name).exitError);
        void load();
        return;
      }
      if (event.runId !== runId) return;
      if (["session.idle", "session.error"].includes(event.type)) {
        setActivity(undefined);
        setCompacting(false);
      }
      const nextActivity = readToolActivity(event);
      if (nextActivity) setActivity(nextActivity);
      if (event.type === "permission.updated") {
        const nextPermission = readPermission(event.payload);
        if (nextPermission) {
          setPermission({
            ...nextPermission,
            title:
              nextPermission.title === "OpenCode requests permission"
                ? getAgentDisplay(agentRef.current.name).permissionTitle
                : nextPermission.title,
          });
        }
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
    return () => { unsubscribeAgent(); unsubscribeCapabilities(); };
  }, [load, runId]);
  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    const currentModelKey = `${snapshot.session.providerId}::${snapshot.session.modelId}`;
    setLoadingModels(true);
    void window.api.codingAgent
      .listModels({ runId })
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
    runId,
    snapshot?.session.modelId,
    snapshot?.session.providerId,
  ]);
  useEffect(() => {
    if (!snapshot || !["busy", "creating"].includes(snapshot.session.status))
      return;
    const timer = window.setInterval(() => void load(), 750);
    return () => window.clearInterval(timer);
  }, [load, snapshot]);
  // Surfaces the changes summary panel only after the whole turn becomes idle
  // while the session is being viewed. The panel summarizes only the current
  // turn (turnDiff), not the whole session.
  useEffect(() => {
    if (!snapshot) return;
    const update = nextChangesSummaryUpdate(wasBusyRef.current, {
      status: snapshot.session.status,
      diff: snapshot.turnDiff,
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
        setActivity(
          getAgentDisplay(snapshot?.session.agentName ?? agentRef.current.name)
            .working,
        );
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setSending(false);
      }
    },
    [load, reasoningVariant, runId, snapshot?.session.agentName],
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
  const compact = useCallback(async () => {
    setCompacting(true);
    setError(undefined);
    setChangesSummary(undefined);
    setSelectedSummaryFile(undefined);
    try {
      await window.api.codingAgent.compactSession({ runId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCompacting(false);
    }
  }, [load, runId]);
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
  const activateCapability = useCallback(async (capabilityId: string) => {
    await window.api.capabilities.activate({ runId, capabilityId });
    await load();
  }, [load, runId]);
  const deactivateCapability = useCallback(async (capabilityId: string) => {
    await window.api.capabilities.deactivate({ runId, capabilityId });
    await load();
  }, [load, runId]);
  const retryCapability = activateCapability;
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
    capabilities: snapshot?.capabilities ?? [],
    capabilityLibrary,
    capabilityReloading: snapshot?.capabilityReloading ?? false,
    modelKey,
    reasoningVariant,
    loadingModels,
    changingModel,
    compacting,
    loading,
    sending,
    error: error ?? viewAcknowledgementError,
    permission,
    activity,
    changesSummary,
    selectedSummaryFile,
    setReasoningVariant,
    load,
    send,
    changeModel,
    compact,
    respondPermission,
    activateCapability,
    deactivateCapability,
    retryCapability,
    dismissChangesSummary,
    selectSummaryFile,
  };
};
