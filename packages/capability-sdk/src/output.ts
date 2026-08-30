import type { CapabilityToolResult } from "./types";

export const CAPABILITY_OUTPUT_MAX_BYTES = 50 * 1024;
export const CAPABILITY_OUTPUT_MAX_LINES = 2_000;
const NOTICE = "\n[Capability output truncated]";

function truncateText(text: string): string {
  const lines = text.split("\n");
  let candidate =
    lines.length > CAPABILITY_OUTPUT_MAX_LINES
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

function boundedDetails(
  details: unknown,
  maxBytes: number,
): unknown | undefined {
  if (details === undefined) return undefined;
  try {
    const serialized = JSON.stringify(details);
    if (serialized === undefined || Buffer.byteLength(serialized) > maxBytes)
      return undefined;
    return details;
  } catch {
    return undefined;
  }
}

export function limitCapabilityOutput(
  result: CapabilityToolResult,
): CapabilityToolResult {
  const content = result.content
    .slice(0, 1)
    .map((item) => ({ type: "text" as const, text: truncateText(item.text) }));
  const contentBytes = content.reduce(
    (total, item) => total + Buffer.byteLength(item.text),
    0,
  );
  const details = boundedDetails(
    result.details,
    CAPABILITY_OUTPUT_MAX_BYTES - contentBytes,
  );
  return {
    content,
    ...(result.isError === undefined ? {} : { isError: result.isError }),
    ...(details === undefined ? {} : { details }),
  };
}
