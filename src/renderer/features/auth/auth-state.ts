import type {
  GitHubAuthStatusDto,
  GitHubDeviceChallengeDto,
} from '../../../shared/ipc/schemas';

export interface AuthState {
  status: GitHubAuthStatusDto;
  challenge: GitHubDeviceChallengeDto | null;
  error: string | null;
  busy: boolean;
  operationId: number;
}

export type AuthView =
  | 'loading'
  | 'sign-in'
  | 'authorization'
  | 'installation'
  | 'app'
  | 'error';

export type AuthAction =
  | { type: 'operationStarted'; operationId: number }
  | { type: 'statusResolved'; status: GitHubAuthStatusDto; operationId: number }
  | { type: 'statusChanged'; status: GitHubAuthStatusDto }
  | { type: 'loginStarted'; challenge: GitHubDeviceChallengeDto; operationId: number }
  | { type: 'loggedOut'; status: GitHubAuthStatusDto; operationId: number }
  | { type: 'terminalFailure'; message: string; operationId: number };

const emptyStatus = (state: GitHubAuthStatusDto['state']): GitHubAuthStatusDto => ({
  state,
  profile: null,
  installationCount: 0,
  persistent: false,
  message: null,
  errorCode: null,
  recoverable: false,
});

export const createInitialAuthState = (): AuthState => ({
  status: emptyStatus('loading'),
  challenge: null,
  error: null,
  busy: false,
  operationId: 0,
});

const isStale = (state: AuthState, operationId: number): boolean =>
  operationId !== state.operationId;

export const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'operationStarted':
      return {
        ...state,
        busy: true,
        error: null,
        operationId: action.operationId,
      };
    case 'statusResolved':
      if (isStale(state, action.operationId)) return state;
      return {
        status: action.status,
        challenge:
          action.status.state === 'authorizing' ? state.challenge : null,
        error: action.status.state === 'error' ? action.status.message : null,
        busy: false,
        operationId: state.operationId,
      };
    case 'statusChanged':
      return {
        status: action.status,
        challenge: action.status.state === 'authorizing' ? state.challenge : null,
        error: action.status.state === 'error' ? action.status.message : null,
        busy: false,
        operationId: state.operationId + 1,
      };
    case 'loginStarted':
      if (isStale(state, action.operationId)) return state;
      return {
        status: emptyStatus('authorizing'),
        challenge: action.challenge,
        error: null,
        busy: false,
        operationId: state.operationId,
      };
    case 'loggedOut':
      if (isStale(state, action.operationId)) return state;
      return {
        status: action.status,
        challenge: null,
        error: null,
        busy: false,
        operationId: state.operationId,
      };
    case 'terminalFailure':
      if (isStale(state, action.operationId)) return state;
      return {
        status: emptyStatus('signed_out'),
        challenge: null,
        error: action.message,
        busy: false,
        operationId: state.operationId,
      };
  }
};

export type AuthActionErrorKind = 'clipboard' | 'external';

export const getUserFacingAuthActionError = (
  kind: AuthActionErrorKind,
): string =>
  kind === 'clipboard'
    ? 'Could not copy the code. Copy it manually and try again.'
    : 'Could not open GitHub. Try again.';

export const getUserFacingAuthFailure = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(
    /^Error invoking remote method 'github:auth-[^']+': Error:\s*/,
    '',
  );
};

export const getAuthView = (state: AuthState): AuthView => {
  switch (state.status.state) {
    case 'loading':
      return 'loading';
    case 'signed_out':
      return 'sign-in';
    case 'authorizing':
      return 'authorization';
    case 'installation_required':
      return 'installation';
    case 'authenticated':
      return 'app';
    case 'error':
      return 'error';
  }
};
