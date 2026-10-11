import * as React from 'react';
import { cn } from '../../lib/utils';

type Variant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'ghost';
type Size = 'default' | 'sm' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  default:
    'border border-primary/70 bg-primary text-primary-foreground shadow-sm hover:border-primary hover:bg-primary/90',
  secondary:
    'border border-border bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
  destructive:
    'border border-destructive-foreground/15 bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/85',
  outline:
    'border border-border bg-surface-raised/55 text-foreground shadow-xs hover:border-border hover:bg-accent hover:text-accent-foreground',
  ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
};

const sizes: Record<Size, string> = {
  default: 'h-9 px-4 py-2 text-sm',
  sm: 'h-8 rounded-md px-3 text-xs',
  lg: 'h-10 rounded-lg px-6 text-sm',
  icon: 'h-9 w-9',
};

export interface ButtonProps
  extends React.ComponentProps<'button'> {
  variant?: Variant;
  size?: Size;
}

const Button = ({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonProps) => (
  <button
    className={cn(
      'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold tracking-[-0.005em] transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:stroke-[1.8]',
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  />
);

export { Button };
