import * as React from 'react';
import { cn } from '../../lib/utils';

const Card = ({
  className,
  ...props
}: React.ComponentProps<'div'>) => (
  <div
    className={cn(
      'rounded-2xl bg-card text-card-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_20px_48px_-40px_rgba(112,185,238,0.5)]',
      className,
    )}
    {...props}
  />
);

const CardHeader = ({
  className,
  ...props
}: React.ComponentProps<'div'>) => (
  <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />
);

const CardTitle = ({
  className,
  ...props
}: React.ComponentProps<'div'>) => (
  <div
    className={cn('font-semibold leading-none tracking-tight', className)}
    {...props}
  />
);

const CardDescription = ({
  className,
  ...props
}: React.ComponentProps<'div'>) => (
  <div className={cn('text-sm text-muted-foreground', className)} {...props} />
);

const CardContent = ({
  className,
  ...props
}: React.ComponentProps<'div'>) => (
  <div className={cn('p-6 pt-0', className)} {...props} />
);

const CardFooter = ({
  className,
  ...props
}: React.ComponentProps<'div'>) => (
  <div className={cn('flex items-center p-6 pt-0', className)} {...props} />
);

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
