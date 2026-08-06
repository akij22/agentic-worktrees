import { describe, expect, it } from 'vitest';
import { findActiveFileMention, insertFileMention } from './file-mentions';

describe('file mention parsing', () => {
  it('detects an active mention at the start of the draft', () => {
    expect(findActiveFileMention('@src/app', 8)).toEqual({
      start: 0,
      end: 8,
      query: 'src/app',
    });
  });

  it('detects the mention at the caret while editing earlier text', () => {
    expect(findActiveFileMention('Review @Session before send', 15)).toEqual({
      start: 7,
      end: 15,
      query: 'Session',
    });
  });

  it('uses the nearest valid mention boundary', () => {
    expect(findActiveFileMention('Compare @first and @second', 26)).toEqual({
      start: 19,
      end: 26,
      query: 'second',
    });
  });

  it('does not treat email addresses or embedded at signs as mentions', () => {
    expect(findActiveFileMention('mail aki@example.com', 20)).toBeUndefined();
    expect(findActiveFileMention('prefix@src/App.tsx', 18)).toBeUndefined();
  });

  it('does not carry a mention across a newline', () => {
    expect(findActiveFileMention('@src/App.tsx\ncontinue', 21)).toBeUndefined();
  });
});

describe('file mention insertion', () => {
  it('replaces only the active mention and preserves surrounding text', () => {
    expect(
      insertFileMention(
        'Review @Ses please',
        { start: 7, end: 11, query: 'Ses' },
        'src/Session.tsx',
      ),
    ).toEqual({
      draft: 'Review @src/Session.tsx  please',
      caret: 24,
    });
  });

  it('quotes paths containing whitespace', () => {
    expect(
      insertFileMention(
        '@notes',
        { start: 0, end: 6, query: 'notes' },
        'docs/Session Notes.md',
      ),
    ).toEqual({
      draft: '@"docs/Session Notes.md" ',
      caret: 25,
    });
  });

  it('escapes quotes and backslashes inside quoted paths', () => {
    expect(
      insertFileMention(
        '@odd',
        { start: 0, end: 4, query: 'odd' },
        'docs/a "quoted" \\ path.md',
      ).draft,
    ).toBe('@"docs/a \\"quoted\\" \\\\ path.md" ');
  });
});
