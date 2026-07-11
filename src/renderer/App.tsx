import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { CodingAgent } from './pages/CodingAgent';
import { Dashboard } from './pages/Dashboard';

export const App = () => (
  <HashRouter>
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/coding-agent" element={<CodingAgent />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  </HashRouter>
);
