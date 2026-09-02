// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCapabilities } from "./useCapabilities";

afterEach(() => vi.restoreAllMocks());
describe("useCapabilities", () => { it("loads and subscribes once", async () => { const unsubscribe=vi.fn(); Object.defineProperty(window,"api",{configurable:true,value:{capabilities:{list:vi.fn().mockResolvedValue([]),get:vi.fn(),configure:vi.fn(),activate:vi.fn(),deactivate:vi.fn(),onChanged:vi.fn(() => unsubscribe)}}}); const { unmount }=renderHook(()=>useCapabilities()); await waitFor(()=>expect(window.api.capabilities.list).toHaveBeenCalledOnce()); expect(window.api.capabilities.onChanged).toHaveBeenCalledOnce(); unmount(); expect(unsubscribe).toHaveBeenCalledOnce(); }); });
