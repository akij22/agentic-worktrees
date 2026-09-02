import { CapabilityError, defineCapability, defineTool, validateCapabilityDefinition } from "@agentic-worktrees/capability-sdk";
import { searchExaAuto, type WebSearchInput, type WebSearchOutput } from "./exa-client";
import { webSearchManifest } from "./manifest";

const webSearchInputSchema = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, maxLength: 2_000 },
    limit: { type: "integer", minimum: 1, maximum: 20 },
    recencyDays: { type: "integer", minimum: 1, maximum: 3_650 },
    domains: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 20 },
    includeContent: { type: "boolean" },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

export function formatAttributedResults(output: WebSearchOutput): string {
  if (!output.results.length) return "No Exa results found.";
  const heading = `Exa results${output.degraded ? " (basic search fallback)" : ""}:`;
  return [heading, ...output.results.map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.description}`)].join("\n");
}

export function createWebSearchCapability({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}) {
  return validateCapabilityDefinition(defineCapability({
    manifest: webSearchManifest,
    tools: [defineTool<WebSearchInput>({
      name: "web_search",
      description: "Search the web and return attributed Exa results.",
      inputSchema: webSearchInputSchema,
      async execute(input, context) {
        if (!input.query.trim()) throw new CapabilityError("invalid_input", "A search query is required.");
        const apiKey = await context.secrets.getOptional("exaApiKey");
        const resultLimit = typeof context.settings.resultLimit === "number" ? context.settings.resultLimit : undefined;
        const output = await searchExaAuto({ ...input, limit: input.limit ?? resultLimit }, { apiKey, fetchImpl, signal: context.signal });
        return { content: [{ type: "text", text: formatAttributedResults(output) }], details: output };
      },
    })],
  }));
}

export { searchExaAuto, webSearchManifest };
export type { WebSearchInput, WebSearchOutput, WebSearchResult } from "./exa-client";
export default createWebSearchCapability();
