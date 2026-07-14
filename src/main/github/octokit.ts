import type { Octokit } from 'octokit';
import { githubAuthService } from './auth-service';

export const getAuthenticatedOctokit = (): Promise<Octokit> =>
  githubAuthService.getOctokit();

export const getGitHubAccessToken = (): Promise<string> =>
  githubAuthService.getAccessToken();
