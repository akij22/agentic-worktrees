import { LoaderCircle } from 'lucide-react';

export const AuthBootstrap = () => (
  <main className="flex h-screen w-screen items-center justify-center bg-background">
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 text-sm text-muted-foreground"
    >
      <LoaderCircle className="size-5 animate-spin" />
      Checking GitHub connection…
    </div>
  </main>
);
