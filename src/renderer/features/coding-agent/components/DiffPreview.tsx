import { useMemo } from "react";
import type { CodingAgentDiffDto } from "../../../../shared/ipc/schemas";
import { createDiffLines } from "../lib/diff";

export const DiffPreview = ({ diff }: { diff: CodingAgentDiffDto }) => {
  const lines = useMemo(
    () => createDiffLines(diff.before, diff.after),
    [diff.after, diff.before],
  );
  return (
    <div className="border-t border-border/70 bg-background">
      <div className="max-h-[32rem] overflow-auto py-1 font-mono text-[11px] leading-5">
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
  );
};
