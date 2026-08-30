import type { CapabilityToolResult } from "./types";

export const CAPABILITY_OUTPUT_MAX_BYTES = 50 * 1024;
export const CAPABILITY_OUTPUT_MAX_LINES = 2_000;
const NOTICE = "\n[Capability output truncated]";

function truncateText(text: string): string {
  const lines = text.split("\n");
  let candidate = lines.length > CAPABILITY_OUTPUT_MAX_LINES
    ? `${lines.slice(0, CAPABILITY_OUTPUT_MAX_LINES - 1).join("\n")}${NOTICE}`
    : text;
  const maxBodyBytes = CAPABILITY_OUTPUT_MAX_BYTES - Buffer.byteLength(NOTICE);
  if (Buffer.byteLength(candidate) > CAPABILITY_OUTPUT_MAX_BYTES) {
    let bytes = Buffer.from(candidate);
    bytes = bytes.subarray(0, maxBodyBytes);
    candidate = bytes.toString("utf8").replace(/\uFFFD$/u, "") + NOTICE;
  }
  return candidate;
}

function boundedDetails(details: unknown): { value: unknown; bytes: number } | undefined {
  if (details === undefined) return undefined;
  try {
    const serialized = JSON.stringify(details);
    if (serialized === undefined) return undefined;
    const bytes = Buffer.byteLength(serialized);
    return bytes <= CAPABILITY_OUTPUT_MAX_BYTES ? { value: details, bytes } : undefined;
  } catch {
    return undefined;
  }
}

export function limitCapabilityOutput(result: CapabilityToolResult): CapabilityToolResult {
  const details = boundedDetails(result.details);
  let remaining = CAPABILITY_OUTPUT_MAX_BYTES - (details?.bytes ?? 0);
  const content = result.content.slice(0, 1).map((item) => {
    const text = truncateText(item.text);
    const allowed = Buffer.from(text).subarray(0, remaining).toString("utf8").replace(/\uFFFD$/u, "");
    remaining -= Buffer.byteLength(allowed);
    return { type: "text" as const, text: allowed };
  });
  return { content, ...(result.isError === undefined ? {} : { isError: result.isError }), ...(details === undefined ? {} : { details: details.value }) };
}
