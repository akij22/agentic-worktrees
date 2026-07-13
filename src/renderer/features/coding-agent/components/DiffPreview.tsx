import { useMemo } from "react";
import type { CodingAgentDiffDto } from "../../../../shared/ipc/schemas";
import { createDiffLines } from "../lib/diff";

export const DiffPreview = ({ diff }: { diff: CodingAgentDiffDto }) => {
  const lines = useMemo(
    () => createDiffLines(diff.before, diff.after),
    [diff.after, diff.before],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0 truncate font-mono text-xs font-medium text-foreground">
          {diff.file}
        </div>
        <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] font-semibold">
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400">
            +{diff.additions}
          </span>
          <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-400">
            −{diff.deletions}
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-inner">
        <div className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[11px] leading-5">
          {lines.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No line changes to display.
            </div>
          ) : (
            lines.map((line, index) => {
              const tone =
                line.type === "addition"
                  ? "border-l-2 border-emerald-400 bg-emerald-500/10 text-emerald-100"
                  : line.type === "deletion"
                    ? "border-l-2 border-rose-400 bg-rose-500/10 text-rose-100"
                    : "border-l-2 border-transparent text-muted-foreground hover:bg-muted/30";
              const marker =
                line.type === "addition"
                  ? "+"
                  : line.type === "deletion"
                    ? "−"
                    : " ";
              return (
                <div
                  key={`${line.type}-${line.oldLine ?? "new"}-${line.newLine ?? "old"}-${index}`}
                  className={`flex min-w-max ${tone}`}
                >
                  <span className="w-10 shrink-0 select-none px-2 text-right text-muted-foreground/50">
                    {line.oldLine ?? ""}
                  </span>
                  <span className="w-10 shrink-0 select-none px-1 text-right text-muted-foreground/50">
                    {line.newLine ?? ""}
                  </span>
                  <span className="w-5 shrink-0 select-none text-center font-semibold opacity-80">
                    {marker}
                  </span>
                  <span className="whitespace-pre px-2">
                    {line.content || " "}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
