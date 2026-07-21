import { describe, expect, it } from 'vitest';
import { calculateDiffStats } from './diff-stats';

describe('calculateDiffStats', () => {
  it('counts every line in a newly created file as an addition', () => {
    expect(calculateDiffStats('', '# Title\n\nNew content\n')).toEqual({
      additions: 3,
      deletions: 0,
    });
  });

  it('counts changed and appended lines without treating a trailing newline as content', () => {
    expect(
      calculateDiffStats(
        'unchanged\nold value\nremoved\n',
        'unchanged\nnew value\nadded\n',
      ),
    ).toEqual({ additions: 2, deletions: 2 });
  });
});
