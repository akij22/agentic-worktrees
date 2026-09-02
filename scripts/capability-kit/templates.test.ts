import { describe, expect, it } from "vitest";
import { deriveCapabilityNames } from "./naming";
import { renderCapabilityPackage } from "./templates";

describe("capability templates", () => {
  it("renders a transparent unsupported SDK scaffold", () => {
    const files = renderCapabilityPackage(
      deriveCapabilityNames("url-fetch", "fetch_url"),
    );
    expect([...files.keys()]).toEqual([
      "package.json",
      "src/manifest.ts",
      "src/index.ts",
      "src/index.test.ts",
    ]);

    const packageJson = files.get("package.json");
    expect(packageJson).toBeDefined();
    if (!packageJson) throw new Error("Generated package.json is missing.");
    expect(JSON.parse(packageJson)).toMatchObject({
      name: "@agentic-worktrees/url-fetch-capability",
      private: true,
      type: "module",
      dependencies: { "@agentic-worktrees/capability-sdk": "0.1.0" },
    });
    expect(files.get("src/manifest.ts")).toContain(
      'codex: "unsupported", opencode: "unsupported"',
    );
    expect(files.get("src/manifest.ts")).toContain(
      "network: [], secrets: []",
    );
    expect(files.get("src/index.ts")).toContain("context.signal.aborted");
    expect(files.get("src/index.ts")).toContain(
      "Generated capability scaffold",
    );
    expect(files.get("src/index.ts")).toContain(
      "validateCapabilityDefinition",
    );
  });
});
