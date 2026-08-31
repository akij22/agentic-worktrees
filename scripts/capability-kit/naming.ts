import type { CapabilityNames } from "./types";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOL = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const acronyms: Record<string, string> = { url: "URL", http: "HTTP", https: "HTTPS", api: "API" };
export function deriveCapabilityNames(slug: string, toolName: string): CapabilityNames {
  if (!SLUG.test(slug) || slug.includes("/") || slug.includes("\\")) throw new Error("Invalid capability slug.");
  if (!TOOL.test(toolName)) throw new Error("Invalid tool name.");
  const parts = slug.split("-");
  const pascal = parts.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
  const symbolName = pascal[0].toLowerCase() + pascal.slice(1);
  return { slug, capabilityId: `agentic-worktrees.${slug}`, packageName: `@agentic-worktrees/${slug}-capability`, visibleName: parts.map((part) => acronyms[part] ?? part[0].toUpperCase() + part.slice(1)).join(" "), symbolName, manifestSymbol: `${symbolName}Manifest`, toolName };
}
