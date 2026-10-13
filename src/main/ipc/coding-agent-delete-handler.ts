import {
  codingAgentSessionDeleteRequestSchema,
  type CodingAgentSessionDeleteResult,
} from "../../shared/ipc/schemas";
import { ActiveChatDeletionError } from "../coding-agents/types";

export const createCodingAgentDeleteHandler =
  (remove: (runId: string) => Promise<void>) =>
  async (
    _event: unknown,
    rawRequest: unknown,
  ): Promise<CodingAgentSessionDeleteResult> => {
    const request = codingAgentSessionDeleteRequestSchema.safeParse(rawRequest);
    if (!request.success) {
      return {
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Choose a valid chat to delete.",
        },
      };
    }
    try {
      await remove(request.data.runId);
      return { success: true };
    } catch (error) {
      if (error instanceof ActiveChatDeletionError) {
        return {
          success: false,
          error: { code: "SESSION_ACTIVE", message: error.message },
        };
      }
      console.error("chat_deletion_failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      return {
        success: false,
        error: {
          code: "DELETE_FAILED",
          message: "Could not delete this chat. Please try again.",
        },
      };
    }
  };
