import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  authReducer,
  createInitialAuthState,
  getAuthView,
  type AuthState,
  type AuthView,
  getUserFacingAuthActionError,
  getUserFacingAuthFailure,
} from './auth-state';

const errorMessage = (cause: unknown): string => getUserFacingAuthFailure(cause);

export interface GitHubAuthController {
  state: AuthState;
  view: AuthView;
  actionError: string | null;
  clearActionError: () => void;
  startLogin: () => Promise<void>;
  cancelLogin: () => Promise<void>;
  refreshInstallations: () => Promise<void>;
  retrySession: () => Promise<void>;
  logout: () => Promise<void>;
  openDeviceVerification: () => Promise<void>;
  openInstallation: () => Promise<void>;
  openAuthorizationSettings: () => Promise<void>;
}

const GitHubAuthContext = createContext<GitHubAuthController | null>(null);

const useGitHubAuthController = (): GitHubAuthController => {
  const [state, dispatch] = useReducer(authReducer, undefined, createInitialAuthState);
  const [actionError, setActionError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const operationRef = useRef(0);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void window.api.github.auth.getStatus().then(
      (status) => dispatch({ type: 'statusResolved', status, operationId: 0 }),
      (cause: unknown) =>
        dispatch({
          type: 'terminalFailure',
          message: errorMessage(cause),
          operationId: 0,
        }),
    );
  }, []);

  useEffect(() => window.api.github.auth.onStatusChanged((status) => {
    operationRef.current += 1;
    dispatch({ type: 'statusChanged', status });
  }), []);

  const resolveCompletion = useCallback(async (attempt: number) => {
    try {
      const status = await window.api.github.auth.completeLogin();
      dispatch({ type: 'statusResolved', status, operationId: attempt });
    } catch (cause) {
      dispatch({
        type: 'terminalFailure',
        message: errorMessage(cause),
        operationId: attempt,
      });
    }
  }, []);

  const startLogin = useCallback(async () => {
    const attempt = operationRef.current + 1;
    operationRef.current = attempt;
    setActionError(null);
    dispatch({ type: 'operationStarted', operationId: attempt });
    try {
      const challenge = await window.api.github.auth.startLogin();
      dispatch({ type: 'loginStarted', challenge, operationId: attempt });
      void resolveCompletion(attempt);
    } catch (cause) {
      dispatch({
        type: 'terminalFailure',
        message: errorMessage(cause),
        operationId: attempt,
      });
    }
  }, [resolveCompletion]);

  const cancelLogin = useCallback(async () => {
    const operationId = operationRef.current + 1;
    operationRef.current = operationId;
    setActionError(null);
    dispatch({ type: 'operationStarted', operationId });
    try {
      await window.api.github.auth.cancelLogin();
      const status = await window.api.github.auth.getStatus();
      dispatch({ type: 'statusResolved', status, operationId });
    } catch (cause) {
      dispatch({
        type: 'terminalFailure',
        message: errorMessage(cause),
        operationId,
      });
    }
  }, []);

  const refreshInstallations = useCallback(async () => {
    const operationId = operationRef.current + 1;
    operationRef.current = operationId;
    setActionError(null);
    dispatch({ type: 'operationStarted', operationId });
    try {
      const status = await window.api.github.auth.refreshInstallations();
      dispatch({ type: 'statusResolved', status, operationId });
    } catch (cause) {
      dispatch({
        type: 'terminalFailure',
        message: errorMessage(cause),
        operationId,
      });
    }
  }, []);

  const logout = useCallback(async () => {
    const operationId = operationRef.current + 1;
    operationRef.current = operationId;
    setActionError(null);
    dispatch({ type: 'operationStarted', operationId });
    try {
      const status = await window.api.github.auth.logout();
      dispatch({ type: 'loggedOut', status, operationId });
    } catch (cause) {
      dispatch({
        type: 'terminalFailure',
        message: errorMessage(cause),
        operationId,
      });
    }
  }, []);

  const retrySession = useCallback(async () => {
    const operationId = operationRef.current + 1;
    operationRef.current = operationId;
    setActionError(null);
    dispatch({ type: 'operationStarted', operationId });
    try {
      const status = await window.api.github.auth.retrySession();
      dispatch({ type: 'statusResolved', status, operationId });
    } catch {
      dispatch({
        type: 'statusResolved',
        status: {
          state: 'error', profile: null, installationCount: 0,
          persistent: state.status.persistent,
          message: 'GitHub is temporarily unreachable. Check your connection and retry.',
          errorCode: 'network', recoverable: true,
        },
        operationId,
      });
    }
  }, [state.status.persistent]);

  const runExternalAction = useCallback(async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch {
      setActionError(getUserFacingAuthActionError('external'));
    }
  }, []);

  const openDeviceVerification = useCallback(
    () => runExternalAction(window.api.github.auth.openDeviceVerification),
    [runExternalAction],
  );
  const openInstallation = useCallback(
    () => runExternalAction(window.api.github.auth.openInstallation),
    [runExternalAction],
  );
  const openAuthorizationSettings = useCallback(
    () => runExternalAction(window.api.github.auth.openAuthorizationSettings),
    [runExternalAction],
  );
  const clearActionError = useCallback(() => setActionError(null), []);

  return useMemo(
    () => ({
      state,
      view: getAuthView(state),
      actionError,
      clearActionError,
      startLogin,
      cancelLogin,
      refreshInstallations,
      retrySession,
      logout,
      openDeviceVerification,
      openInstallation,
      openAuthorizationSettings,
    }),
    [
      cancelLogin,
      actionError,
      clearActionError,
      logout,
      openAuthorizationSettings,
      openDeviceVerification,
      openInstallation,
      refreshInstallations,
      retrySession,
      startLogin,
      state,
    ],
  );
};

export const GitHubAuthProvider = ({ children }: { children: ReactNode }) => {
  const controller = useGitHubAuthController();
  return createElement(
    GitHubAuthContext.Provider,
    { value: controller },
    children,
  );
};

export const useGitHubAuth = (): GitHubAuthController => {
  const controller = useContext(GitHubAuthContext);
  if (!controller) {
    throw new Error('useGitHubAuth must be used inside GitHubAuthProvider.');
  }
  return controller;
};
