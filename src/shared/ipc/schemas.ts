import { z } from 'zod';
import type { Repository, Worktree } from '../db/schema';

export const githubListReposRequestSchema = z.object({
  refresh: z.boolean().optional().default(false),
});

export const githubListReposResponseSchema = z.array(
  z.custom<Repository>(),
);

export const remoteRepositorySchema = z.object({
  githubRepoId: z.number().int(),
  ownerLogin: z.string(),
  name: z.string(),
  fullName: z.string(),
  defaultBranch: z.string().nullable(),
  isPrivate: z.boolean(),
  isArchived: z.boolean(),
  cloneUrl: z.string(),
  sshUrl: z.string().nullable(),
  htmlUrl: z.string(),
});

export type RemoteRepositoryDto = z.infer<typeof remoteRepositorySchema>;

export const githubListRemoteReposResponseSchema = z.array(
  remoteRepositorySchema,
);

export const repositoryImportRemoteRequestSchema = z.object({
  repositoryIds: z.array(z.number().int()).min(1),
});

export const githubListBranchesRequestSchema = z.object({
  repositoryId: z.string().min(1),
});

export const branchSchema = z.object({
  name: z.string(),
  protected: z.boolean(),
  headCommitSha: z.string().nullable(),
});

export type BranchDto = z.infer<typeof branchSchema>;

export const githubListBranchesResponseSchema = z.array(branchSchema);

export const repositoryImportLocalResponseSchema = z.custom<Repository>().nullable();

export const worktreeCreateRequestSchema = z.object({
  repositoryId: z.string().min(1),
  baseBranch: z.string().min(1),
  newBranchName: z
    .string()
    .min(1)
    .regex(
      /^[a-zA-Z0-9._/-]+$/,
      'Branch name may only contain letters, numbers, ".", "/", and "-"',
    ),
  worktreeName: z.string().min(1),
});

export const worktreeCreateResponseSchema = z.object({
  worktree: z.custom<Worktree>(),
  repository: z.custom<Repository>(),
});

export const worktreeListRequestSchema = z.object({
  repositoryId: z.string().min(1),
});

export const worktreeListResponseSchema = z.array(z.custom<Worktree>());

export const editorIdSchema = z.enum([
  'vscode',
  'cursor',
  'zed',
  'webstorm',
  'intellij-idea',
  'sublime-text',
  'android-studio',
]);

export type EditorId = z.infer<typeof editorIdSchema>;

export const availableEditorSchema = z.object({
  id: editorIdSchema,
  name: z.string(),
});

export type AvailableEditorDto = z.infer<typeof availableEditorSchema>;

export const editorOpenRequestSchema = z.object({
  editorId: editorIdSchema,
  worktreeId: z.string().trim().min(1),
});

export type EditorOpenRequest = z.infer<typeof editorOpenRequestSchema>;

export const codingAgentWorktreeContextSchema = z.object({
  worktree: z.custom<Worktree>(),
  repository: z.custom<Repository>(),
});

export type CodingAgentWorktreeContextDto = z.infer<
  typeof codingAgentWorktreeContextSchema
>;

export const codingAgentStatusSchema = z.object({
  configured: z.boolean(),
  executablePath: z.string().nullable(),
  version: z.string().nullable(),
  running: z.boolean(),
  error: z.string().nullable(),
});

export type CodingAgentStatusDto = z.infer<typeof codingAgentStatusSchema>;

export const codingAgentModelSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  modelId: z.string(),
  modelName: z.string(),
  reasoningVariants: z.array(z.string()),
});

export type CodingAgentModelDto = z.infer<typeof codingAgentModelSchema>;

export const codingAgentSessionSchema = z.object({
  id: z.string(),
  worktreeId: z.string(),
  repositoryId: z.string(),
  title: z.string(),
  status: z.string(),
  errorMessage: z.string().nullable(),
  providerId: z.string(),
  modelId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type CodingAgentSessionDto = z.infer<typeof codingAgentSessionSchema>;

export const codingAgentMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  reasoning: z.string(),
  createdAt: z.number(),
  completedAt: z.number().nullable(),
});

export type CodingAgentMessageDto = z.infer<typeof codingAgentMessageSchema>;

export const codingAgentDiffSchema = z.object({
  file: z.string(),
  before: z.string(),
  after: z.string(),
  additions: z.number(),
  deletions: z.number(),
});

export type CodingAgentDiffDto = z.infer<typeof codingAgentDiffSchema>;

export const codingAgentSessionSnapshotSchema = z.object({
  session: codingAgentSessionSchema,
  context: codingAgentWorktreeContextSchema,
  messages: z.array(codingAgentMessageSchema),
  diff: z.array(codingAgentDiffSchema),
});

export type CodingAgentSessionSnapshotDto = z.infer<
  typeof codingAgentSessionSnapshotSchema
>;

export const codingAgentModelsRequestSchema = z.object({
  worktreeId: z.string().min(1),
});

export const codingAgentSessionListRequestSchema = z
  .object({ worktreeId: z.string().min(1).optional() })
  .optional()
  .default({});

export const codingAgentSessionCreateRequestSchema = z.object({
  worktreeId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
});

export const codingAgentSessionModelUpdateSchema = z.object({
  runId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});

export const codingAgentSessionGetRequestSchema = z.object({
  runId: z.string().min(1),
});

export const codingAgentSessionSendRequestSchema = z.object({
  runId: z.string().min(1),
  content: z.string().trim().min(1).max(100_000),
  reasoningVariant: z.string().trim().min(1).max(80).optional(),
});

export const codingAgentSessionAbortRequestSchema = z.object({
  runId: z.string().min(1),
});

export const codingAgentPermissionResponseSchema = z.object({
  runId: z.string().min(1),
  permissionId: z.string().min(1),
  response: z.enum(['once', 'always', 'reject']),
});

export const codingAgentUiEventSchema = z.object({
  runId: z.string().nullable(),
  type: z.string(),
  payload: z.unknown(),
});

export type CodingAgentUiEventDto = z.infer<typeof codingAgentUiEventSchema>;

export type GithubListReposRequest = z.infer<
  typeof githubListReposRequestSchema
>;
export type RepositoryImportRemoteRequest = z.infer<
  typeof repositoryImportRemoteRequestSchema
>;
export type GithubListBranchesRequest = z.infer<
  typeof githubListBranchesRequestSchema
>;
export type WorktreeCreateRequest = z.infer<typeof worktreeCreateRequestSchema>;
export type WorktreeCreateResponse = z.infer<
  typeof worktreeCreateResponseSchema
>;
export type WorktreeListRequest = z.infer<typeof worktreeListRequestSchema>;
