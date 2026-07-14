import { useRef, type ReactNode } from 'react';
import { CSSTransition, TransitionGroup } from 'react-transition-group';
import { type AuthView } from './auth-state';
import { GitHubLogin } from './GitHubLogin';
import { GitHubAuthProvider, useGitHubAuth } from './useGitHubAuth';

interface AuthTransitionProps {
  view: AuthView;
  children: ReactNode;
}

const AuthTransition = ({ view, children }: AuthTransitionProps) => {
  const isApp = view === 'app';
  const loginRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  return (
    <TransitionGroup component="div" className="relative h-screen w-screen overflow-hidden">
      {isApp ? (
        <CSSTransition
          key="app"
          nodeRef={appRef}
          timeout={250}
          classNames="auth-crossfade"
          unmountOnExit
        >
          <div ref={appRef} className="absolute inset-0">
            {children}
          </div>
        </CSSTransition>
      ) : (
        <CSSTransition
          key="login"
          nodeRef={loginRef}
          timeout={250}
          classNames="auth-crossfade"
          unmountOnExit
        >
          <div ref={loginRef} className="absolute inset-0">
            <GitHubLogin />
          </div>
        </CSSTransition>
      )}
    </TransitionGroup>
  );
};

const AuthGateContent = ({ children }: { children: ReactNode }) => {
  const auth = useGitHubAuth();
  return <AuthTransition view={auth.view}>{children}</AuthTransition>;
};

export const AuthGate = ({ children }: { children: ReactNode }) => (
  <GitHubAuthProvider>
    <AuthGateContent>{children}</AuthGateContent>
  </GitHubAuthProvider>
);