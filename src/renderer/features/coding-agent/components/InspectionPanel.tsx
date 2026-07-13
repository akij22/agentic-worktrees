import type { CodingAgentDiffDto } from "../../../../shared/ipc/schemas";
import { Badge } from "../../../components/ui/badge";
import { DiffPreview } from "./DiffPreview";

type Props = {
  diff: CodingAgentDiffDto[];
  selectedFile: string | undefined;
  onSelectFile: (file: string) => void;
};

export const InspectionPanel = ({
  diff,
  selectedFile,
  onSelectFile,
}: Props) => {
  const currentDiff = diff.find((file) => file.file === selectedFile);
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
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border p-3">
            {diff.map((file) => (
              <button
                key={file.file}
                type="button"
                onClick={() => onSelectFile(file.file)}
                className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs last:mb-0 ${file.file === selectedFile ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
              >
                <span className="truncate font-mono">{file.file}</span>
                <span className="ml-2 shrink-0 font-mono">
                  <span className="text-chart-3">+{file.additions}</span>{" "}
                  <span className="text-destructive">-{file.deletions}</span>
                </span>
              </button>
            ))}
          </div>
          {currentDiff ? <DiffPreview diff={currentDiff} /> : null}
        </div>
      )}
    </aside>
  );
};
