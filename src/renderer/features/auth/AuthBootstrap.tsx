import { LoaderCircle } from 'lucide-react';
import { useTheme } from '../../lib/use-theme';

export const AuthBootstrap = () => {
  useTheme();

  return (
    <main className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div
        role="status"
        aria-live="polite"
        className="surface-panel flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground"
      >
        <LoaderCircle className="size-5 animate-spin text-primary" />
        Checking GitHub connection…
      </div>
    </main>
  );
};
