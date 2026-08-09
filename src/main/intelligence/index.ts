import { listAgentSessions } from '../coding-agents/coding-agent-service';
import { getDatabase } from '../database/client';
import { listWorktreesForRepository } from '../worktrees/worktree-service';
import { createGitChangeCollector } from './git-change-collector';
import { createIntelligenceRepository } from './intelligence-repository';
import { createIntelligenceService } from './intelligence-service';

export const intelligenceService = createIntelligenceService({
  listWorktrees: listWorktreesForRepository,
  listSessions: () => listAgentSessions(),
  collector: createGitChangeCollector(),
  repository: createIntelligenceRepository(getDatabase()),
});
