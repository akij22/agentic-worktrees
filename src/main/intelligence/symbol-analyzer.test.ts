import { describe, expect, it } from 'vitest';
import { analyzeChangedSymbols } from './symbol-analyzer';
import type { ChangedRange } from './types';

const changedLine = (line: number): ChangedRange => ({
  oldStart: line,
  oldLines: 1,
  newStart: line,
  newLines: 1,
});

describe('changed symbol analyzer', () => {
  it('maps a changed range to the smallest qualified declaration', () => {
    const content = [
      'class SessionService {',
      '  createSession() {',
      "    return 'created';",
      '  }',
      '}',
      '',
    ].join('\n');

    expect(
      analyzeChangedSymbols({
        path: 'src/session.ts',
        content,
        ranges: [changedLine(3)],
      }),
    ).toEqual([
      expect.objectContaining({
        kind: 'method',
        name: 'createSession',
        qualifiedName: 'SessionService.createSession',
        declarationStart: 2,
        declarationEnd: 4,
        changedStart: 3,
        changedEnd: 3,
      }),
    ]);
  });

  it('distinguishes identical method names under different classes', () => {
    const content = [
      'class First {',
      '  run() { return 1; }',
      '}',
      'class Second {',
      '  run() { return 2; }',
      '}',
    ].join('\n');

    const symbols = analyzeChangedSymbols({
      path: 'src/runners.ts',
      content,
      ranges: [changedLine(2), changedLine(5)],
    });

    expect(symbols.map(({ qualifiedName }) => qualifiedName)).toEqual([
      'First.run',
      'Second.run',
    ]);
  });

  it('extracts function-valued variables and type declarations', () => {
    const content = [
      'type SessionState = { ready: boolean };',
      'const loadData = async () => {',
      '  return true;',
      '};',
    ].join('\n');

    const symbols = analyzeChangedSymbols({
      path: 'src/state.ts',
      content,
      ranges: [changedLine(1), changedLine(3)],
    });

    expect(symbols.map(({ name }) => name)).toEqual([
      'SessionState',
      'loadData',
    ]);
    expect(symbols.map(({ kind }) => kind)).toEqual([
      'type',
      'function-variable',
    ]);
  });

  it('uses the class when a changed line is outside all class methods', () => {
    const content = [
      'class SessionService {',
      '  value = 1;',
      '}',
    ].join('\n');

    expect(
      analyzeChangedSymbols({
        path: 'src/session.ts',
        content,
        ranges: [changedLine(1)],
      }),
    ).toEqual([
      expect.objectContaining({
        kind: 'class',
        qualifiedName: 'SessionService',
      }),
    ]);
  });

  it('returns no symbols for unsupported or malformed source', () => {
    expect(
      analyzeChangedSymbols({
        path: 'README.md',
        content: '# Session',
        ranges: [changedLine(1)],
      }),
    ).toEqual([]);
    expect(
      analyzeChangedSymbols({
        path: 'src/broken.ts',
        content: 'class {',
        ranges: [changedLine(1)],
      }),
    ).toEqual([]);
  });
});
