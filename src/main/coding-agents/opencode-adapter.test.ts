import { describe, expect, it } from 'vitest';
import { toOpenCodeRunStatus } from './opencode-adapter';

describe('toOpenCodeRunStatus', () => {
  it('maps an idle OpenCode session to an idle run', () => {
    expect(toOpenCodeRunStatus({ type: 'idle' })).toBe('idle');
  });

  it.each([
    { type: 'busy' as const },
    {
      type: 'retry' as const,
      attempt: 2,
      message: 'Provider is busy',
      next: Date.now() + 1_000,
    },
  ])('keeps active OpenCode status $type busy', (status) => {
    expect(toOpenCodeRunStatus(status)).toBe('busy');
  });

  it('treats a session omitted from the active status map as idle', () => {
    expect(toOpenCodeRunStatus(undefined)).toBe('idle');
  });
});
