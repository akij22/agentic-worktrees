// Bound traversal before schema parsing; structured-clone payloads can be cyclic.
export function isBoundedResourcePayload(
  value: unknown,
  maxBytes = 65_536,
): boolean {
  let bytes = 0,
    nodes = 0;
  const seen = new Set<object>();
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 20_000 || depth > 16) return false;
    if (typeof item === "string")
      bytes += new TextEncoder().encode(item).byteLength + 2;
    else if (
      item === null ||
      typeof item === "boolean" ||
      typeof item === "number"
    )
      bytes += 8;
    else if (typeof item === "object") {
      if (seen.has(item)) return false;
      seen.add(item);
      for (const [key, child] of Object.entries(item)) {
        bytes += new TextEncoder().encode(key).byteLength + 4;
        if (bytes > maxBytes || !visit(child, depth + 1)) return false;
      }
      seen.delete(item);
    } else return false;
    return bytes <= maxBytes;
  };
  return visit(value, 0);
}
