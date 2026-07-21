import { z } from 'zod';
import type {
  CodingAgentDiff,
  CodingAgentMessage,
  CodingAgentModel,
} from './types';
import type { CodexRequestId } from './codex-app-server-client';

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
    if (input.type === 'text' && input.text === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Codex text input is missing text',
        path: ['text'],
      });
    }
  });

const codexFileChangeSchema = z.object({
  path: z.string(),
}).passthrough();

const codexThreadItemSchema = z
  .object({
    type: z.string(),
    id: z.string().optional(),
    content: z.array(codexUserInputSchema).optional(),
    text: z.string().optional(),
    phase: z.string().nullable().optional(),
    summary: z.array(z.string()).optional(),
    changes: z.array(codexFileChangeSchema).optional(),
  })
  .passthrough()
  .superRefine((item, context) => {
    const requireField = (
      field: 'id' | 'content' | 'text' | 'summary' | 'changes',
    ) => {
      if (item[field] === undefined) {
        context.addIssue({
          code: 'custom',
          message: `Codex ${item.type} item is missing ${field}`,
          path: [field],
        });
      }
    };

    if (item.type === 'userMessage') {
      requireField('id');
      requireField('content');
    } else if (item.type === 'agentMessage') {
      requireField('id');
      requireField('text');
    } else if (item.type === 'reasoning') {
      requireField('id');
      requireField('summary');
    } else if (item.type === 'fileChange') {
      requireField('id');
      requireField('changes');
    }
  });

const codexTurnStatusSchema = z.enum([
  'completed',
  'interrupted',
  'failed',
  'inProgress',
]);

const codexTurnSchema = z.object({
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
}).passthrough();

const codexThreadStatusSchema = z
  .object({
    type: z.enum(['notLoaded', 'idle', 'systemError', 'active']),
  })
  .passthrough();

const codexThreadSchema = z.object({
  id: z.string(),
  status: codexThreadStatusSchema,
  turns: z.array(codexTurnSchema),
}).passthrough();

const codexThreadResponseSchema = z.object({
  thread: codexThreadSchema,
});

const codexThreadIdSchema = z.object({
  thread: z.object({ id: z.string() }).passthrough(),
});

const codexTurnIdSchema = z.object({
  turn: z.object({ id: z.string() }).passthrough(),
});

const codexDeltaNotificationSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  delta: z.string(),
}).passthrough();

const codexCompletedNotificationSchema = z.object({
  threadId: z.string(),
  turn: z
    .object({
      id: z.string(),
      status: codexTurnStatusSchema,
      error: z
        .object({ message: z.string() })
        .passthrough()
        .nullable(),
    })
    .passthrough(),
}).passthrough();

const codexFailedNotificationSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  error: z.object({ message: z.string() }).passthrough(),
}).passthrough();

const codexCommandApprovalSchema = z.object({
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
}).passthrough();

const codexFileApprovalSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  startedAtMs: z.number(),
  reason: z.string().nullable().optional(),
});

const codexNetworkPermissionsSchema = z.object({
  enabled: z.boolean().nullable(),
}).passthrough();

const codexFileSystemPermissionsSchema = z.object({
  read: z.array(z.string()).nullable(),
  write: z.array(z.string()).nullable(),
}).passthrough();

const codexRequestedPermissionsSchema = z.object({
  network: codexNetworkPermissionsSchema.nullable(),
  fileSystem: codexFileSystemPermissionsSchema.nullable(),
}).passthrough();

const codexPermissionsApprovalSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  environmentId: z.string().nullable(),
  startedAtMs: z.number(),
  cwd: z.string(),
  reason: z.string().nullable(),
  permissions: codexRequestedPermissionsSchema,
}).passthrough();

export type CodexThreadSnapshot = z.infer<typeof codexThreadSchema>;

export type CodexNotification =
  | {
      type: 'messageDelta';
      partType: 'text' | 'reasoning';
      params: z.infer<typeof codexDeltaNotificationSchema>;
    }
  | {
      type: 'turnCompleted';
      params: z.infer<typeof codexCompletedNotificationSchema>;
    }
  | {
      type: 'turnFailed';
      params: z.infer<typeof codexFailedNotificationSchema>;
    };

export type CodexApprovalRequest =
  | {
      type: 'command';
      requestId: CodexRequestId;
      params: z.infer<typeof codexCommandApprovalSchema>;
    }
  | {
      type: 'file';
      requestId: CodexRequestId;
      params: z.infer<typeof codexFileApprovalSchema>;
    }
  | {
      type: 'permissions';
      requestId: CodexRequestId;
      params: z.infer<typeof codexPermissionsApprovalSchema>;
    };

export const readCodexModels = (value: unknown): CodingAgentModel[] =>
  codexModelListSchema
    .parse(value)
    .data.filter((model) => !model.hidden)
    .map((model) => ({
      providerId: 'openai',
      providerName: 'Codex',
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

export const readCodexMessages = (
  thread: CodexThreadSnapshot,
): CodingAgentMessage[] => {
  const messages: CodingAgentMessage[] = [];

  for (const turn of thread.turns) {
    const userItems = turn.items.filter((item) => item.type === 'userMessage');
    const agentItems = turn.items.filter((item) => item.type === 'agentMessage');
    const reasoning = turn.items
      .filter((item) => item.type === 'reasoning')
      .flatMap((item) => item.summary ?? [])
      .join('\n');

    if (userItems.length > 0) {
      const firstUserItem = userItems[0];
      messages.push({
        id: firstUserItem.id ?? `${turn.id}:user`,
        role: 'user',
        content: userItems
          .flatMap((item) => item.content ?? [])
          .filter(
            (input): input is typeof input & { text: string } =>
              input.type === 'text' && input.text !== undefined,
          )
          .map((input) => input.text)
          .join('\n'),
        reasoning: '',
        createdAt: toMilliseconds(turn.startedAt),
        completedAt: null,
      });
    }

    if (agentItems.length > 0) {
      const lastAgentItem = agentItems.at(-1);
      messages.push({
        id: lastAgentItem?.id ?? `${turn.id}:assistant`,
        role: 'assistant',
        content: agentItems
          .map((item) => item.text ?? '')
          .filter(Boolean)
          .join('\n'),
        reasoning,
        createdAt: toMilliseconds(turn.startedAt),
        completedAt:
          turn.completedAt === null
            ? null
            : toMilliseconds(turn.completedAt),
      });
    }
  }

  return messages;
};

const collectDiffs = (
  turns: CodexThreadSnapshot['turns'],
): CodingAgentDiff[] => {
  const seenFiles = new Set<string>();
  const diffs: CodingAgentDiff[] = [];

  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type !== 'fileChange') continue;
      for (const change of item.changes ?? []) {
        if (seenFiles.has(change.path)) continue;
        seenFiles.add(change.path);
        diffs.push({
          file: change.path,
          before: '',
          after: '',
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
  if (method === 'item/agentMessage/delta') {
    return {
      type: 'messageDelta',
      partType: 'text',
      params: codexDeltaNotificationSchema.parse(params),
    };
  }
  if (
    method === 'item/reasoning/summaryTextDelta' ||
    method === 'item/reasoning/textDelta'
  ) {
    return {
      type: 'messageDelta',
      partType: 'reasoning',
      params: codexDeltaNotificationSchema.parse(params),
    };
  }
  if (method === 'turn/completed') {
    return {
      type: 'turnCompleted',
      params: codexCompletedNotificationSchema.parse(params),
    };
  }
  if (method === 'turn/failed') {
    return {
      type: 'turnFailed',
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
  if (method === 'item/commandExecution/requestApproval') {
    return {
      type: 'command',
      requestId,
      params: codexCommandApprovalSchema.parse(params),
    };
  }
  if (method === 'item/fileChange/requestApproval') {
    return {
      type: 'file',
      requestId,
      params: codexFileApprovalSchema.parse(params),
    };
  }
  if (method === 'item/permissions/requestApproval') {
    return {
      type: 'permissions',
      requestId,
      params: codexPermissionsApprovalSchema.parse(params),
    };
  }
  return null;
};
