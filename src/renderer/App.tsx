import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { CodingAgent } from './pages/CodingAgent';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { AuthGate } from './features/auth/AuthGate';

export const App = () => (
  <AuthGate>
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/coding-agent" element={<CodingAgent />} />
          <Route path="/coding-agent/:worktreeId/:runId" element={<CodingAgent />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  </AuthGate>
);
