import { ChevronRight, FileCode2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CodingAgentDiffDto } from "../../../../shared/ipc/schemas";
import { Badge } from "../../../components/ui/badge";
import { DiffPreview } from "./DiffPreview";

type Props = {
  diff: CodingAgentDiffDto[];
  focusedFile?: string;
  onFocusedFileConsumed?: () => void;
};

export const InspectionPanel = ({
  diff,
  focusedFile,
  onFocusedFileConsumed,
}: Props) => {
  const panelId = useId();
  const previousFiles = useRef(new Set(diff.map((file) => file.file)));
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () => new Set(diff[0] ? [diff[0].file] : []),
  );
  const fileRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const availableFiles = new Set(diff.map((file) => file.file));
    setExpandedFiles((current) => {
      const next = new Set(
        [...current].filter((file) => availableFiles.has(file)),
      );
      if (previousFiles.current.size === 0 && diff[0]) {
        next.add(diff[0].file);
      }
      return next;
    });
    previousFiles.current = availableFiles;
  }, [diff]);

  // Handles a focus request coming from outside (e.g. the changes summary
  // panel): expands the file and scrolls it into view, then releases the
  // request so the same file can be requested again later.
  useEffect(() => {
    if (!focusedFile) return;
    if (diff.some((file) => file.file === focusedFile)) {
      setExpandedFiles((current) => {
        const next = new Set(current);
        next.add(focusedFile);
        return next;
      });
      fileRefs.current
        .get(focusedFile)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    onFocusedFileConsumed?.();
  }, [diff, focusedFile, onFocusedFileConsumed]);

  const toggleFile = (file: string) => {
    setExpandedFiles((current) => {
      const next = new Set(current);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  return (
    <aside className="flex min-h-0 flex-col bg-muted/20 xl:overflow-hidden">
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Inspection</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Session diff</p>
          </div>
          <Badge variant="outline">{diff.length} files</Badge>
        </div>
      </div>
      {diff.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          No changes to inspect yet.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-2">
            {diff.map((file, index) => {
              const expanded = expandedFiles.has(file.file);
              const contentId = `${panelId}-diff-${index}`;
              return (
                <section
                  key={file.file}
                  ref={(element) => {
                    if (element) fileRefs.current.set(file.file, element);
                    else fileRefs.current.delete(file.file);
                  }}
                  className={`overflow-hidden rounded-lg border bg-background transition-colors ${expanded ? "border-border shadow-sm" : "border-border/70 hover:border-border"}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleFile(file.file)}
                    aria-expanded={expanded}
                    aria-controls={contentId}
                    className={`group flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors ${expanded ? "bg-muted/60 text-foreground" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={`size-3.5 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90 text-foreground" : "group-hover:text-foreground"}`}
                    />
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
                  </button>
                  <div id={contentId} hidden={!expanded}>
                    {expanded ? <DiffPreview diff={file} /> : null}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
};
