import { CapabilityError } from "@agentic-worktrees/capability-sdk";

export interface WebSearchInput {
  query: string;
  limit?: number;
  recencyDays?: number;
  domains?: string[];
  includeContent?: boolean;
}

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  publishedDate?: string;
}

export interface WebSearchOutput {
  provider: "exa-hosted" | "exa-api";
  degraded: boolean;
  results: WebSearchResult[];
}

export interface SearchExaOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  signal: AbortSignal;
}

function safeResults(value: unknown): WebSearchResult[] {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const raw = Array.isArray(value) ? value : Array.isArray(record.results) ? record.results : [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const result = entry as Record<string, unknown>;
    const url = typeof result.url === "string" ? result.url : "";
    if (!url.startsWith("http://") && !url.startsWith("https://")) return [];
    return [{
      title: typeof result.title === "string" ? result.title : url,
      url,
      description: typeof result.description === "string"
        ? result.description
        : typeof result.text === "string"
          ? result.text
          : typeof result.snippet === "string" ? result.snippet : "",
      ...(typeof result.publishedDate === "string" ? { publishedDate: result.publishedDate } : {}),
    }];
  });
}

function parseJsonOrSse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new CapabilityError("upstream_protocol_error", "Exa returned an empty response.");
  try { return JSON.parse(trimmed); } catch { /* parse SSE below */ }
  const dataFrames = trimmed.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  for (let index = dataFrames.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(dataFrames[index]); } catch { /* try earlier frame */ }
  }
  throw new CapabilityError("upstream_protocol_error", "Exa returned an invalid response.");
}

function unwrapMcp(payload: unknown): WebSearchResult[] {
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  if (object.error) throw new CapabilityError("upstream_protocol_error", "Exa search failed.");
  const result = object.result && typeof object.result === "object" ? object.result as Record<string, unknown> : object;
  const direct = safeResults(result);
  if (direct.length) return direct;
  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const text = (item as Record<string, unknown>).text;
    if (typeof text !== "string") continue;
    try {
      const parsed = JSON.parse(text);
      const nested = safeResults(parsed);
      if (nested.length) return nested;
    } catch {
      const urls = [...text.matchAll(/(?:^|\n)(?:Title:\s*)?([^\n]+)\n(?:URL:\s*)(https?:\/\/\S+)(?:\n(?:Text|Description):\s*([^\n]*))?/gi)];
      if (urls.length) return urls.map((match) => ({ title: match[1].trim(), url: match[2], description: match[3]?.trim() ?? "" }));
    }
  }
  return [];
}

function normalizeFailure(error: unknown): never {
  if (error instanceof CapabilityError) throw error;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    throw new CapabilityError("cancelled", "Web search was cancelled.");
  }
  throw new CapabilityError("upstream_unavailable", "Exa is currently unavailable.");
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 429) throw new CapabilityError("rate_limited", "Exa rate limit reached. Try again later or configure an optional API key.");
  if (!response.ok) throw new CapabilityError("upstream_unavailable", "Exa is currently unavailable.");
  return parseJsonOrSse(await response.text());
}

function buildAdvancedArguments(input: WebSearchInput): Record<string, unknown> {
  return {
    query: input.query,
    numResults: input.limit ?? 5,
    ...(input.recencyDays ? { startPublishedDate: new Date(Date.now() - input.recencyDays * 86_400_000).toISOString() } : {}),
    ...(input.domains?.length ? { includeDomains: input.domains } : {}),
    ...(input.includeContent ? { contents: { text: true } } : {}),
  };
}

async function hostedSearch(input: WebSearchInput, options: SearchExaOptions, advanced: boolean): Promise<WebSearchResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const name = advanced ? "web_search_advanced_exa" : "web_search_exa";
  const endpoint = advanced
    ? "https://mcp.exa.ai/mcp?tools=web_search_advanced_exa,web_search_exa"
    : "https://mcp.exa.ai/mcp?tools=web_search_exa";
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: buildAdvancedArguments(input) } }),
    signal: options.signal,
  });
  return unwrapMcp(await readResponse(response));
}

async function directSearch(input: WebSearchInput, options: SearchExaOptions): Promise<WebSearchResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.exa.ai/search", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "x-api-key": options.apiKey ?? "" },
    body: JSON.stringify(buildAdvancedArguments(input)),
    signal: options.signal,
  });
  return safeResults(await readResponse(response));
}

function basicFallbackInput(input: WebSearchInput): WebSearchInput {
  const filters = [
    input.recencyDays ? `published within the last ${input.recencyDays} days` : "",
    input.domains?.length ? `site:${input.domains.join(" OR site:")}` : "",
    input.includeContent ? "include relevant details" : "",
  ].filter(Boolean).join(" ");
  return { query: `${input.query}${filters ? ` ${filters}` : ""}`, limit: input.limit };
}

export async function searchExaAuto(input: WebSearchInput, options: SearchExaOptions): Promise<WebSearchOutput> {
  try {
    if (options.apiKey) return { provider: "exa-api", degraded: false, results: await directSearch(input, options) };
    const advanced = Boolean(input.recencyDays || input.domains?.length || input.includeContent);
    if (!advanced) return { provider: "exa-hosted", degraded: false, results: await hostedSearch(input, options, false) };
    try {
      return { provider: "exa-hosted", degraded: false, results: await hostedSearch(input, options, true) };
    } catch (error) {
      if (options.signal.aborted || (error instanceof CapabilityError && error.code === "cancelled")) throw error;
      return { provider: "exa-hosted", degraded: true, results: await hostedSearch(basicFallbackInput(input), options, false) };
    }
  } catch (error) {
    return normalizeFailure(error);
  }
}
