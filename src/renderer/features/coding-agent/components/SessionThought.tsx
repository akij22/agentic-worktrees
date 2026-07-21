import { cn } from "../../../lib/utils";

type Props = {
  agentName: string;
  text: string;
  exiting?: boolean;
};

export const SessionThought = ({ agentName, text, exiting = false }: Props) => (
  <article
    className={cn(
      "max-w-[48rem]",
      exiting
        ? "animate-out fade-out slide-out-to-bottom-2 fill-mode-forwards duration-300 ease-out"
        : "animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out",
    )}
  >
    <div className="mb-1.5 text-xs font-semibold">{agentName}</div>
    <div className="whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs italic leading-5 text-muted-foreground/75">
      {text}
    </div>
  </article>
);
