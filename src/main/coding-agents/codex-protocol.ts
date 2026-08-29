import { z } from "zod";
import type {
  CodingAgentDiff,
  CodingAgentMessage,
  CodingAgentModel,
  CodingAgentToolCall,
} from "./types";
import type { CodexRequestId } from "./codex-app-server-client";

const codexReasoningEffortSchema = z.object({
  reasoningEffort: z.string(),
});

const codexModelSchema = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string(),
  hidden: z.boolean(),
  supportedReasoningEfforts: z.array(codexReasoningEffortSchema),
  isDefault: z.boolean(),
});

const codexModelListSchema = z.object({
  data: z.array(codexModelSchema),
  nextCursor: z.string().nullable(),
});

const codexUserInputSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
  })
  .passthrough()
  .superRefine((input, context) => {
    if (input.type === "text" && input.text === undefined) {
      context.addIssue({
        code: "custom",
        message: "Codex text input is missing text",
        path: ["text"],
      });
    }
  });

const codexFileChangeSchema = z
  .object({
    path: z.string(),
  })
  .passthrough();

const codexThreadItemSchema = z
  .object({
    type: z.string(),
    id: z.string().optional(),
    content: z.array(z.union([codexUserInputSchema, z.string()])).optional(),
    text: z.string().optional(),
    phase: z.string().nullable().optional(),
    summary: z.array(z.string()).optional(),
    changes: z.array(codexFileChangeSchema).optional(),
  })
  .passthrough()
  .superRefine((item, context) => {
    const requireField = (
      field: "id" | "content" | "text" | "summary" | "changes",
    ) => {
      if (item[field] === undefined) {
        context.addIssue({
          code: "custom",
          message: `Codex ${item.type} item is missing ${field}`,
          path: [field],
        });
      }
    };

    if (item.type === "userMessage") {
      requireField("id");
      requireField("content");
    } else if (item.type === "agentMessage") {
      requireField("id");
      requireField("text");
    } else if (item.type === "reasoning") {
      requireField("id");
      requireField("summary");
    } else if (item.type === "fileChange") {
      requireField("id");
      requireField("changes");
    }
  });

const codexTurnStatusSchema = z.enum([
  "completed",
  "interrupted",
  "failed",
  "inProgress",
]);

const codexTurnSchema = z
  .object({
    id: z.string(),
    items: z.array(codexThreadItemSchema),
    status: codexTurnStatusSchema,
    error: z
      .object({
        message: z.string(),
      })
      .passthrough()
      .nullable(),
    startedAt: z.number().nullable(),
    completedAt: z.number().nullable(),
  })
  .passthrough();

const codexThreadStatusSchema = z
  .object({
    type: z.enum(["notLoaded", "idle", "systemError", "active"]),
  })
  .passthrough();

const codexThreadSchema = z
  .object({
    id: z.string(),
    status: codexThreadStatusSchema,
    turns: z.array(codexTurnSchema),
  })
  .passthrough();

const codexThreadResponseSchema = z.object({
  thread: codexThreadSchema,
});

const codexMcpServerStatusListSchema = z.object({
  data: z.array(z.object({
    name: z.string(),
    runtimeStatus: z.enum(["notStarted", "starting", "connected", "authenticationRequired", "failed", "cancelled", "disabled"]).nullable(),
    tools: z.record(z.string(), z.unknown()),
  }).passthrough()),
  nextCursor: z.string().nullable(),
});

const codexThreadIdSchema = z.object({
  thread: z.object({ id: z.string() }).passthrough(),
});

const codexTurnIdSchema = z.object({
  turn: z.object({ id: z.string() }).passthrough(),
});

const codexDeltaNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    delta: z.string(),
  })
  .passthrough();

const codexCompletedNotificationSchema = z
  .object({
    threadId: z.string(),
    turn: z
      .object({
        id: z.string(),
        status: codexTurnStatusSchema,
        error: z.object({ message: z.string() }).passthrough().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

const codexFailedNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    error: z.object({ message: z.string() }).passthrough(),
  })
  .passthrough();

const codexTokenBreakdownSchema = z.object({
  totalTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
});

const codexTokenUsageNotificationSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  tokenUsage: z.object({
    total: codexTokenBreakdownSchema,
    last: codexTokenBreakdownSchema,
    modelContextWindow: z.number().int().positive().nullable(),
  }),
});

const codexRateLimitWindowSchema = z.object({
  usedPercent: z.number().min(0).max(100),
  windowDurationMins: z.number().int().positive().nullable().optional(),
  resetsAt: z.number().int().nonnegative().nullable().optional(),
});

const codexAccountRateLimitsSchema = z.object({
  rateLimits: z.object({
    planType: z.string().nullable().optional(),
    primary: codexRateLimitWindowSchema.nullable().optional(),
    secondary: codexRateLimitWindowSchema.nullable().optional(),
  }),
});

const codexCommandApprovalSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    startedAtMs: z.number(),
    approvalId: z.string().nullable().optional(),
    environmentId: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    command: z.string().nullable().optional(),
    cwd: z.string().nullable().optional(),
    commandActions: z.array(z.unknown()).nullable().optional(),
    proposedExecpolicyAmendment: z.unknown().nullable().optional(),
    proposedNetworkPolicyAmendments: z.array(z.unknown()).nullable().optional(),
  })
  .passthrough();

const codexFileApprovalSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  startedAtMs: z.number(),
  reason: z.string().nullable().optional(),
});

const codexNetworkPermissionsSchema = z
  .object({
    enabled: z.boolean().nullable(),
  })
  .passthrough();

const codexFileSystemPermissionsSchema = z
  .object({
    read: z.array(z.string()).nullable(),
    write: z.array(z.string()).nullable(),
  })
  .passthrough();

const codexRequestedPermissionsSchema = z
  .object({
    network: codexNetworkPermissionsSchema.nullable(),
    fileSystem: codexFileSystemPermissionsSchema.nullable(),
  })
  .passthrough();

const codexPermissionsApprovalSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    environmentId: z.string().nullable(),
    startedAtMs: z.number(),
    cwd: z.string(),
    reason: z.string().nullable(),
    permissions: codexRequestedPermissionsSchema,
  })
  .passthrough();

export type CodexThreadSnapshot = z.infer<typeof codexThreadSchema>;

export type CodexNotification =
  | {
      type: "messageDelta";
      partType: "text" | "reasoning";
      params: z.infer<typeof codexDeltaNotificationSchema>;
    }
  | {
      type: "turnCompleted";
      params: z.infer<typeof codexCompletedNotificationSchema>;
    }
  | {
      type: "turnFailed";
      params: z.infer<typeof codexFailedNotificationSchema>;
    }
  | {
      type: "tokenUsage";
      params: z.infer<typeof codexTokenUsageNotificationSchema>;
    };

export type CodexApprovalRequest =
  | {
      type: "command";
      requestId: CodexRequestId;
      params: z.infer<typeof codexCommandApprovalSchema>;
    }
  | {
      type: "file";
      requestId: CodexRequestId;
      params: z.infer<typeof codexFileApprovalSchema>;
    }
  | {
      type: "permissions";
      requestId: CodexRequestId;
      params: z.infer<typeof codexPermissionsApprovalSchema>;
    };

export const readCodexModels = (value: unknown): CodingAgentModel[] =>
  codexModelListSchema
    .parse(value)
    .data.filter((model) => !model.hidden)
    .map((model) => ({
      providerId: "openai",
      providerName: "Codex",
      modelId: model.id,
      modelName: model.displayName,
      reasoningVariants: model.supportedReasoningEfforts.map(
        ({ reasoningEffort }) => reasoningEffort,
      ),
      isDefault: model.isDefault,
    }));

export const readCodexThread = (value: unknown): CodexThreadSnapshot =>
  codexThreadResponseSchema.parse(value).thread;

const toMilliseconds = (timestamp: number | null): number =>
  timestamp === null ? 0 : timestamp * 1_000;

const codexToolStatuses: Record<string, CodingAgentToolCall["status"]> = {
  inProgress: "running",
  completed: "completed",
  failed: "error",
  declined: "error",
};

const readCodexToolStatus = (status: unknown): CodingAgentToolCall["status"] =>
  typeof status === "string" && status in codexToolStatuses
    ? codexToolStatuses[status]
    : "running";

const readCommandTitle = (item: Record<string, unknown>): string => {
  const command = item.command;
  if (typeof command === "string") return command;
  if (Array.isArray(command)) {
    return command.filter((part) => typeof part === "string").join(" ");
  }
  return "Command execution";
};

const readStringField = (item: Record<string, unknown>, field: string) => {
  const value = item[field];
  return typeof value === "string" ? value : "";
};

const toCodexToolCall = (item: {
  type: string;
  id?: string;
}): CodingAgentToolCall | null => {
  const record = item as Record<string, unknown>;
  const id = item.id ?? `${item.type}:tool`;
  if (item.type === "commandExecution") {
    return {
      id,
      tool: "bash",
      status: readCodexToolStatus(record.status),
      title: readCommandTitle(record),
      detail: readStringField(record, "aggregatedOutput"),
    };
  }
  if (item.type === "fileChange") {
    const rawChanges = Array.isArray(record.changes) ? record.changes : [];
    const paths = rawChanges
      .map((change) =>
        change &&
        typeof change === "object" &&
        "path" in change &&
        typeof change.path === "string"
          ? change.path
          : null,
      )
      .filter((path): path is string => path !== null);
    return {
      id,
      tool: "edit",
      status: readCodexToolStatus(record.status),
      title: paths.length > 0 ? paths.join(", ") : "File changes",
      detail: "",
    };
  }
  if (item.type === "mcpToolCall") {
    const server = readStringField(record, "server");
    const tool = readStringField(record, "tool");
    return {
      id,
      tool: "mcp",
      status: readCodexToolStatus(record.status),
      title: server && tool ? `${server} · ${tool}` : "MCP tool call",
      detail: "",
    };
  }
  if (item.type === "webSearch") {
    return {
      id,
      tool: "web_search",
      status: "completed",
      title: readStringField(record, "query") || "Web search",
      detail: "",
    };
  }
  return null;
};

export const readCodexMessages = (
  thread: CodexThreadSnapshot,
): CodingAgentMessage[] => {
  const messages: CodingAgentMessage[] = [];

  for (const turn of thread.turns) {
    const userItems = turn.items.filter((item) => item.type === "userMessage");

    if (userItems.length > 0) {
      const firstUserItem = userItems[0];
      messages.push({
        id: firstUserItem.id ?? `${turn.id}:user`,
        role: "user",
        content: userItems
          .flatMap((item) => item.content ?? [])
          .filter(
            (input): input is typeof input & { text: string } =>
              typeof input !== "string" &&
              input.type === "text" &&
              input.text !== undefined,
          )
          .map((input) => input.text)
          .join("\n"),
        reasoning: "",
        tools: [],
        createdAt: toMilliseconds(turn.startedAt),
        completedAt: null,
      });
    }

    const assistantMessages: CodingAgentMessage[] = [];
    let pendingReasoning: string[] = [];
    let pendingReasoningId: string | undefined;
    let pendingTools: CodingAgentToolCall[] = [];

    for (const item of turn.items) {
      if (item.type === "reasoning") {
        const summary = item.summary ?? [];
        const content = (item.content ?? []).filter(
          (part): part is string => typeof part === "string",
        );
        pendingReasoning.push(...(summary.length > 0 ? summary : content));
        pendingReasoningId ??= item.id;
        continue;
      }
      if (item.type !== "agentMessage") {
        const toolCall = toCodexToolCall(item);
        if (toolCall) pendingTools.push(toolCall);
        continue;
      }

      assistantMessages.push({
        id: item.id ?? `${turn.id}:assistant:${assistantMessages.length}`,
        role: "assistant",
        content: item.text ?? "",
        reasoning: pendingReasoning.join("\n"),
        tools: pendingTools,
        createdAt: toMilliseconds(turn.startedAt),
        completedAt: null,
      });
      pendingReasoning = [];
      pendingReasoningId = undefined;
      pendingTools = [];
    }

    if (pendingReasoning.length > 0 || pendingTools.length > 0) {
      assistantMessages.push({
        id:
          pendingReasoningId ??
          `${turn.id}:reasoning:${assistantMessages.length}`,
        role: "assistant",
        content: "",
        reasoning: pendingReasoning.join("\n"),
        tools: pendingTools,
        createdAt: toMilliseconds(turn.startedAt),
        completedAt: null,
      });
    }

    const completedAt =
      turn.completedAt === null ? null : toMilliseconds(turn.completedAt);
    assistantMessages.forEach((message, index) => {
      message.completedAt =
        completedAt ??
        (index < assistantMessages.length - 1 ? message.createdAt : null);
      messages.push(message);
    });
  }

  return messages;
};

const collectDiffs = (
  turns: CodexThreadSnapshot["turns"],
): CodingAgentDiff[] => {
  const seenFiles = new Set<string>();
  const diffs: CodingAgentDiff[] = [];

  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type !== "fileChange") continue;
      for (const change of item.changes ?? []) {
        if (seenFiles.has(change.path)) continue;
        seenFiles.add(change.path);
        diffs.push({
          file: change.path,
          before: "",
          after: "",
          additions: 0,
          deletions: 0,
        });
      }
    }
  }

  return diffs;
};

export const readCodexDiffs = (
  thread: CodexThreadSnapshot,
): { session: CodingAgentDiff[]; turn: CodingAgentDiff[] } => ({
  session: collectDiffs(thread.turns),
  turn: collectDiffs(thread.turns.slice(-1)),
});

export const readCodexAccountUsage = (
  value: unknown,
): {
  planType?: string;
  windows: Array<{
    durationMinutes: number | null;
    remainingPercentage: number;
    resetsAt: number | null;
  }>;
} => {
  const rateLimits = codexAccountRateLimitsSchema.parse(value).rateLimits;
  const windows = [rateLimits.primary, rateLimits.secondary]
    .filter(
      (window): window is NonNullable<typeof window> =>
        window !== null && window !== undefined,
    )
    .map((window) => ({
      durationMinutes: window.windowDurationMins ?? null,
      remainingPercentage: 100 - window.usedPercent,
      resetsAt:
        window.resetsAt === undefined || window.resetsAt === null
          ? null
          : window.resetsAt * 1_000,
    }));
  return {
    ...(rateLimits.planType ? { planType: rateLimits.planType } : {}),
    windows,
  };
};

export const readCodexMcpServerStatuses = (value: unknown): Array<{ name: string; healthy: boolean; toolNames: string[] }> =>
  codexMcpServerStatusListSchema.parse(value).data.map((server) => ({
    name: server.name,
    healthy: server.runtimeStatus === "connected",
    toolNames: Object.keys(server.tools),
  }));

export const readCodexThreadId = (value: unknown): string | null => {
  const result = codexThreadIdSchema.safeParse(value);
  return result.success ? result.data.thread.id : null;
};

export const readCodexTurnId = (value: unknown): string | null => {
  const result = codexTurnIdSchema.safeParse(value);
  return result.success ? result.data.turn.id : null;
};

export const readCodexNotification = (
  method: string,
  params: unknown,
): CodexNotification | null => {
  if (method === "thread/tokenUsage/updated") {
    return {
      type: "tokenUsage",
      params: codexTokenUsageNotificationSchema.parse(params),
    };
  }
  if (method === "item/agentMessage/delta") {
    return {
      type: "messageDelta",
      partType: "text",
      params: codexDeltaNotificationSchema.parse(params),
    };
  }
  if (
    method === "item/reasoning/summaryTextDelta" ||
    method === "item/reasoning/textDelta"
  ) {
    return {
      type: "messageDelta",
      partType: "reasoning",
      params: codexDeltaNotificationSchema.parse(params),
    };
  }
  if (method === "turn/completed") {
    return {
      type: "turnCompleted",
      params: codexCompletedNotificationSchema.parse(params),
    };
  }
  if (method === "turn/failed") {
    return {
      type: "turnFailed",
      params: codexFailedNotificationSchema.parse(params),
    };
  }
  return null;
};

export const readCodexApprovalRequest = (
  method: string,
  requestId: CodexRequestId,
  params: unknown,
): CodexApprovalRequest | null => {
  if (method === "item/commandExecution/requestApproval") {
    return {
      type: "command",
      requestId,
      params: codexCommandApprovalSchema.parse(params),
    };
  }
  if (method === "item/fileChange/requestApproval") {
    return {
      type: "file",
      requestId,
      params: codexFileApprovalSchema.parse(params),
    };
  }
  if (method === "item/permissions/requestApproval") {
    return {
      type: "permissions",
      requestId,
      params: codexPermissionsApprovalSchema.parse(params),
    };
  }
  return null;
};
