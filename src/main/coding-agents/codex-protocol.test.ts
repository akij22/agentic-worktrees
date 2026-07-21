import { describe, expect, it } from 'vitest';
import {
  readCodexApprovalRequest,
  readCodexDiffs,
  readCodexMessages,
  readCodexModels,
  readCodexThread,
  readCodexThreadId,
} from './codex-protocol';

const threadWithTurns = (items: unknown[]) =>
  readCodexThread({
    thread: {
      id: 'thread-1',
      status: { type: 'idle' },
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          error: null,
          startedAt: 10,
          completedAt: 12,
          items,
        },
      ],
    },
  });

const threadWithFileChanges = (turnFiles: string[][]) =>
  readCodexThread({
    thread: {
      id: 'thread-1',
      status: { type: 'idle' },
      turns: turnFiles.map((files, index) => ({
        id: `turn-${index + 1}`,
        status: 'completed',
        error: null,
        startedAt: index,
        completedAt: index + 1,
        items: [
          {
            type: 'fileChange',
            id: `file-${index + 1}`,
            changes: files.map((path) => ({ path })),
          },
        ],
      })),
    },
  });

describe('Codex protocol projection', () => {
  it('maps Codex models and supported reasoning efforts', () => {
    expect(
      readCodexModels({
        data: [
          {
            id: 'gpt-5.4',
            model: 'gpt-5.4',
            displayName: 'GPT-5.4',
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: 'medium' },
              { reasoningEffort: 'high' },
            ],
            isDefault: true,
          },
          {
            id: 'hidden-model',
            model: 'hidden-model',
            displayName: 'Hidden model',
            hidden: true,
            supportedReasoningEfforts: [],
            isDefault: false,
          },
        ],
        nextCursor: null,
      }),
    ).toEqual([
      {
        providerId: 'openai',
        providerName: 'Codex',
        modelId: 'gpt-5.4',
        modelName: 'GPT-5.4',
        reasoningVariants: ['medium', 'high'],
        isDefault: true,
      },
    ]);
  });

  it('projects each turn into one user and one assistant message with reasoning', () => {
    const messages = readCodexMessages(
      threadWithTurns([
        {
          type: 'userMessage',
          id: 'u1',
          content: [{ type: 'text', text: 'Fix it' }],
        },
        {
          type: 'reasoning',
          id: 'r1',
          summary: ['Inspecting'],
          content: [],
        },
        {
          type: 'agentMessage',
          id: 'a1',
          text: 'Fixed',
          phase: 'final_answer',
        },
      ]),
    );

    expect(
      messages.map(({ role, content, reasoning }) => ({
        role,
        content,
        reasoning,
      })),
    ).toEqual([
      { role: 'user', content: 'Fix it', reasoning: '' },
      { role: 'assistant', content: 'Fixed', reasoning: 'Inspecting' },
    ]);
    expect(messages[0]).toMatchObject({
      id: 'u1',
      createdAt: 10_000,
      completedAt: null,
    });
    expect(messages[1]).toMatchObject({
      id: 'a1',
      createdAt: 10_000,
      completedAt: 12_000,
    });
  });

  it('limits turn diff files to the last turn while retaining all session files', () => {
    const projected = readCodexDiffs(
      threadWithFileChanges([['src/old.ts'], ['src/new.ts']]),
    );

    expect(projected.session.map((diff) => diff.file)).toEqual([
      'src/old.ts',
      'src/new.ts',
    ]);
    expect(projected.turn.map((diff) => diff.file)).toEqual(['src/new.ts']);
    expect(projected.session[0]).toEqual({
      file: 'src/old.ts',
      before: '',
      after: '',
      additions: 0,
      deletions: 0,
    });
  });

  it('deduplicates files in first-seen order and reads only valid thread IDs', () => {
    const projected = readCodexDiffs(
      threadWithFileChanges([
        ['src/a.ts', 'src/a.ts'],
        ['src/a.ts', 'src/b.ts'],
      ]),
    );

    expect(projected.session.map((diff) => diff.file)).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
    expect(readCodexThreadId({ thread: { id: 'thread-1' } })).toBe('thread-1');
    expect(readCodexThreadId({ thread: {} })).toBeNull();
  });

  it('rejects malformed consumed protocol fields', () => {
    expect(() =>
      readCodexModels({ data: [{ id: 42 }], nextCursor: null }),
    ).toThrow();
    expect(() =>
      readCodexThread({
        thread: { id: 'thread-1', status: { type: 'idle' }, turns: 'invalid' },
      }),
    ).toThrow();
  });

  it('strips the unstable grantRoot field from file approvals', () => {
    const approval = readCodexApprovalRequest(
      'item/fileChange/requestApproval',
      'approval-file-1',
      {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'file-1',
        startedAtMs: 100,
        reason: 'Additional access requested',
        grantRoot: '/unstable/root',
      },
    );

    expect(approval?.type).toBe('file');
    expect(approval?.params).not.toHaveProperty('grantRoot');
  });
});
