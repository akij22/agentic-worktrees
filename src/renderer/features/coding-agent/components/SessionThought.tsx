import { Brain } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../../lib/utils";

type Props = {
  agentName: string;
  text: string;
  streaming?: boolean;
};

export const SessionThought = ({ agentName, text, streaming }: Props) => (
  <article
    aria-label={`${agentName} thinking`}
    className="max-w-[48rem] animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out"
  >
    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <Brain aria-hidden="true" className="size-3.5 shrink-0 text-primary/70" />
      {streaming ? (
        <span className="thought-shimmer font-semibold not-italic">
          Thinking
        </span>
      ) : (
        <span className="not-italic">{agentName} was thinking</span>
      )}
    </div>
    <div
      className={cn(
        "border-l-2 pl-3 text-xs leading-5 text-muted-foreground/80",
        streaming ? "border-primary/40" : "border-border",
      )}
    >
      <div className="whitespace-pre-wrap italic">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => (
              <p className="mb-2 last:mb-0">{children}</p>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold text-muted-foreground not-italic">
                {children}
              </strong>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    </div>
  </article>
);
