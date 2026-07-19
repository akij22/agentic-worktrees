import { ChevronRight, FileCode2, X } from "lucide-react";
import type { CodingAgentDiffDto } from "../../../../shared/ipc/schemas";
import { Badge } from "../../../components/ui/badge";

type Props = {
  diff: CodingAgentDiffDto[];
  onSelectFile: (file: string) => void;
  onDismiss: () => void;
};

export const SessionChangesSummary = ({
  diff,
  onSelectFile,
  onDismiss,
}: Props) => {
  const totalAdditions = diff.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = diff.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <section
      aria-label="Changes summary"
      className="max-w-[48rem] overflow-hidden rounded-xl border border-border bg-muted/30"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-xs font-semibold">Changes</span>
          <Badge variant="outline" className="font-mono text-[11px]">
            {diff.length} file{diff.length === 1 ? "" : "s"}
          </Badge>
          <span className="shrink-0 font-mono text-[11px] font-semibold">
            <span className="text-emerald-400">+{totalAdditions}</span>{" "}
            <span className="text-rose-400">−{totalDeletions}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss changes summary"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto p-1.5">
        {diff.map((file) => (
          <button
            key={file.file}
            type="button"
            onClick={() => onSelectFile(file.file)}
            className="group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <FileCode2
              aria-hidden="true"
              className="size-3.5 shrink-0 opacity-70"
            />
            <span
              className="min-w-0 flex-1 truncate font-mono font-medium"
              title={file.file}
            >
              {file.file}
            </span>
            <span className="shrink-0 font-mono text-[10px] font-semibold">
              <span className="text-emerald-400">+{file.additions}</span>{" "}
              <span className="text-rose-400">−{file.deletions}</span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
            />
          </button>
        ))}
      </div>
    </section>
  );
};
