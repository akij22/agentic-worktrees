import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  new URL('../index.css', import.meta.url),
  'utf8',
);

describe('premium theme contract', () => {
  it('uses layered graphite surfaces instead of a pure-black canvas', () => {
    expect(stylesheet).toContain('--background: #0c0d0f;');
    expect(stylesheet).toContain('--card: #131518;');
    expect(stylesheet).toContain('--sidebar: #0a0b0d;');
    expect(stylesheet).not.toContain('--background: #000000;');
  });

  it('defines the premium sans and restrained surface treatment', () => {
    expect(stylesheet).toContain('"Instrument Sans Variable"');
    expect(stylesheet).toContain('--surface-highlight: rgba(255, 255, 255, 0.055);');
    expect(stylesheet).toContain('--panel-shadow:');
  });

  it('centralizes the reusable panel surface in one component class', () => {
    expect(stylesheet).toContain('.surface-panel {');
    expect(stylesheet).toContain('background: var(--card);');
    expect(stylesheet).toContain('box-shadow: var(--panel-shadow);');
  });
});
