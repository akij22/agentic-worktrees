import { App, type Octokit } from 'octokit';
import { getEnvConfig } from '../config/env';

let installationOctokit: Octokit | null = null;

const hasAccessToken = (value: unknown): value is { token: string } =>
  typeof value === 'object' &&
  value !== null &&
  'token' in value &&
  typeof value.token === 'string' &&
  value.token.length > 0;

export const getInstallationOctokit = async (): Promise<Octokit> => {
  if (installationOctokit) {
    return installationOctokit;
  }

  const config = getEnvConfig();

  const app = new App({
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
  });

  installationOctokit = await app.getInstallationOctokit(
    config.githubAppInstallationId,
  );

  return installationOctokit;
};

/**
 * Returns the short-lived installation token used by GitHub App API clients.
 * Git operations do not share Octokit's authentication automatically, so the
 * token is also required when cloning or fetching private repositories.
 */
export const getInstallationAccessToken = async (): Promise<string> => {
  const octokit = await getInstallationOctokit();
  const authentication = await octokit.auth({ type: 'installation' });

  if (!hasAccessToken(authentication)) {
    throw new Error('Unable to obtain a GitHub App installation access token.');
  }

  return authentication.token;
};
