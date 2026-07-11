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
