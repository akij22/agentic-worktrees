import {
  resourceActivityListRequestSchema,
  resourceActivityIpcResultSchema,
  sessionResourceActivitySnapshotSchema,
  type ResourceActivityIpcResult,
  type SessionResourceActivitySnapshot,
} from "../../shared/resource-activity/schemas";
import { isBoundedResourcePayload } from "../../shared/ipc/resource-wire";
import type { ResourceAssignmentAccess } from "./resource-assignment-handlers";
import type { ResourceActivityEvidenceService } from "../resource-activity/resource-activity-evidence-service";
export interface ResourceActivityAccess extends ResourceAssignmentAccess {
  getRunWorktree(runId: string): string | null;
  canAccessRun(senderId: number, runId: string, worktreeId: string): boolean;
}
export function activityWireFailure(
  code: "activity_run_not_found" | "activity_access_denied" | "internal_error",
): ResourceActivityIpcResult<SessionResourceActivitySnapshot> {
  return {
    ok: false,
    error: {
      code,
      message:
        code === "activity_run_not_found"
          ? "Session activity is unavailable."
          : code === "activity_access_denied"
            ? "Session activity access was denied."
            : "Session activity could not be loaded. Try again.",
    },
  };
}
export function createResourceActivityHandlers(
  service: Pick<ResourceActivityEvidenceService, "getSnapshot">,
  access: ResourceActivityAccess,
) {
  return {
    async list(
      sender: number,
      raw: unknown,
    ): Promise<ResourceActivityIpcResult<SessionResourceActivitySnapshot>> {
      const parsed = isBoundedResourcePayload(raw)
        ? resourceActivityListRequestSchema.safeParse(raw)
        : null;
      if (!parsed?.success)
        return activityWireFailure("activity_access_denied");
      try {
        const { runId } = parsed.data,
          worktreeId = access.getRunWorktree(runId);
        if (!worktreeId) return activityWireFailure("activity_run_not_found");
        if (
          !access.canAccessWorktree(sender, worktreeId) ||
          !access.canAccessRun(sender, runId, worktreeId)
        )
          return activityWireFailure("activity_access_denied");
        const value = sessionResourceActivitySnapshotSchema.parse(
          await service.getSnapshot(runId),
        );
        if (
          value.runId !== runId ||
          access.getRunWorktree(runId) !== worktreeId ||
          !access.canAccessWorktree(sender, worktreeId) ||
          !access.canAccessRun(sender, runId, worktreeId)
        )
          return activityWireFailure("activity_access_denied");
        return resourceActivityIpcResultSchema(
          sessionResourceActivitySnapshotSchema,
        ).parse({ ok: true, value });
      } catch {
        console.error("resource_activity_ipc_failed");
        return activityWireFailure("internal_error");
      }
    },
  };
}
