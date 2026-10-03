// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type { CapabilityDetailDto } from "../../../../shared/ipc/schemas";
import { Marketplace } from "../../../pages/Marketplace";
import { useWorktreeResourceAssignment } from "../hooks/useWorktreeResourceAssignment";
import { WorktreeResourcePicker } from "./WorktreeResourcePicker";
import { initialProjection } from "./resource-ui-test-fixtures";

afterEach(cleanup);
it("opens the installed Resource's Marketplace configuration, and configuration never auto-assigns it", async () => {
  const detail: CapabilityDetailDto = {
    id: "fetch",
    name: "URL Fetch",
    description: "Fetch pages",
    version: "2.0",
    category: "web-browser",
    source: "bundled",
    trust: "built-in",
    installationState: "needs_setup",
    state: "needs_setup",
    compatibility: { codex: "supported", opencode: "supported" },
    secretConfigured: false,
    activeRunCount: 0,
    sdkVersion: "1",
    author: { name: "App" },
    license: "MIT",
    permissions: { network: ["public-web"], secrets: [] },
    settings: [],
    reviewStatus: "bundled-reviewed",
    providedTools: ["fetch_url"],
    permissionDigest: "permissions",
  };
  const projection = initialProjection();
  projection.resources[1] = {
    ...projection.resources[1],
    assignable: false,
    unavailableReason: "setup_required",
  };
  const configure = vi.fn(async () => detail),
    setDesired = vi.fn();
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      resourceAssignment: {
        get: async () => ({ ok: true, value: projection }),
        onChanged: () => () => undefined,
        setDesired,
      },
      marketplace: {
        list: async () => [{ kind: "capability", capability: detail }],
        onPackageChanged: () => () => undefined,
      },
      capabilities: {
        get: async () => detail,
        onChanged: () => () => undefined,
        configure,
      },
      skills: { onChanged: () => () => undefined },
    },
  });
  function Composer() {
    const assignment = useWorktreeResourceAssignment("wt", "codex"),
      navigate = useNavigate();
    return (
      <WorktreeResourcePicker
        assignment={assignment}
        onOpenMarketplace={(resource) =>
          navigate("/marketplace", { state: { runId: "run", resource } })
        }
      />
    );
  }
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<Composer />} />
        <Route path="/marketplace" element={<Marketplace />} />
      </Routes>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Resources, 1 enabled" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Configure URL Fetch in Marketplace" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Configure URL Fetch" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Configure URL Fetch" }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Accept and continue" }));
  expect(configure).toHaveBeenCalledWith({
    capabilityId: "fetch",
    acceptedPermissionDigest: "permissions",
    settings: {},
    secrets: {},
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(setDesired).not.toHaveBeenCalled();
});
