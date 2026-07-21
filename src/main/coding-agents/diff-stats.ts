const toLines = (content: string): string[] => {
  if (!content) return [];
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

export const calculateDiffStats = (
  before: string,
  after: string,
): { additions: number; deletions: number } => {
  const beforeLines = toLines(before);
  const afterLines = toLines(after);
  let previous = new Uint32Array(afterLines.length + 1);
  let current = new Uint32Array(afterLines.length + 1);

  for (const beforeLine of beforeLines) {
    for (let index = 1; index <= afterLines.length; index += 1) {
      current[index] =
        beforeLine === afterLines[index - 1]
          ? previous[index - 1] + 1
          : Math.max(previous[index], current[index - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }

  const unchanged = previous[afterLines.length];
  return {
    additions: afterLines.length - unchanged,
    deletions: beforeLines.length - unchanged,
  };
};
