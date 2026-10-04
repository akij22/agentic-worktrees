import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { z } from "zod";
import { assignmentErrorCodeSchema, type AssignmentIpcResult } from "../../shared/assignments";
import { IPC_CHANNELS, type IpcChannel } from "../../shared/ipc/channels";
import { isBoundedResourcePayload } from "../../shared/ipc/resource-wire";
import { assignmentChangedEventSchema } from "../../shared/assignments/schemas";
import { sessionResourceActivityChangedEventSchema } from "../../shared/resource-activity/schemas";
import type { WorktreeResourceAssignmentService } from "../assignments/worktree-resource-assignment-service";
import type { ResourceActivityEvidenceService } from "../resource-activity/resource-activity-evidence-service";
import {
  createResourceAssignmentHandlers,
  assignmentWireFailure,
  sanitizeAssignmentProjection,
  type ResourceAssignmentAccess,
} from "./resource-assignment-handlers";
import {
  createResourceActivityHandlers,
  activityWireFailure,
  type ResourceActivityAccess,
} from "./resource-activity-handlers";

export interface ResourceIpcAccess
  extends ResourceAssignmentAccess, ResourceActivityAccess {
  // Application-owned top-level windows at their expected renderer URL only.
  isTrustedSender(senderId: number): boolean;
}
export interface ResourceIpcWindow {
  id: number;
  send(channel: IpcChannel, payload: unknown): void;
}
export interface ResourceIpcBindings {
  assignment: WorktreeResourceAssignmentService;
  activity: Pick<ResourceActivityEvidenceService, "getSnapshot">;
  access: ResourceIpcAccess;
}
type PublisherOptions = ResourceIpcAccess & { windows(): ResourceIpcWindow[] };
export function createResourceIpcPublisher(options: PublisherOptions) {
  function deliver(
    channel: IpcChannel,
    payload: unknown,
    allowed: (sender: number) => boolean,
  ): void {
    const errors: unknown[] = [];
    for (const window of options.windows()) {
      try {
        if (options.isTrustedSender(window.id) && allowed(window.id))
          window.send(channel, payload);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Resource IPC delivery failed.");
  }
  return {
    assignment(raw: unknown): void {
      const parsed = isBoundedResourcePayload(raw, 2_097_152)
        ? assignmentChangedEventSchema.safeParse(raw)
        : null;
      if (!parsed?.success) {
        console.error("resource_assignment_invalid_publication");
        throw new Error("Invalid Assignment publication.");
      }
      const event = {
        ...parsed.data,
        projection: sanitizeAssignmentProjection(parsed.data.projection),
      };
      deliver(IPC_CHANNELS.RESOURCE_ASSIGNMENT_CHANGED, event, (id) =>
        options.canAccessWorktree(id, event.worktreeId),
      );
    },
    activity(raw: unknown): void {
      const parsed = isBoundedResourcePayload(raw, 2_097_152)
        ? sessionResourceActivityChangedEventSchema.safeParse(raw)
        : null;
      if (!parsed?.success) {
        console.error("resource_activity_invalid_publication");
        return;
      }
      const event = parsed.data;
      deliver(IPC_CHANNELS.RESOURCE_ACTIVITY_CHANGED, event, (id) => {
        const worktreeId = options.getRunWorktree(event.runId);
        return (
          worktreeId !== null &&
          options.canAccessWorktree(id, worktreeId) &&
          options.canAccessRun(id, event.runId, worktreeId)
        );
      });
    },
  };
}
let bindings: ResourceIpcBindings | null = null;
let unsubscribe: (() => void) | null = null;
let windowList: () => ResourceIpcWindow[] = () => [];
let publisher: ReturnType<typeof createResourceIpcPublisher> | null = null;
/** Authorize admission against exact main-owned Worktree/run records and return bounded public failures. */
export async function invokeResourceAdmission<Request extends {worktreeId?:string;runId?:string},Value>(
  event:IpcMainInvokeEvent,raw:unknown,schema:z.ZodType<Request>,required:boolean,operation:(request:Request)=>Promise<Value>,
):Promise<AssignmentIpcResult<Value>> {
  const parsed=isBoundedResourcePayload(raw,1_048_576) ? schema.safeParse(raw) : null;
  if(!parsed?.success)return assignmentWireFailure("assignment_invalid_resource");
  const current=bindings;
  let worktreeId:string|null=null;
  if(required) {
    if(!current)return assignmentWireFailure("runtime_unavailable");
    if(event.sender.isDestroyed() || event.senderFrame!==event.sender.mainFrame || !current.access.isTrustedSender(event.sender.id))return assignmentWireFailure("resource_unavailable");
    worktreeId=parsed.data.worktreeId ?? (parsed.data.runId ? current.access.getRunWorktree(parsed.data.runId) : null);
    if(!worktreeId || !current.access.canAccessWorktree(event.sender.id,worktreeId) || (parsed.data.runId && !current.access.canAccessRun(event.sender.id,parsed.data.runId,worktreeId)))return assignmentWireFailure("resource_unavailable");
  }
  try {
    const value=await operation(parsed.data);
    if(required && (bindings!==current || !current?.access.isTrustedSender(event.sender.id)))return assignmentWireFailure("resource_unavailable");
    return {ok:true,value};
  } catch(error) {
    const code=assignmentErrorCodeSchema.safeParse(error && typeof error === "object" && "code" in error ? error.code : null);
    let projection;
    if(current && worktreeId) {
      try {projection=sanitizeAssignmentProjection(await current.assignment.get(worktreeId));} catch {console.error("resource_admission_projection_unavailable");}
    }
    console.error("resource_admission_rejected");
    return assignmentWireFailure(code.success ? code.data : "internal_error",projection);
  }
}
export function configureResourceIpc(next: ResourceIpcBindings | null): void {
  unsubscribe?.();
  unsubscribe = null;
  bindings = next;
  publisher = null;
  if (next) {
    publisher = createResourceIpcPublisher({
      windows: () => windowList(),
      isTrustedSender: (id) => next.access.isTrustedSender(id),
      canAccessWorktree: (id, wt) => next.access.canAccessWorktree(id, wt),
      getRunWorktree: (run) => next.access.getRunWorktree(run),
      canAccessRun: (id, run, wt) => next.access.canAccessRun(id, run, wt),
    });
    unsubscribe = next.assignment.subscribe((event) =>
      publisher?.assignment(event),
    );
  }
}
// Bind to ResourceActivityEvidenceService.onChanged, which publishes after its transaction.
export function publishResourceActivity(raw: unknown): void {
  publisher?.activity(raw);
}
export function registerResourceIpcHandlers(
  ipc: Pick<IpcMain, "handle">,
  windows: () => ResourceIpcWindow[],
): void {
  windowList = windows;
  const trusted = (event: IpcMainInvokeEvent) =>
    bindings !== null &&
    !event.sender.isDestroyed() &&
    event.senderFrame === event.sender.mainFrame &&
    bindings.access.isTrustedSender(event.sender.id);
  const assignmentInvoke =
    (name: keyof ReturnType<typeof createResourceAssignmentHandlers>) =>
    async (event: IpcMainInvokeEvent, raw: unknown) => {
      try {
        if (!bindings) return assignmentWireFailure("runtime_unavailable");
        if (!trusted(event))
          return assignmentWireFailure("resource_unavailable");
        const current = bindings;
        const result = await createResourceAssignmentHandlers(
          current.assignment,
          current.access,
        )[name](event.sender.id, raw);
        return bindings === current && trusted(event)
          ? result
          : assignmentWireFailure("resource_unavailable");
      } catch {
        console.error("resource_assignment_dispatch_failed");
        return assignmentWireFailure("internal_error");
      }
    };
  ipc.handle(IPC_CHANNELS.RESOURCE_ASSIGNMENT_GET, assignmentInvoke("get"));
  ipc.handle(
    IPC_CHANNELS.RESOURCE_ASSIGNMENT_SET,
    assignmentInvoke("setDesired"),
  );
  ipc.handle(IPC_CHANNELS.RESOURCE_ASSIGNMENT_RETRY, assignmentInvoke("retry"));
  ipc.handle(
    IPC_CHANNELS.RESOURCE_ASSIGNMENT_CANCEL_PENDING,
    assignmentInvoke("cancelPending"),
  );
  ipc.handle(
    IPC_CHANNELS.RESOURCE_ASSIGNMENT_RECOVER,
    assignmentInvoke("recover"),
  );
  ipc.handle(IPC_CHANNELS.RESOURCE_ACTIVITY_LIST, async (event, raw) => {
    try {
      if (!bindings) return activityWireFailure("internal_error");
      if (!trusted(event)) return activityWireFailure("activity_access_denied");
      const current = bindings;
      const result = await createResourceActivityHandlers(
        current.activity,
        current.access,
      ).list(event.sender.id, raw);
      return bindings === current && trusted(event)
        ? result
        : activityWireFailure("activity_access_denied");
    } catch {
      console.error("resource_activity_dispatch_failed");
      return activityWireFailure("internal_error");
    }
  });
}
