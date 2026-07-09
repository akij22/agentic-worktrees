import { App, type Octokit } from 'octokit';
import { getEnvConfig } from '../config/env';

let installationOctokit: Octokit | null = null;

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