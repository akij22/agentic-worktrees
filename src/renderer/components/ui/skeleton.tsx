import { cn } from '../../lib/utils';

export const Skeleton = ({ className }: { className?: string }) => (
  <div
    className={cn(
      'animate-pulse rounded-lg bg-[linear-gradient(110deg,var(--muted)_8%,var(--surface-raised)_18%,var(--muted)_33%)] bg-[length:200%_100%]',
      className,
    )}
  />
);
