import { CapabilityError, defineCapability, defineTool, validateCapabilityDefinition } from "@agentic-worktrees/capability-sdk";
import { urlFetchManifest } from "./manifest";
export { urlFetchManifest } from "./manifest";
export function createURLFetchCapability() { return defineCapability({ manifest: urlFetchManifest, tools: [defineTool({ name: "fetch_url", description: "Generated scaffold", inputSchema: { type: "object", properties: {}, additionalProperties: false }, async execute(_input, context) { if (context.signal.aborted) throw new CapabilityError("cancelled", "Capability execution was cancelled."); return { content: [{ type: "text", text: "Generated capability scaffold. Implement this reviewed tool before enabling agent compatibility." }] }; } })] }); }
const capability = createURLFetchCapability();
validateCapabilityDefinition(capability);
export default capability;
