import * as React from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'secondary' | 'outline' | 'destructive';

const variants: Record<Variant, string> = {
  default: 'border border-primary/25 bg-primary/15 text-primary',
  secondary: 'border border-white/[0.055] bg-secondary text-secondary-foreground',
  outline: 'border border-white/[0.075] bg-transparent text-muted-foreground',
  destructive:
    'border border-destructive-foreground/15 bg-destructive text-destructive-foreground',
};

export interface BadgeProps extends React.ComponentProps<'span'> {
  variant?: Variant;
}

export const Badge = ({
  className,
  variant = 'default',
  ...props
}: BadgeProps) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors [&_svg]:size-3',
      variants[variant],
      className,
    )}
    {...props}
  />
);
