export const getGitHubConfig = () => ({
  clientId: process.env.GITHUB_CLIENT_ID?.trim() ?? '',
  appSlug: process.env.GITHUB_APP_SLUG?.trim() ?? '',
  apiBaseUrl: 'https://api.github.com',
  webBaseUrl: 'https://github.com',
  apiVersion: '2026-03-10',
  refreshSkewMs: 5 * 60 * 1000,
  configured: Boolean(
    process.env.GITHUB_CLIENT_ID?.trim() &&
      process.env.GITHUB_APP_SLUG?.trim(),
  ),
} as const);

export const GITHUB_CONFIG = getGitHubConfig();
