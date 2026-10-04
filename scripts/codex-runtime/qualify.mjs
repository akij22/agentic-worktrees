import { spawn } from "node:child_process";
import { realpath, access } from "node:fs/promises";
import { constants } from "node:fs";

const supplied = process.argv[2];
if (!supplied || process.argv.length !== 3) {
  console.error(
    "Usage: npm run qualify:codex-resources -- /absolute/path/to/codex-0.154.0",
  );
  process.exitCode = 1;
} else {
  try {
    const binary = await realpath(supplied);
    await access(binary, constants.X_OK);
    const child = spawn(
      "npm",
      [
        "test",
        "--",
        "src/main/coding-agents/codex-worktree-runtime.test.ts",
        "--maxWorkers=1",
      ],
      {
        stdio: "inherit",
        env: { ...process.env, AW_CODEX_QUALIFICATION_BINARY: binary },
      },
    );
    child.once("error", () => {
      console.error("Could not start Codex qualification.");
      process.exitCode = 1;
    });
    child.once("exit", (code) => {
      process.exitCode = code ?? 1;
    });
  } catch {
    console.error("Qualification requires an executable pinned Codex binary.");
    process.exitCode = 1;
  }
}
