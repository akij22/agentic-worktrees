export type ActiveFileMention = {
  start: number;
  end: number;
  query: string;
};

export const findActiveFileMention = (
  draft: string,
  caret: number,
): ActiveFileMention | undefined => {
  const end = Math.min(Math.max(caret, 0), draft.length);
  const prefix = draft.slice(0, end);
  let start = prefix.lastIndexOf('@');

  while (start >= 0) {
    if (start === 0 || /\s/.test(prefix[start - 1] ?? '')) {
      const query = prefix.slice(start + 1);
      if (query.includes('\n') || query.includes('\r')) return undefined;
      return { start, end, query };
    }
    start = prefix.lastIndexOf('@', start - 1);
  }

  return undefined;
};

const formatFileReference = (path: string): string => {
  if (!/[\s"\\]/.test(path)) return `@${path}`;
  const escaped = path.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `@"${escaped}"`;
};

export const insertFileMention = (
  draft: string,
  mention: ActiveFileMention,
  path: string,
): { draft: string; caret: number } => {
  const reference = `${formatFileReference(path)} `;
  return {
    draft: `${draft.slice(0, mention.start)}${reference}${draft.slice(mention.end)}`,
    caret: mention.start + reference.length,
  };
};
