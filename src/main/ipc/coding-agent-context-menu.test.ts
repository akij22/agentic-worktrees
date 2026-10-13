import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MenuItemConstructorOptions,
  PopupOptions,
  IpcMainInvokeEvent,
} from "electron";
const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  popup: vi.fn(),
  window: { isDestroyed: () => false },
  owner: vi.fn(),
}));
vi.mock("electron", () => ({
  Menu: { buildFromTemplate: mocks.build },
  BrowserWindow: { fromWebContents: mocks.owner },
}));
import { createChatContextMenuHandler } from "./coding-agent-context-menu";
const event = { sender: {} } as IpcMainInvokeEvent;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.owner.mockReturnValue(mocks.window);
  mocks.build.mockReturnValue({ popup: mocks.popup });
});
describe("native chat menu", () => {
  it("opens an OS menu in the originating window and reports selection after it closes", async () => {
    mocks.popup.mockImplementation((options: PopupOptions) => {
      const template: MenuItemConstructorOptions[] =
        mocks.build.mock.calls[0][0];
      (template[0].click as () => void)();
      options.callback?.();
    });
    const handler = createChatContextMenuHandler(() => true);
    expect(await handler(event, { runId: "chat", x: 50, y: 70 })).toEqual({
      success: true,
      action: "delete",
    });
    expect(mocks.popup).toHaveBeenCalledWith(
      expect.objectContaining({ window: mocks.window, x: 50, y: 70 }),
    );
    expect(mocks.build.mock.calls[0][0]).toEqual([
      expect.objectContaining({ label: "Delete chat" }),
    ]);
  });
  it("reports dismissal without deletion", async () => {
    mocks.popup.mockImplementation((options: PopupOptions) =>
      options.callback?.(),
    );
    expect(
      await createChatContextMenuHandler(() => true)(event, {
        runId: "chat",
        x: 0,
        y: 0,
      }),
    ).toEqual({ success: true, action: "dismissed" });
  });
  it("rejects invalid payloads and unknown chats without opening a menu", async () => {
    const handler = createChatContextMenuHandler(() => false);
    expect(await handler(event, { runId: "chat", x: -1, y: 0 })).toMatchObject({
      success: false,
    });
    expect(
      await handler(event, { runId: "missing", x: 0, y: 0 }),
    ).toMatchObject({ success: false });
    expect(mocks.build).not.toHaveBeenCalled();
  });
});

it("sanitizes failures while validating the selected chat", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const handler = createChatContextMenuHandler(() => {
      throw new Error("/private/path");
    });
    const result = await handler(event, { runId: "chat", x: 0, y: 0 });
    expect(result).toMatchObject({
      success: false,
      error: { code: "MENU_FAILED" },
    });
    expect(JSON.stringify(result)).not.toContain("/private/path");
  } finally {
    log.mockRestore();
  }
});
