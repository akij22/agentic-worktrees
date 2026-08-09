import { ChevronLeft, ChevronRight, GitCompareArrows, GitMerge, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { IntelligenceSnapshotDto } from '../../../../shared/ipc/schemas';
import { Button } from '../../../components/ui/button';
import { IntelligenceWorktreeNode } from './IntelligenceWorktreeNode';
import { RiskBadge } from './RiskBadge';

const PAGE_SIZE = 4;
const riskRank = { low: 0, medium: 1, high: 2 } as const;

type Props = {
  snapshot: IntelligenceSnapshotDto;
  onReview: (overlapId: string) => void;
  onCompare: (overlapId: string) => void;
  onOpenChat: (worktreeId: string, runId: string) => void;
};

export const WorktreeOverlapMap = ({ snapshot, onReview, onCompare, onOpenChat }: Props) => {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(snapshot.worktrees.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(pageCount - 1, 0));
  const visible = snapshot.worktrees.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const visibleIds = useMemo(() => new Set(visible.map(({ worktreeId }) => worktreeId)), [visible]);
  const relationships = snapshot.overlaps.filter(({ leftWorktreeId, rightWorktreeId }) =>
    visibleIds.has(leftWorktreeId) && visibleIds.has(rightWorktreeId));
  const riskFor = (worktreeId: string) => snapshot.overlaps
    .filter(({ leftWorktreeId, rightWorktreeId }) => leftWorktreeId === worktreeId || rightWorktreeId === worktreeId)
    .reduce<'low' | 'medium' | 'high'>((current, overlap) =>
      riskRank[overlap.risk] > riskRank[current] ? overlap.risk : current, 'low');

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card/30" aria-labelledby="overlap-map-heading">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div>
          <h2 id="overlap-map-heading" className="flex items-center gap-2 text-sm font-semibold"><GitMerge className="size-4 text-muted-foreground" /> Worktree overlap map</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">Committed, staged, unstaged, and untracked changes.</p>
        </div>
        {pageCount > 1 ? (
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-[10px] text-muted-foreground">{safePage + 1}/{pageCount}</span>
            <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Previous worktrees" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(value - 1, 0))}><ChevronLeft /></Button>
            <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Next worktrees" disabled={safePage >= pageCount - 1} onClick={() => setPage((value) => Math.min(value + 1, pageCount - 1))}><ChevronRight /></Button>
          </div>
        ) : null}
      </div>
      <div className="relative p-4">
        <div className="pointer-events-none absolute inset-4 hidden opacity-20 lg:block" aria-hidden="true">
          <svg className="size-full" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M25 25 C50 25 50 75 75 75 M75 25 C50 25 50 75 25 75" fill="none" stroke="currentColor" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /></svg>
        </div>
        <div className="relative grid gap-4 lg:grid-cols-2">
          {visible.map((worktree) => <IntelligenceWorktreeNode key={worktree.worktreeId} worktree={worktree} risk={riskFor(worktree.worktreeId)} onOpenChat={onOpenChat} />)}
        </div>
        {relationships.length > 0 ? (
          <div className="relative mt-4 flex flex-wrap gap-2 border-t border-border pt-3" aria-label="Visible relationships">
            {relationships.map((overlap) => (
              <div key={overlap.id} className="flex items-center rounded-md border border-border bg-background/80">
                <button type="button" className="flex items-center gap-2 px-2.5 py-1.5 text-left text-[10px] hover:bg-accent" onClick={() => onReview(overlap.id)}>
                  <RiskBadge risk={overlap.risk} />
                  <span className="max-w-64 truncate">{overlap.summary}</span>
                  <Search className="size-3 text-muted-foreground" />
                </button>
                <button type="button" className="border-l border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Compare ${overlap.summary}`} onClick={() => onCompare(overlap.id)}>
                  <GitCompareArrows className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
};
