// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityPicker } from "./CapabilityPicker";
afterEach(cleanup);
describe("CapabilityPicker",()=>{it("activates ready capabilities",async()=>{const activate=vi.fn().mockResolvedValue({}); render(<MemoryRouter><CapabilityPicker runId="run-1" capabilities={[{id:"agentic-worktrees.web-search",name:"Web Search",version:"0.1.0",description:"Search",category:"web-browser",compatibility:{codex:"supported",opencode:"supported"},state:"ready",secretConfigured:false}]} onActivate={activate} onDeactivate={vi.fn()}/></MemoryRouter>); await userEvent.click(screen.getByRole("button",{name:"Capabilities"})); await userEvent.click(screen.getByRole("option",{name:/Web Search/})); expect(activate).toHaveBeenCalledWith("agentic-worktrees.web-search");});});
