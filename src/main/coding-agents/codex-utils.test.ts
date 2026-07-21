import { describe, expect, it } from 'vitest';
import { getCodexCandidates, parseCodexVersion } from './codex-utils';

describe('Codex utilities', () => {
  it('parses the official CLI version format', () => {
    expect(parseCodexVersion('codex-cli 0.144.3')).toBe('0.144.3');
    expect(parseCodexVersion('not codex')).toBeNull();
  });

  it('includes common Unix Codex install paths', () => {
    expect(getCodexCandidates()).toContain('/opt/homebrew/bin/codex');
    expect(getCodexCandidates()).toContain('/usr/local/bin/codex');
  });
});
