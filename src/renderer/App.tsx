import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useParams,
} from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Chat } from './pages/Chat';
import { Marketplace } from './pages/Marketplace';
import { Dashboard } from './pages/Dashboard';
import { Intelligence } from './pages/Intelligence';
import { Settings } from './pages/Settings';
import { AuthGate } from './features/auth/AuthGate';

const LegacyChatRedirect = () => {
  const { worktreeId, runId } = useParams();
  if (!worktreeId || !runId) {
    return <Navigate to="/chat" replace />;
  }
  return (
    <Navigate
      to={`/chat/${encodeURIComponent(worktreeId)}/${encodeURIComponent(runId)}`}
      replace
    />
  );
};

export const App = () => (
  <AuthGate>
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Chat />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/chat/:worktreeId/:runId" element={<Chat />} />
          <Route path="/worktrees" element={<Dashboard />} />
          <Route path="/intelligence" element={<Intelligence />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route
            path="/capabilities"
            element={<Navigate to="/marketplace" replace />}
          />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="/coding-agent"
            element={<Navigate to="/chat" replace />}
          />
          <Route
            path="/coding-agent/:worktreeId/:runId"
            element={<LegacyChatRedirect />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  </AuthGate>
);
