import type Sqlite from "better-sqlite3";
import type { ResourceIpcAccess } from "./ipc/resource-ipc";
interface ApplicationRenderer {
  id: number;
  getURL(): string;
  isDestroyed(): boolean;
}
const rendererDocument = (raw: string): string => {
  const url = new URL(raw);
  url.hash = "";
  return url.href;
};
/** All local application windows share the workspace; only main-created renderer documents are trusted. */
export class ApplicationResourceAccess implements ResourceIpcAccess {
  private readonly renderers = new Map<
    number,
    { contents: ApplicationRenderer; document: string }
  >();
  constructor(private readonly sqlite: Sqlite.Database) {}
  register(contents: ApplicationRenderer, expectedURL: string): () => void {
    const record = { contents, document: rendererDocument(expectedURL) };
    this.renderers.set(contents.id, record);
    return () => {
      if (this.renderers.get(contents.id) === record)
        this.renderers.delete(contents.id);
    };
  }
  isTrustedSender(senderId: number): boolean {
    const record = this.renderers.get(senderId);
    if (!record || record.contents.isDestroyed()) return false;
    try {
      return rendererDocument(record.contents.getURL()) === record.document;
    } catch {
      return false;
    }
  }
  canAccessWorktree(senderId: number, worktreeId: string): boolean {
    return (
      this.isTrustedSender(senderId) &&
      Boolean(
        this.sqlite
          .prepare("SELECT 1 FROM worktrees WHERE id=?")
          .get(worktreeId),
      )
    );
  }
  getRunWorktree(runId: string): string | null {
    const row = this.sqlite
      .prepare("SELECT worktree_id worktreeId FROM runs WHERE id=?")
      .get(runId) as { worktreeId: string } | undefined;
    return row?.worktreeId ?? null;
  }
  canAccessRun(senderId: number, runId: string, worktreeId: string): boolean {
    return (
      this.canAccessWorktree(senderId, worktreeId) &&
      this.getRunWorktree(runId) === worktreeId
    );
  }
}
let access: ApplicationResourceAccess | null = null;
export function configureApplicationResourceAccess(
  next: ApplicationResourceAccess | null,
): void {
  access = next;
}
export function registerApplicationRenderer(
  contents: ApplicationRenderer,
  expectedURL: string,
): () => void {
  return access?.register(contents, expectedURL) ?? (() => undefined);
}
