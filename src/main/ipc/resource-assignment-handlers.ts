import { z } from "zod";
import {
  assignmentErrorCodeSchema,
  assignmentGetRequestSchema,
  assignmentSetDesiredRequestSchema,
  assignmentRevisionRequestSchema,
  assignmentRecoverRequestSchema,
  assignmentProjectionSchema,
  assignmentIpcResultSchema,
  type AssignmentErrorCode,
  type AssignmentIpcResult,
  type AssignmentProjectionDto,
  type AssignmentAction,
} from "../../shared/assignments/schemas";
import { isBoundedResourcePayload } from "../../shared/ipc/resource-wire";
import type { WorktreeResourceAssignmentService } from "../assignments/worktree-resource-assignment-service";
export interface ResourceAssignmentAccess {
  canAccessWorktree(senderId: number, worktreeId: string): boolean;
}
const messages: Record<AssignmentErrorCode, string> = {
  assignment_conflict:
    "Resources changed. Review the latest selection and try again.",
  assignment_invalid_resource: "Invalid resource request.",
  assignment_setup_required:
    "Complete resource setup in Marketplace before assigning it.",
  assignment_waiting_for_idle:
    "Waiting for active sessions before applying resource changes.",
  assignment_apply_failed:
    "Resource changes failed. Your previous verified setup is still active.",
  assignment_recovery_required:
    "Resource state could not be verified. Agent actions are paused for this worktree.",
  resource_unavailable: "Worktree resources are unavailable.",
  resource_update_pending:
    "A resource update is in progress. Try again after it completes.",
  runtime_unavailable: "The agent runtime is unavailable.",
  worktree_removing: "The worktree is being removed.",
  operation_cancelled: "The resource operation was cancelled.",
  internal_error: "Worktree resources could not be loaded. Try again.",
};
export function assignmentWireFailure(
  code: AssignmentErrorCode,
  current?: AssignmentProjectionDto,
): Extract<AssignmentIpcResult<never>, {ok:false}> {
  return {
    ok: false,
    error: {
      code,
      message: messages[code],
      retryable: [
        "internal_error",
        "runtime_unavailable",
        "assignment_apply_failed",
        "assignment_conflict",
      ].includes(code),
      ...(current ? { current } : {}),
    },
  };
}
// Backend error text is never part of the wire result, including nested projection failures.
export function sanitizeAssignmentProjection(
  raw: unknown,
): AssignmentProjectionDto {
  const projection = assignmentProjectionSchema.parse(raw);
  if (projection.failure)
    projection.failure.message = messages[projection.failure.code];
  if (projection.admission.reason)
    projection.admission.message =
      projection.admission.reason === "recovery_required"
        ? messages.assignment_recovery_required
        : projection.admission.reason === "worktree_removing"
          ? messages.worktree_removing
          : projection.admission.reason === "runtime_verification"
            ? "Preparing worktree resources."
            : messages.assignment_waiting_for_idle;
  return projection;
}
export function createResourceAssignmentHandlers(
  service: WorktreeResourceAssignmentService,
  access: ResourceAssignmentAccess,
) {
  async function invoke<
    T extends { worktreeId: string; expectedRevision?: string },
  >(
    senderId: number,
    raw: unknown,
    schema: z.ZodType<T>,
    operation: (request: T) => Promise<AssignmentProjectionDto>,
    action?: (request: T) => AssignmentAction,
  ): Promise<AssignmentIpcResult<AssignmentProjectionDto>> {
    const parsed = isBoundedResourcePayload(raw) ? schema.safeParse(raw) : null;
    if (!parsed?.success)
      return assignmentWireFailure("assignment_invalid_resource");
    const request = parsed.data;
    try {
      if (!access.canAccessWorktree(senderId, request.worktreeId))
        return assignmentWireFailure("resource_unavailable");
      if (action) {
        const current = sanitizeAssignmentProjection(
          await service.get(request.worktreeId),
        );
        if (current.revision !== request.expectedRevision)
          return assignmentWireFailure("assignment_conflict", current);
        if (!current.allowedActions.includes(action(request)))
          return assignmentWireFailure("resource_unavailable", current);
      }
      const value = sanitizeAssignmentProjection(await operation(request));
      // Authorization can be revoked while an operation awaits provider work.
      if (
        !access.canAccessWorktree(senderId, request.worktreeId) ||
        value.worktreeId !== request.worktreeId
      )
        return assignmentWireFailure("resource_unavailable");
      return assignmentIpcResultSchema(assignmentProjectionSchema).parse({
        ok: true,
        value,
      });
    } catch (error) {
      const fields =
        error instanceof Error
          ? (error as Error & { code?: unknown; current?: unknown })
          : null;
      const parsedCode = assignmentErrorCodeSchema.safeParse(fields?.code);
      const code = parsedCode.success ? parsedCode.data : "internal_error";
      let current: AssignmentProjectionDto | undefined;
      if (
        fields?.current &&
        access.canAccessWorktree(senderId, request.worktreeId)
      ) {
        const parsedCurrent = assignmentProjectionSchema.safeParse(
          fields.current,
        );
        if (
          parsedCurrent.success &&
          parsedCurrent.data.worktreeId === request.worktreeId
        )
          current = sanitizeAssignmentProjection(parsedCurrent.data);
      }
      console.error("resource_assignment_ipc_failed", code);
      return assignmentWireFailure(code, current);
    }
  }
  return {
    get: (sender: number, raw: unknown) =>
      invoke(sender, raw, assignmentGetRequestSchema, (r) =>
        service.get(r.worktreeId, r.agentKind),
      ),
    setDesired: (sender: number, raw: unknown) =>
      invoke(sender, raw, assignmentSetDesiredRequestSchema, (r) =>
        service.setDesired({
          ...r,
          resources: [...r.resources].sort((a, b) =>
            `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
          ),
        }),
      ),
    retry: (sender: number, raw: unknown) =>
      invoke(
        sender,
        raw,
        assignmentRevisionRequestSchema,
        (r) => service.retryApply(r),
        () => "retry",
      ),
    cancelPending: (sender: number, raw: unknown) =>
      invoke(
        sender,
        raw,
        assignmentRevisionRequestSchema,
        (r) => service.cancelPending(r),
        () => "cancel_pending",
      ),
    recover: (sender: number, raw: unknown) =>
      invoke(
        sender,
        raw,
        assignmentRecoverRequestSchema,
        (r) => service.recover(r),
        (r) => r.action,
      ),
  };
}
