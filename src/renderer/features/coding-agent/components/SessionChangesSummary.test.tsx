import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CodingAgentDiffDto } from "../../../../shared/ipc/schemas";
import { SessionChangesSummary } from "./SessionChangesSummary";

const diff: CodingAgentDiffDto[] = [
  {
    file: "src/main/app.ts",
    before: "old",
    after: "new",
    additions: 12,
    deletions: 3,
  },
  {
    file: "src/renderer/App.tsx",
    before: "old",
    after: "new",
    additions: 4,
    deletions: 9,
  },
];

describe("SessionChangesSummary", () => {
  it("lists every modified file with its additions and deletions", () => {
    const markup = renderToStaticMarkup(
      <SessionChangesSummary
        diff={diff}
        onSelectFile={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    expect(markup).toContain("src/main/app.ts");
    expect(markup).toContain("src/renderer/App.tsx");
    expect(markup).toContain("+12");
    expect(markup).toContain("−3");
    expect(markup).toContain("+4");
    expect(markup).toContain("−9");
  });

  it("summarizes file count and total line changes in the header", () => {
    const markup = renderToStaticMarkup(
      <SessionChangesSummary
        diff={diff}
        onSelectFile={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    expect(markup).toContain("2 files");
    expect(markup).toContain("+16");
    expect(markup).toContain("−12");
  });

  it("uses the singular form when a single file changed", () => {
    const markup = renderToStaticMarkup(
      <SessionChangesSummary
        diff={[diff[0]]}
        onSelectFile={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    expect(markup).toContain("1 file");
    expect(markup).not.toContain("1 files");
  });
});
