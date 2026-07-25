const lineSuffix = /(?::\d+(?::\d+)?)$|#L\d+(?:-L\d+)?$/i;

const normalizePath = (value: string): string | null => {
  let path = value.trim();
  if (!path) return null;

  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }

  if (path.startsWith("file://")) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }

  path = path.replace(lineSuffix, "").replaceAll("\\", "/");
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/") || null;
};

/**
 * Returns the session-diff file addressed by a Markdown link. A match must be
 * exact after removing the worktree prefix and optional line reference, so a
 * regular web link can never be treated as a local file navigation.
 */
export const getLinkedDiffFile = (
  href: string | undefined,
  diffFiles: readonly string[],
  worktreePath: string,
): string | undefined => {
  if (!href || (/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith("file://")))
    return undefined;

  const target = normalizePath(href);
  if (!target) return undefined;
  const normalizedWorktree = normalizePath(worktreePath);

  const exactFile = diffFiles.find((file) => normalizePath(file) === target);
  if (exactFile) return exactFile;

  const relativeTarget =
    normalizedWorktree && target.startsWith(`${normalizedWorktree}/`)
      ? target.slice(normalizedWorktree.length + 1)
      : target;

  return diffFiles.find((file) => {
    const normalizedFile = normalizePath(file);
    if (!normalizedFile) return false;
    const relativeFile =
      normalizedWorktree && normalizedFile.startsWith(`${normalizedWorktree}/`)
        ? normalizedFile.slice(normalizedWorktree.length + 1)
        : normalizedFile;
    return relativeFile === relativeTarget;
  });
};
