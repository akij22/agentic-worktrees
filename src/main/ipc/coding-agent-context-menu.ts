import { BrowserWindow, Menu, type IpcMainInvokeEvent } from "electron";
import {
  codingAgentContextMenuRequestSchema,
  type CodingAgentContextMenuResult,
} from "../../shared/ipc/schemas";

export const createChatContextMenuHandler =
  (sessionExists: (runId: string) => boolean) =>
  async (
    event: IpcMainInvokeEvent,
    rawRequest: unknown,
  ): Promise<CodingAgentContextMenuResult> => {
    try {
      const request = codingAgentContextMenuRequestSchema.safeParse(rawRequest);
      if (!request.success || !sessionExists(request.data.runId)) {
        return {
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "Choose an existing chat.",
          },
        };
      }
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || window.isDestroyed()) {
        return {
          success: false,
          error: {
            code: "MENU_FAILED",
            message: "Could not open the chat menu.",
          },
        };
      }
      return await new Promise<CodingAgentContextMenuResult>((resolve) => {
        let action: "delete" | "dismissed" = "dismissed";
        const menu = Menu.buildFromTemplate([
          {
            label: "Delete chat",
            click: () => {
              action = "delete";
            },
          },
        ]);
        menu.popup({
          window,
          x: request.data.x,
          y: request.data.y,
          callback: () => resolve({ success: true, action }),
        });
      });
    } catch {
      console.error("chat_context_menu_failed");
      return {
        success: false,
        error: {
          code: "MENU_FAILED",
          message: "Could not open the chat menu. Please try again.",
        },
      };
    }
  };
