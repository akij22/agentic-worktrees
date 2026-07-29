import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../../lib/utils";

type Props = {
  agentName: string;
  text: string;
};

export const SessionThought = ({ agentName, text }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  return (
    <article
      className="max-w-[48rem] animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out"
    >
      <div className="mb-1.5 text-xs font-semibold">{agentName}</div>
      <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/20 text-xs leading-5 text-muted-foreground/75">
        <button
          type="button"
          aria-label={
            expanded ? "Collapse thinking" : "Expand thinking"
          }
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
          className="group flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-muted/40 hover:text-muted-foreground"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 transition-transform duration-200",
              expanded && "rotate-90",
            )}
          />
          <span className="font-medium not-italic">Thinking...</span>
        </button>
        <div
          id={contentId}
          hidden={!expanded}
          className="border-t border-border/50 px-3 py-2.5 font-mono text-[11px] leading-5"
        >
          <div className="whitespace-pre-wrap">{text}</div>
        </div>
      </div>
    </article>
  );
};
