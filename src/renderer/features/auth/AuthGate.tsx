import type { ReactNode } from 'react';
import { AuthBootstrap } from './AuthBootstrap';
import { GitHubLogin } from './GitHubLogin';
import { GitHubAuthProvider, useGitHubAuth } from './useGitHubAuth';

const AuthGateContent = ({ children }: { children: ReactNode }) => {
  const auth = useGitHubAuth();
  if (auth.view === 'loading') return <AuthBootstrap />;

  return auth.view === 'app' ? (
    <div className="h-screen w-screen animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out">
      {children}
    </div>
  ) : (
    <GitHubLogin />
  );
};

export const AuthGate = ({ children }: { children: ReactNode }) => (
  <GitHubAuthProvider>
    <AuthGateContent>{children}</AuthGateContent>
  </GitHubAuthProvider>
);
