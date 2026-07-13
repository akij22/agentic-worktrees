import type { DiffLine } from "../types";

const splitDiffLines = (content: string): string[] => {
  if (!content) return [];
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
};

export const createDiffLines = (before: string, after: string): DiffLine[] => {
  const oldLines = splitDiffLines(before);
  const newLines = splitDiffLines(after);
  const table = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint32Array(newLines.length + 1),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(
              table[oldIndex + 1][newIndex],
              table[oldIndex][newIndex + 1],
            );
    }
  }
  const lines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  let oldLine = 1;
  let newLine = 1;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      lines.push({
        type: "context",
        content: oldLines[oldIndex],
        oldLine,
        newLine,
      });
      oldIndex += 1;
      newIndex += 1;
      oldLine += 1;
      newLine += 1;
    } else if (
      newIndex >= newLines.length ||
      (oldIndex < oldLines.length &&
        table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1])
    ) {
      lines.push({
        type: "deletion",
        content: oldLines[oldIndex],
        oldLine,
        newLine: null,
      });
      oldIndex += 1;
      oldLine += 1;
    } else {
      lines.push({
        type: "addition",
        content: newLines[newIndex],
        oldLine: null,
        newLine,
      });
      newIndex += 1;
      newLine += 1;
    }
  }
  return lines;
};
