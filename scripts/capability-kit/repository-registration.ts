import path from "node:path";
import type { CapabilityNames } from "./types";
function patchRegion(source: string, marker: string, line: string): string {
  const start = `// capability-kit:${marker}:start`, end = `// capability-kit:${marker}:end`;
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error(`Invalid ${marker} marker.`);
  const startIndex = source.indexOf(start) + start.length, endIndex = source.indexOf(end);
  const body = source.slice(startIndex, endIndex);
  if (body.split("\n").some((item) => item.trim() === line)) throw new Error("Capability is already registered.");
  const indent = body.match(/\n(\s*)\S/)?.[1] ?? "";
  const lines = [...body.split("\n").map((item) => item.trim()).filter(Boolean), line].sort((a, b) => a.localeCompare(b));
  return source.slice(0, startIndex) + `\n${lines.map((item) => indent + item).join("\n")}\n${source.slice(endIndex)}`;
}
export async function createRepositoryRegistrationPatches(rootDirectory: string, names: CapabilityNames, readFile: (path: string) => Promise<string>): Promise<ReadonlyMap<string, string>> {
  const catalogRelative = "src/main/capabilities/catalog.ts", hostRelative = "src/main/capabilities/host-registry.ts";
  let catalog = await readFile(path.join(rootDirectory, catalogRelative)); let host = await readFile(path.join(rootDirectory, hostRelative));
  for (const collision of [names.packageName, names.capabilityId, names.toolName, names.manifestSymbol]) if (catalog.includes(collision) || host.includes(collision)) throw new Error("Capability is already registered.");
  catalog = patchRegion(catalog, "catalog-imports", `import { ${names.manifestSymbol} } from "${names.packageName}";`);
  catalog = patchRegion(catalog, "catalog-entries", `createBundledCapability(${names.manifestSymbol}, ["${names.toolName}"]),`);
  host = patchRegion(host, "host-imports", `import ${names.symbolName}Capability from "${names.packageName}";`);
  host = patchRegion(host, "host-entries", `${names.symbolName}Capability,`);
  return new Map([[catalogRelative, catalog], [hostRelative, host]]);
}
