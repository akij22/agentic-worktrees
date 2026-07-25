import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../../lib/utils";

type Props = {
  agentName: string;
  text: string;
  exiting?: boolean;
};

const LONG_THOUGHT_MAX_CHARACTERS = 480;
const LONG_THOUGHT_MAX_LINES = 6;

const isLongThought = (text: string): boolean =>
  text.length > LONG_THOUGHT_MAX_CHARACTERS ||
  text.split("\n").length > LONG_THOUGHT_MAX_LINES;

export const SessionThought = ({ agentName, text, exiting = false }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const longThought = isLongThought(text);

  return (
    <article
      className={cn(
        "max-w-[48rem]",
        exiting
          ? "animate-out fade-out slide-out-to-bottom-2 fill-mode-forwards duration-300 ease-out"
          : "animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out",
      )}
    >
      <div className="mb-1.5 text-xs font-semibold">{agentName}</div>
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs italic leading-5 text-muted-foreground/75">
        {longThought ? (
          <>
            <button
              type="button"
              aria-label={expanded ? "Collapse thinking" : "Expand thinking"}
              aria-expanded={expanded}
              aria-controls={contentId}
              onClick={() => setExpanded((current) => !current)}
              className="group flex w-full items-center gap-1.5 text-left"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0 transition-transform duration-200",
                  expanded && "rotate-90",
                )}
              />
              <span>Thinking</span>
            </button>
            <div
              id={contentId}
              hidden={!expanded}
              className="mt-2 whitespace-pre-wrap"
            >
              {text}
            </div>
          </>
        ) : (
          <div className="whitespace-pre-wrap">{text}</div>
        )}
      </div>
    </article>
  );
};
