import { join } from "node:path";
import { nanoid } from "nanoid";
import { getEnvConfig } from "../config/env";
import { getDatabase } from "../database/client";
import { listLocalBranches } from "../git/local-branches";
import { createIntelligenceRepository } from "../intelligence/intelligence-repository";
import {
	getRepositoryById,
	listRepositories,
} from "../repositories/repository-service";
import { getWorktreeById } from "../worktrees/worktree-service";
import { createConflictIntelligenceService } from "./conflict-intelligence-service";
import { createConflictResolutionRepository } from "./conflict-resolution-repository";
import { createIntegrationGitAdapter } from "./integration-git-adapter";
import { createIntegrationWorktreeService } from "./integration-worktree-service";

const integrationRoot = join(getEnvConfig().workspaceRoot, ".integrations");
const git = createIntegrationGitAdapter({ integrationRoot });

export const conflictIntelligenceService = createConflictIntelligenceService({
	resolutionRepository: createConflictResolutionRepository(getDatabase()),
	intelligenceRepository: createIntelligenceRepository(getDatabase()),
	lifecycle: createIntegrationWorktreeService({ git }),
	getRepository: getRepositoryById,
	listRepositories,
	getWorktree: getWorktreeById,
	listBranches: listLocalBranches,
	createId: nanoid,
	now: Date.now,
});
