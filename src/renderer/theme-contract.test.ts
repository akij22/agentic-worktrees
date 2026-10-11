import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  new URL('../index.css', import.meta.url),
  'utf8',
);
const light = stylesheet.split(':root {')[1].split('\n}')[0];
const dark = stylesheet.split('.dark {')[1].split('\n}')[0];

describe('Vercel color theme contract', () => {
  it('provides separate light and dark palettes with matching primary contrast', () => {
    expect(light).toContain('color-scheme: light;');
    expect(light).toContain('--background: oklch(0.9900 0 0);');
    expect(light).toContain('--primary: oklch(0 0 0);');
    expect(light).toContain('--primary-foreground: oklch(1 0 0);');
    expect(dark).toContain('color-scheme: dark;');
    expect(dark).toContain('--background: oklch(0 0 0);');
    expect(dark).toContain('--primary: oklch(1 0 0);');
    expect(dark).toContain('--primary-foreground: oklch(0 0 0);');
  });

  it('maps app surfaces to the palette so they follow theme changes', () => {
    expect(light).toContain('--toolbar: var(--card);');
    expect(light).toContain('--message-surface: var(--accent);');
    expect(light).toContain('--sidebar-row-selected: var(--sidebar-primary);');
    expect(light).toContain('--panel-shadow: var(--shadow-sm);');
    expect(stylesheet).toContain('border: 1px solid var(--border);');
  });

  it('loads local Geist fonts and retains xterm-compatible colors in both themes', () => {
    const entry = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
    expect(entry).toContain("import '@fontsource-variable/geist';");
    expect(entry).toContain("import '@fontsource-variable/geist-mono';");
    expect(light).toContain('--font-sans: "Geist Variable", Geist, sans-serif;');
    expect(light).toContain('--radius: 0.5rem;');
    expect(light).toContain('--tracking-normal: 0em;');
    for (const palette of [light, dark]) {
      for (const token of ['background', 'foreground', 'cursor', 'selection', 'scrollbar', 'scrollbar-hover']) {
        expect(palette).toMatch(new RegExp(`--terminal-${token}: #[0-9a-f]{6};`));
      }
    }
  });
});
