import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const output = await mkdtemp(join(tmpdir(), "aw-receipt-bridge-build-"));
try {
  const outfile = join(output, "probe.mjs");
  await build({ entryPoints: [new URL("./probe.ts", import.meta.url).pathname], outfile, bundle: true, platform: "node", format: "esm", target: "node22", sourcemap: false });
  const module = await import(pathToFileURL(outfile).href);
  await module.main();
} finally {
  await rm(output, { recursive: true, force: true });
}
