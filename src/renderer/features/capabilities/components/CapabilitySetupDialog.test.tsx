// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilitySetupDialog } from "./CapabilitySetupDialog";

afterEach(cleanup);
describe("CapabilitySetupDialog",()=>{it("supports keyless consent",async()=>{const configure=vi.fn().mockResolvedValue({}); render(<CapabilitySetupDialog open capability={{id:"agentic-worktrees.web-search",name:"Web Search",permissionDigest:"digest"} as never} onOpenChange={vi.fn()} onConfigure={configure}/>); expect(screen.getByText(/queries and requested options are sent to Exa/i)).toBeTruthy(); expect(screen.getByLabelText("Exa API key (optional)")).toBeTruthy(); await userEvent.click(screen.getByRole("button",{name:"Accept and continue"})); expect(configure).toHaveBeenCalledWith({capabilityId:"agentic-worktrees.web-search",acceptedPermissionDigest:"digest",settings:{providerMode:"auto",resultLimit:5}});});});
