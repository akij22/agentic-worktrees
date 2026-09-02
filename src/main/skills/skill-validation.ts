import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { isAlias, parseDocument, visit } from "yaml";
import { skillIdSchema } from "../../shared/skills/schemas";

export const MAX_SKILL_FILES = 64;
export const MAX_SKILL_FILE_BYTES = 256 * 1_024;
export const MAX_SKILL_PACKAGE_BYTES = 1_024 * 1_024;
export const MAX_SKILL_DEPTH = 8;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1_024;

const allowedExtensions = new Set([".md", ".markdown", ".txt"]);

export interface ValidatedSkillDescriptor {
  id: string;
  name: string;
  description: string;
  version: string;
  license?: string;
  automaticInvocation: boolean;
  metadata: Readonly<Record<string, unknown>>;
}
export interface ValidatedSkillFile { relativePath: string; content: string; bytes: Buffer }
export interface ValidatedSkillPackage {
  descriptor: ValidatedSkillDescriptor;
  files: ValidatedSkillFile[];
  contentDigest: string;
}

function invalid(message: string): never {
  throw new Error(`Invalid skill package: ${message}`);
}

function frontmatter(content: string): { metadata: Record<string, unknown>; body: string } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) invalid("SKILL.md must start with YAML frontmatter");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) invalid("frontmatter is not terminated");
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length > 0) invalid("frontmatter YAML is malformed");
  let alias = false;
  visit(document, { Node(_key, node) { if (isAlias(node)) alias = true; } });
  if (alias) invalid("YAML aliases are not supported");
  const value: unknown = document.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("frontmatter must be an object");
  return { metadata: value as Record<string, unknown>, body: content.slice(match[0].length) };
}

export async function validateSkillPackage(sourceRoot: string): Promise<ValidatedSkillPackage> {
  const root = resolve(sourceRoot);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) invalid("source must be a real directory");
  const canonicalRoot = await realpath(root);
  const insideRoot = (candidate: string) => candidate === canonicalRoot || candidate.startsWith(`${canonicalRoot}${sep}`);
  const id = skillIdSchema.parse(basename(root));
  const files: ValidatedSkillFile[] = [];
  let totalBytes = 0;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > MAX_SKILL_DEPTH) invalid("package nesting limit exceeded");
    const canonicalDirectory = await realpath(directory);
    if (!insideRoot(canonicalDirectory)) invalid("directory escapes the source root");
    const directoryBefore = await lstat(directory);
    if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink()) invalid("directory changed during validation");
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (!path || path.startsWith("../") || path.includes("/../") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) invalid("unsafe path");
      if (path === "scripts" || path.startsWith("scripts/")) invalid("scripts are not supported");
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) invalid("symlinks are not supported");
      if (stat.isDirectory()) {
        const canonicalChild = await realpath(absolute);
        if (!insideRoot(canonicalChild)) invalid("directory escapes the source root");
        await walk(absolute, depth + 1);
        continue;
      }
      if (!stat.isFile()) invalid("unsupported filesystem entry");
      if (stat.nlink > 1) invalid("hard links are not supported");
      if ((stat.mode & 0o111) !== 0) invalid("executable files are not supported");
      if (path !== "SKILL.md" && !allowedExtensions.has(extname(path).toLowerCase())) invalid("only textual references are supported");
      if (stat.size > MAX_SKILL_FILE_BYTES) invalid("file size limit exceeded");
      let handle;
      try {
        handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      } catch {
        invalid("file changed or became unsafe during validation");
      }
      let bytes: Buffer;
      try {
        const opened = await handle.stat();
        const canonicalFile = await realpath(absolute);
        if (!insideRoot(canonicalFile) || !opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.nlink > 1) invalid("file changed during validation");
        bytes = await handle.readFile();
        const after = await handle.stat();
        const pathAfter = await lstat(absolute);
        if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== bytes.length || pathAfter.dev !== opened.dev || pathAfter.ino !== opened.ino || pathAfter.isSymbolicLink()) invalid("file changed during validation");
      } finally {
        await handle.close();
      }
      if (bytes.includes(0)) invalid("binary files are not supported");
      const content = bytes.toString("utf8");
      if (!Buffer.from(content, "utf8").equals(bytes)) invalid("files must be valid UTF-8");
      totalBytes += bytes.length;
      if (totalBytes > MAX_SKILL_PACKAGE_BYTES) invalid("package size limit exceeded");
      files.push({ relativePath: path, content, bytes });
      if (files.length > MAX_SKILL_FILES) invalid("file count limit exceeded");
    }
    const directoryAfter = await lstat(directory);
    if (!directoryAfter.isDirectory() || directoryAfter.dev !== directoryBefore.dev || directoryAfter.ino !== directoryBefore.ino) invalid("directory changed during validation");
  }
  await walk(root, 0);
  const rootAfter = await lstat(root);
  if (!rootAfter.isDirectory() || rootAfter.dev !== rootStat.dev || rootAfter.ino !== rootStat.ino || await realpath(root) !== canonicalRoot) invalid("source root changed during validation");
  files.sort((left, right) => left.relativePath === "SKILL.md" ? -1 : right.relativePath === "SKILL.md" ? 1 : left.relativePath.localeCompare(right.relativePath));
  const skillFile = files.find((file) => file.relativePath === "SKILL.md");
  if (!skillFile) invalid("SKILL.md is required");
  const parsed = frontmatter(skillFile.content);
  if (parsed.metadata.name !== id) invalid("frontmatter name must match the directory");
  const description = parsed.metadata.description;
  if (typeof description !== "string" || !description.trim() || description.trim().length > MAX_SKILL_DESCRIPTION_LENGTH) invalid("description is required and must be at most 1024 characters");
  if (parsed.metadata["disable-model-invocation"] !== undefined && typeof parsed.metadata["disable-model-invocation"] !== "boolean") invalid("disable-model-invocation must be boolean");
  const hash = createHash("sha256");
  for (const file of files) {
    const pathBytes = Buffer.from(file.relativePath, "utf8");
    const lengths = Buffer.alloc(8);
    lengths.writeUInt32BE(pathBytes.length, 0); lengths.writeUInt32BE(file.bytes.length, 4);
    hash.update(lengths).update(pathBytes).update(file.bytes);
  }
  const digestHex = hash.digest("hex");
  return {
    descriptor: {
      id,
      name: id,
      description: description.trim(),
      version: `0.0.0-local.${digestHex.slice(0, 12)}`,
      ...(typeof parsed.metadata.license === "string" ? { license: parsed.metadata.license } : {}),
      automaticInvocation: parsed.metadata["disable-model-invocation"] !== true,
      metadata: parsed.metadata,
    },
    files,
    contentDigest: `sha256:${digestHex}`,
  };
}
