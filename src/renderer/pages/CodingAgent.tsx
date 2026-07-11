import { useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';

type ChatMessage = {
  id: number;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
};

const initialMessages: ChatMessage[] = [
  {
    id: 1,
    role: 'agent',
    content:
      'I am ready to work in this worktree. Tell me what you want to change, and I will inspect the codebase before making edits.',
    timestamp: 'Now',
  },
];

const models = ['GPT-5 Codex', 'GPT-5', 'o4-mini'];

export const CodingAgent = () => {
  const [model, setModel] = useState(models[0]);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState(initialMessages);

  const submitMessage = () => {
    const content = draft.trim();
    if (!content) return;

    setMessages((current) => [
      ...current,
      {
        id: Date.now(),
        role: 'user',
        content,
        timestamp: 'Now',
      },
    ]);
    setDraft('');
  };

  return (
    <div className="flex h-full min-h-[42rem] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <section className="shrink-0 border-b border-border bg-gradient-to-r from-card via-card to-muted/40 px-5 py-4">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <span className="flex size-2 rounded-full bg-chart-3 shadow-[0_0_0_3px_color-mix(in_oklch,var(--chart-3)_/_18%,transparent)]" />
              Active coding session
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="font-mono text-base font-semibold tracking-tight">
                coding-agent-ui
              </h2>
              <span className="hidden h-4 w-px bg-border sm:block" />
              <span className="font-mono text-sm text-muted-foreground">
                wt/refactor-agent-ui
              </span>
              <Badge variant="outline" className="border-border bg-background/50 font-mono text-[11px]">
                akij22/Agentic-Worktrees
              </Badge>
            </div>
          </div>

          <label className="flex items-center gap-3 self-start rounded-lg border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground xl:self-auto">
            <span className="font-medium uppercase tracking-[0.12em]">Model</span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="cursor-pointer bg-transparent font-mono text-sm font-medium text-foreground outline-none"
              aria-label="AI model"
            >
              {models.map((modelName) => (
                <option key={modelName} value={modelName}>
                  {modelName}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="flex min-h-0 flex-col border-b border-border xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">SESSION</span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground" />
              <span className="text-xs text-muted-foreground">Worktree-scoped</span>
            </div>
            <button
              type="button"
              onClick={() => setMessages(initialMessages)}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear chat
            </button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
            {messages.map((message) => (
              <article
                key={message.id}
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[46rem]'
                    : 'max-w-[48rem]'
                }
              >
                <div className="mb-1.5 flex items-center gap-2 text-xs">
                  <span
                    className={
                      message.role === 'agent'
                        ? 'font-semibold text-primary'
                        : 'font-semibold text-foreground'
                    }
                  >
                    {message.role === 'agent' ? 'Coding Agent' : 'You'}
                  </span>
                  <span className="font-mono text-muted-foreground">{message.timestamp}</span>
                </div>
                <div
                  className={
                    message.role === 'user'
                      ? 'rounded-xl rounded-tr-sm border border-primary/25 bg-primary/10 px-4 py-3 text-sm leading-6'
                      : 'border-l-2 border-primary/70 bg-muted/35 px-4 py-3 text-sm leading-6 text-foreground'
                  }
                >
                  {message.content}
                </div>
              </article>
            ))}
          </div>

          <div className="border-t border-border bg-muted/15 p-4">
            <div className="rounded-xl border border-input bg-background p-2 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitMessage();
                  }
                }}
                placeholder="Describe the change you want to make…"
                rows={3}
                className="block w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-between gap-3 px-1 pt-2">
                <span className="text-xs text-muted-foreground">
                  Enter to send · Shift + Enter for a new line
                </span>
                <Button type="button" size="sm" onClick={submitMessage} disabled={!draft.trim()}>
                  Send
                  <span aria-hidden="true">↗</span>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <aside className="min-h-0 bg-muted/20 xl:overflow-y-auto">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Inspection</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Changes made in this worktree
                </p>
              </div>
              <Badge variant="outline" className="font-mono text-[10px]">
                0 files
              </Badge>
            </div>
          </div>

          <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
            <div className="mb-4 grid size-11 place-items-center rounded-xl border border-dashed border-border bg-background text-lg text-muted-foreground">
              ±
            </div>
            <h4 className="text-sm font-medium">No changes to inspect</h4>
            <p className="mt-2 max-w-56 text-xs leading-5 text-muted-foreground">
              When the coding agent edits this worktree, changed files and line
              diffs will appear here.
            </p>
          </div>

          <div className="mx-5 border-t border-border py-4">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
                Worktree path
              </span>
              <span className="size-1.5 rounded-full bg-chart-3" />
            </div>
            <p className="break-all font-mono text-[11px] leading-5 text-muted-foreground">
              ~/Worktrees/akij22/Agentic-Worktrees.worktrees/coding-agent-ui
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};
