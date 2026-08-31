import { describe, expect, it } from "vitest";
import { deriveCapabilityNames } from "./naming";
describe("capability naming", () => {
  it("derives deterministic repository names", () => expect(deriveCapabilityNames("url-fetch", "fetch_url")).toEqual({ slug: "url-fetch", capabilityId: "agentic-worktrees.url-fetch", packageName: "@agentic-worktrees/url-fetch-capability", visibleName: "URL Fetch", symbolName: "urlFetch", manifestSymbol: "urlFetchManifest", toolName: "fetch_url" }));
  it("rejects invalid names", () => {
    for (const slug of ["URL-fetch", "url_fetch", "../escape", "-fetch", "fetch-"]) expect(() => deriveCapabilityNames(slug, "fetch_url")).toThrow("slug");
    expect(() => deriveCapabilityNames("url-fetch", "FetchUrl")).toThrow("tool name");
  });
});
