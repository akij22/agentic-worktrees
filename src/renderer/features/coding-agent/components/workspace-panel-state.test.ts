import { describe, expect, it } from 'vitest';
import {
  getWorkspaceModeLabel,
  workspacePanelModes,
} from './workspace-panel-state';

describe('workspace panel state', () => {
  it('keeps the three user-facing modes in workflow order', () => {
    expect(workspacePanelModes).toEqual(['review', 'terminal', 'files']);
    expect(workspacePanelModes.map(getWorkspaceModeLabel)).toEqual([
      'Revisione',
      'Terminale',
      'File',
    ]);
  });
});
