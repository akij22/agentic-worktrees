import type { ReactNode } from 'react';
import { GitHubLogin } from './GitHubLogin';
import { GitHubAuthProvider, useGitHubAuth } from './useGitHubAuth';

const AuthGateContent = ({ children }: { children: ReactNode }) => {
  const auth = useGitHubAuth();
  return auth.view === 'app' ? children : <GitHubLogin />;
};

export const AuthGate = ({ children }: { children: ReactNode }) => (
  <GitHubAuthProvider>
    <AuthGateContent>{children}</AuthGateContent>
  </GitHubAuthProvider>
);
