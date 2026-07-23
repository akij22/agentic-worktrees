import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "../../../components/ui/button";

type Props = {
  agentName: string;
  content: string;
  isStreaming: boolean;
};

/** HextaUI's AI Message block, for durable assistant replies only. */
export const AIMessage = ({ agentName, content, isStreaming }: Props) => {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const copyMessage = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
    window.setTimeout(() => {
      setCopied(false);
      setCopyError(false);
    }, 2_000);
  }, [content]);

  return (
    <div
      aria-atomic="false"
      aria-label={`${agentName} message`}
      aria-live={isStreaming ? "polite" : "off"}
      className="group relative"
      role="article"
    >
      <div className="absolute right-0 top-0 z-10">
        <Button
          aria-label={copied ? "Message copied to clipboard" : "Copy message"}
          className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => void copyMessage()}
          size="icon"
          variant="ghost"
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      <div className="pr-12 text-sm leading-6 text-foreground">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="mb-3 mt-6 text-xl font-semibold first:mt-0">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="mb-2 mt-5 text-lg font-semibold first:mt-0">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="mb-2 mt-4 font-semibold first:mt-0">{children}</h3>
            ),
            p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
            a: ({ children, href }) => (
              <a
                className="text-primary underline underline-offset-4 hover:text-primary/80"
                href={href}
                rel="noopener noreferrer"
                target="_blank"
              >
                {children}
              </a>
            ),
            ul: ({ children }) => (
              <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">
                {children}
              </ol>
            ),
            blockquote: ({ children }) => (
              <blockquote className="mb-3 border-l-2 border-primary/60 pl-3 text-muted-foreground italic last:mb-0">
                {children}
              </blockquote>
            ),
            code: ({ className, children }) => {
              const isCodeBlock = className?.startsWith("language-");
              if (!isCodeBlock)
                return (
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
                    {children}
                  </code>
                );
              return (
                <code className={`${className} block whitespace-pre font-mono text-xs leading-5`}>
                  {children}
                </code>
              );
            },
            pre: ({ children }) => (
              <pre className="mb-3 overflow-x-auto rounded-lg border border-border bg-muted/45 p-4 last:mb-0">
                {children}
              </pre>
            ),
            table: ({ children }) => (
              <div className="mb-3 overflow-x-auto last:mb-0">
                <table className="w-full border-collapse text-left text-xs">
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border border-border bg-muted/60 px-3 py-2 font-medium">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-border px-3 py-2 align-top">{children}</td>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
      {copyError ? (
        <span aria-live="assertive" className="sr-only" role="alert">
          Failed to copy message to clipboard
        </span>
      ) : null}
    </div>
  );
};
