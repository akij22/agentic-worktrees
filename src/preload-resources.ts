import { z } from "zod";
import type { Api } from "./shared/ipc/api";
import { IPC_CHANNELS, type IpcChannel } from "./shared/ipc/channels";
import * as assignment from "./shared/assignments/schemas";
import * as activity from "./shared/resource-activity/schemas";
import { isBoundedResourcePayload } from "./shared/ipc/resource-wire";

type ResourceApi = Pick<Api, "resourceAssignment" | "resourceActivity">;
type RendererPort = Pick<
  Electron.IpcRenderer,
  "invoke" | "on" | "removeListener"
>;
export class ResourceAdmissionError extends Error {
  readonly code:assignment.AssignmentErrorCode;
  readonly retryable:boolean;
  readonly current?:assignment.AssignmentProjectionDto;
  constructor(error:assignment.AssignmentIpcError) {
    super(error.message);this.name="ResourceAdmissionError";this.code=error.code;this.retryable=error.retryable;this.current=error.current;
  }
}
export async function invokeCodingAgentAdmission<Request,Value>(port:Pick<RendererPort,"invoke">,channel:IpcChannel,raw:Request,requestSchema:z.ZodType<Request>,valueSchema:z.ZodType<Value>):Promise<Value> {
  const request=isBoundedResourcePayload(raw,1_048_576) ? requestSchema.safeParse(raw) : null;
  if(!request?.success)throw new ResourceAdmissionError({code:"assignment_invalid_resource",message:"Invalid agent request.",retryable:false});
  let result:assignment.AssignmentIpcResult<Value>;
  try {
    const response:unknown=await port.invoke(channel,request.data);
    result=assignment.assignmentIpcResultSchema(valueSchema).parse(response);
  } catch {throw new ResourceAdmissionError({code:"internal_error",message:"The agent action could not be completed. Try again.",retryable:true});}
  if(!result.ok)throw new ResourceAdmissionError(result.error);
  return result.value;
}
const assignmentFailure = (
  invalid = false,
): assignment.AssignmentIpcResult<assignment.AssignmentProjectionDto> => ({
  ok: false,
  error: {
    code: invalid ? "assignment_invalid_resource" : "internal_error",
    message: invalid
      ? "Invalid resource request."
      : "Worktree resources could not be loaded. Try again.",
    retryable: !invalid,
  },
});
const activityFailure = (
  invalid = false,
): activity.ResourceActivityIpcResult<activity.SessionResourceActivitySnapshot> => ({
  ok: false,
  error: {
    code: invalid ? "activity_access_denied" : "internal_error",
    message: invalid
      ? "Session activity access was denied."
      : "Session activity could not be loaded. Try again.",
  },
});
export function createResourcePreloadApi(port: RendererPort): ResourceApi {
  async function invoke<Request, Result>(
    channel: IpcChannel,
    raw: Request,
    requestSchema: z.ZodType<Request>,
    resultSchema: z.ZodType<Result>,
    failure: (invalid?: boolean) => Result,
  ): Promise<Result> {
    const request = isBoundedResourcePayload(raw)
      ? requestSchema.safeParse(raw)
      : null;
    if (!request?.success) return failure(true);
    try {
      const response: unknown = await port.invoke(channel, request.data);
      if (!isBoundedResourcePayload(response, 2_097_152)) return failure();
      return resultSchema.parse(response);
    } catch {
      return failure();
    }
  }
  function subscribe<Event>(
    channel: IpcChannel,
    schema: z.ZodType<Event>,
    listener: (event: Event) => void,
    onInvalid?: () => void,
  ): () => void {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown) => {
      const event = isBoundedResourcePayload(raw, 2_097_152)
        ? schema.safeParse(raw)
        : null;
      if (!event?.success) {
        console.error("resource_ipc_invalid_event");
        onInvalid?.();
        return;
      }
      listener(event.data);
    };
    port.on(channel, handler);
    return () => {
      port.removeListener(channel, handler);
    };
  }
  const assignmentResult = assignment.assignmentIpcResultSchema(
    assignment.assignmentProjectionSchema,
  );
  return {
    resourceAssignment: {
      get: (request) =>
        invoke(
          IPC_CHANNELS.RESOURCE_ASSIGNMENT_GET,
          request,
          assignment.assignmentGetRequestSchema,
          assignmentResult,
          assignmentFailure,
        ),
      setDesired: (request) =>
        invoke(
          IPC_CHANNELS.RESOURCE_ASSIGNMENT_SET,
          request,
          assignment.assignmentSetDesiredRequestSchema,
          assignmentResult,
          assignmentFailure,
        ),
      retry: (request) =>
        invoke(
          IPC_CHANNELS.RESOURCE_ASSIGNMENT_RETRY,
          request,
          assignment.assignmentRevisionRequestSchema,
          assignmentResult,
          assignmentFailure,
        ),
      cancelPending: (request) =>
        invoke(
          IPC_CHANNELS.RESOURCE_ASSIGNMENT_CANCEL_PENDING,
          request,
          assignment.assignmentRevisionRequestSchema,
          assignmentResult,
          assignmentFailure,
        ),
      recover: (request) =>
        invoke(
          IPC_CHANNELS.RESOURCE_ASSIGNMENT_RECOVER,
          request,
          assignment.assignmentRecoverRequestSchema,
          assignmentResult,
          assignmentFailure,
        ),
      onChanged: (listener, onInvalid) =>
        subscribe(
          IPC_CHANNELS.RESOURCE_ASSIGNMENT_CHANGED,
          assignment.assignmentChangedEventSchema,
          listener,
          onInvalid,
        ),
    },
    resourceActivity: {
      list: (request) =>
        invoke(
          IPC_CHANNELS.RESOURCE_ACTIVITY_LIST,
          request,
          activity.resourceActivityListRequestSchema,
          activity.resourceActivityIpcResultSchema(
            activity.sessionResourceActivitySnapshotSchema,
          ),
          activityFailure,
        ),
      onChanged: (listener, onInvalid) =>
        subscribe(
          IPC_CHANNELS.RESOURCE_ACTIVITY_CHANGED,
          activity.sessionResourceActivityChangedEventSchema,
          listener,
          onInvalid,
        ),
    },
  };
}
