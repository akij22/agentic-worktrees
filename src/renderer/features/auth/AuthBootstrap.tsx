import { LoaderCircle } from 'lucide-react';
import { useTheme } from '../../lib/use-theme';

export const AuthBootstrap = () => {
  useTheme();

  return (
    <main className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 text-sm text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_16px_40px_-28px_rgba(0,0,0,0.9)]"
      >
        <LoaderCircle className="size-5 animate-spin text-primary" />
        Checking GitHub connection…
      </div>
    </main>
  );
};
