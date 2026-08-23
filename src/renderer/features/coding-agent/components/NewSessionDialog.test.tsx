import { act } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CodingAgentInstallationStatusDto,
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import { NewSessionDialog } from "./NewSessionDialog";

type Listener = (event: Event) => void;

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  ownerDocument: TestDocument;
  readonly nodeType: number;
  readonly nodeName: string;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(ownerDocument: TestDocument, nodeType: number, nodeName: string) {
    this.ownerDocument = ownerDocument;
    this.nodeType = nodeType;
    this.nodeName = nodeName;
  }

  get firstChild(): TestNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): TestNode | null {
    return this.childNodes.at(-1) ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.childNodes = value ? [new TestText(this.ownerDocument, value)] : [];
    this.childNodes.forEach((child) => {
      child.parentNode = this;
    });
  }

  appendChild<T extends TestNode>(child: T): T {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore<T extends TestNode>(child: T, before: TestNode | null): T {
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild<T extends TestNode>(child: T): T {
    this.childNodes = this.childNodes.filter((candidate) => candidate !== child);
    child.parentNode = null;
    return child;
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    if (!event.target) {
      Object.defineProperty(event, "target", { configurable: true, value: this });
    }
    const notify = (node: TestNode) => {
      Object.defineProperty(event, "currentTarget", {
        configurable: true,
        value: node,
      });
      node.listeners.get(event.type)?.forEach((listener) => listener(event));
    };
    notify(this);
    let current = this.parentNode;
    if (!event.bubbles || event.cancelBubble) return !event.defaultPrevented;
    while (current) {
      notify(current);
      if (!event.bubbles || event.cancelBubble) break;
      current = current.parentNode;
    }
    return !event.defaultPrevented;
  }
}

class TestText extends TestNode {
  data: string;

  constructor(ownerDocument: TestDocument, data: string) {
    super(ownerDocument, 3, "#text");
    this.data = data;
  }

  override get textContent() {
    return this.data;
  }

  override set textContent(value: string) {
    this.data = value;
  }
}

class TestElement extends TestNode {
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  style: Record<string, string> & { setProperty: (name: string, value: string) => void };
  className = "";
  value = "";
  disabled = false;
  selected = false;
  defaultSelected = false;
  multiple = false;
  onclick: (() => void) | null = null;
  private readonly attributes = new Map<string, string>();

  constructor(ownerDocument: TestDocument, tagName: string) {
    super(ownerDocument, 1, tagName.toUpperCase());
    this.tagName = tagName.toUpperCase();
    this.style = Object.assign(Object.create(null) as Record<string, string>, {
      setProperty: (name: string, value: string) => {
        this.style[name] = value;
      },
    });
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
    if (name === "value") this.value = String(value);
    if (name === "disabled") this.disabled = true;
    if (name === "multiple") this.multiple = true;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === "disabled") this.disabled = false;
    if (name === "multiple") this.multiple = false;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  get options(): TestElement[] {
    return findAll(this, (element) => element.tagName === "OPTION");
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }
}

class TestDocument extends TestNode {
  documentElement: TestElement;
  body: TestElement;
  activeElement: TestElement | null = null;
  defaultView: Record<string, unknown> = {};

  constructor() {
    super(undefined as unknown as TestDocument, 9, "#document");
    this.ownerDocument = this;
    this.documentElement = new TestElement(this, "html");
    this.body = new TestElement(this, "body");
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tagName: string): TestElement {
    return new TestElement(this, tagName);
  }

  createElementNS(_namespace: string, tagName: string): TestElement {
    return this.createElement(tagName);
  }

  createTextNode(data: string): TestText {
    return new TestText(this, data);
  }
}

const findAll = (
  node: TestNode,
  predicate: (element: TestElement) => boolean,
): TestElement[] => {
  const own = node instanceof TestElement && predicate(node) ? [node] : [];
  return own.concat(...node.childNodes.map((child) => findAll(child, predicate)));
};

const installations: CodingAgentInstallationStatusDto[] = [
  {
    kind: "opencode",
    name: "OpenCode",
    configured: true,
    executablePath: "/usr/local/bin/opencode",
    version: "1.17.18",
    running: false,
    error: null,
  },
  {
    kind: "codex",
    name: "Codex",
    configured: false,
    executablePath: null,
    version: null,
    running: false,
    error: null,
  },
];

const contexts = [
  {
    repository: { id: "repository", fullName: "owner/repository" },
    worktree: {
      id: "worktree",
      name: "feature",
      branchName: "feature/harness",
    },
  } as CodingAgentWorktreeContextDto,
];

const LocationProbe = () => {
  const location = useLocation();
  return <output data-location={location.pathname} />;
};

describe("NewSessionDialog", () => {
  let document: TestDocument;
  let container: TestElement;
  let root: import("react-dom/client").Root;
  const createSession = vi.fn<() => Promise<CodingAgentSessionDto>>();

  const renderDialog = async (
    open: boolean,
    availableContexts = contexts,
    initialWorktreeId?: string,
  ) => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <NewSessionDialog
            open={open}
            contexts={availableContexts}
            installations={installations}
            initialWorktreeId={initialWorktreeId}
            onClose={vi.fn()}
          />
          <LocationProbe />
        </MemoryRouter>,
      );
    });
  };

  beforeEach(async () => {
    document = new TestDocument();
    container = document.createElement("div");
    document.body.appendChild(container);
    const window = {
      document,
      api: { codingAgent: { createSession } },
      addEventListener: (...args: Parameters<TestNode["addEventListener"]>) =>
        document.addEventListener(...args),
      removeEventListener: (...args: Parameters<TestNode["removeEventListener"]>) =>
        document.removeEventListener(...args),
      setTimeout,
      clearTimeout,
      HTMLElement: TestElement,
      HTMLIFrameElement: class {},
      Node: TestNode,
      getSelection: () => null,
    };
    document.defaultView = window;
    Object.defineProperty(globalThis, "window", { configurable: true, value: window });
    Object.defineProperty(globalThis, "document", { configurable: true, value: document });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    createSession.mockReset();
    createSession.mockResolvedValue({
      id: "run",
      agentKind: "opencode",
      agentName: "OpenCode",
    } as CodingAgentSessionDto);
    const { createRoot } = await import("react-dom/client");
    root = createRoot(container as unknown as Element);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("requires a configured harness, resets the choice, and sends agentKind", async () => {
    await renderDialog(true);
    const harness = findAll(
      container,
      (element) => element.getAttribute("id") === "coding-agent-harness",
    )[0];
    const create = findAll(
      container,
      (element) => element.tagName === "BUTTON" && element.textContent === "Create chat",
    )[0];

    expect(harness.textContent).toBe("Select a coding agent…");
    expect(create?.disabled).toBe(true);

    await act(async () => {
      harness.dispatchEvent(new Event("click", { bubbles: true }));
    });
    const harnessOptions = findAll(
      container,
      (element) => element.getAttribute("role") === "option",
    );
    expect(harnessOptions.map((option) => option.textContent)).toEqual([
      "OpenCode",
      "CodexNot configured",
    ]);
    expect(harnessOptions[1]?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      harnessOptions[0]?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(create.disabled).toBe(false);

    await renderDialog(false);
    await renderDialog(true);
    const reopenedHarness = findAll(
      container,
      (element) => element.getAttribute("id") === "coding-agent-harness",
    )[0];
    const reopenedCreate = findAll(
      container,
      (element) => element.tagName === "BUTTON" && element.textContent === "Create chat",
    )[0];
    expect(reopenedCreate.disabled).toBe(true);

    await act(async () => {
      reopenedHarness.dispatchEvent(new Event("click", { bubbles: true }));
    });
    const reopenedOption = findAll(
      container,
      (element) =>
        element.getAttribute("role") === "option" &&
        element.textContent === "OpenCode",
    )[0];
    await act(async () => {
      reopenedOption?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await act(async () => {
      reopenedCreate.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(createSession).toHaveBeenCalledWith({
      agentKind: "opencode",
      worktreeId: "worktree",
      title: "New coding session",
    });
    expect(
      findAll(container, (element) => element.tagName === "OUTPUT")[0]?.getAttribute(
        "data-location",
      ),
    ).toBe("/coding-agent/worktree/run");

  });

  it("groups worktrees by project without exposing repository paths", async () => {
    const groupedContexts = [
      {
        repository: {
          id: "project-a",
          name: "MatchMovie",
          fullName: "owner/MatchMovie",
          localRootPath: "/Users/example/projects/MatchMovie",
        },
        worktree: {
          id: "worktree-a-1",
          name: "wt-home",
          branchName: "fix/home-page",
        },
      },
      {
        repository: {
          id: "project-a",
          name: "MatchMovie",
          fullName: "owner/MatchMovie",
          localRootPath: "/Users/example/projects/MatchMovie",
        },
        worktree: {
          id: "worktree-a-2",
          name: "wt-search",
          branchName: "feat/search",
        },
      },
      {
        repository: {
          id: "project-b",
          name: "skratch_clone",
          fullName: "FLUTTER/skratch_clone",
          localRootPath: "/Users/example/projects/skratch_clone",
        },
        worktree: {
          id: "worktree-b-1",
          name: "wt-opt",
          branchName: "fix/opt",
        },
      },
    ] as CodingAgentWorktreeContextDto[];

    await renderDialog(true, groupedContexts);

    const worktreeTrigger = findAll(
      container,
      (element) => element.getAttribute("id") === "agent-worktree",
    )[0];
    await act(async () => {
      worktreeTrigger.dispatchEvent(new Event("click", { bubbles: true }));
    });
    const worktreeListbox = findAll(
      container,
      (element) =>
        element.getAttribute("role") === "listbox" &&
        element.getAttribute("aria-label") === "Workspace",
    )[0];
    const options = findAll(
      worktreeListbox,
      (element) => element.getAttribute("role") === "option",
    );
    expect(options.map((option) => option.textContent)).toEqual([
      "wt-home · fix/home-pageMatchMovie",
      "wt-search · feat/searchMatchMovie",
      "wt-opt · fix/optskratch_clone",
    ]);
    expect(worktreeListbox.textContent).not.toContain("owner/MatchMovie");
    expect(worktreeListbox.textContent).not.toContain("/Users/example/projects");
  });

  it("defaults to the primary checkout and preserves an explicit linked selection", async () => {
    const availableContexts = [
      {
        repository: { id: "repository", name: "Project" },
        worktree: {
          id: "linked-1",
          kind: "linked",
          name: "feature-ui",
          branchName: "feat/ui",
        },
      },
      {
        repository: { id: "repository", name: "Project" },
        worktree: {
          id: "primary:repository",
          kind: "primary",
          name: "Main checkout",
          branchName: "main",
        },
      },
    ] as CodingAgentWorktreeContextDto[];

    await renderDialog(true, availableContexts);
    let workspace = findAll(
      container,
      (element) => element.getAttribute("id") === "agent-worktree",
    )[0];
    await act(async () => {
      workspace.dispatchEvent(new Event("click", { bubbles: true }));
    });
    let workspaceOptions = findAll(
      container,
      (element) => element.getAttribute("role") === "option",
    );
    expect(workspaceOptions.map((option) => option.textContent)).toEqual([
      "Main checkout · mainProject",
      "feature-ui · feat/uiProject",
    ]);
    expect(
      workspaceOptions.find(
        (option) => option.getAttribute("aria-selected") === "true",
      )?.textContent,
    ).toContain("Main checkout · main");
    expect(container.textContent).toContain(
      "Changes are applied directly to the shared checkout",
    );

    await renderDialog(true, availableContexts, "linked-1");
    workspace = findAll(
      container,
      (element) => element.getAttribute("id") === "agent-worktree",
    )[0];
    await act(async () => {
      workspace.dispatchEvent(new Event("click", { bubbles: true }));
    });
    workspaceOptions = findAll(
      container,
      (element) => element.getAttribute("role") === "option",
    );
    expect(
      workspaceOptions.find(
        (option) => option.getAttribute("aria-selected") === "true",
      )?.textContent,
    ).toContain("feature-ui · feat/ui");
    expect(container.textContent).not.toContain(
      "Changes are applied directly to the shared checkout",
    );
  });
});
