import { describe, expect, it } from 'vitest';
import {
  parseOpenCodeVersion,
  readOpenCodeSessionId,
  reserveLocalPort,
} from './opencode-utils';

describe('OpenCode utilities', () => {
  it('extracts a semantic version from CLI output', () => {
    expect(parseOpenCodeVersion('opencode 1.17.18\n')).toBe('1.17.18');
    expect(parseOpenCodeVersion('version: 2.0.0-beta.1')).toBe('2.0.0-beta.1');
    expect(parseOpenCodeVersion('not a version')).toBeNull();
  });

  it('reads session IDs from supported event shapes', () => {
    expect(readOpenCodeSessionId({ sessionID: 'ses_direct' })).toBe('ses_direct');
    expect(readOpenCodeSessionId({ info: { sessionID: 'ses_message' } })).toBe(
      'ses_message',
    );
    expect(readOpenCodeSessionId({ part: { sessionID: 'ses_part' } })).toBe(
      'ses_part',
    );
    expect(readOpenCodeSessionId({})).toBeNull();
  });

  it('allocates a valid local TCP port', async () => {
    const port = await reserveLocalPort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65_535);
  });
});
