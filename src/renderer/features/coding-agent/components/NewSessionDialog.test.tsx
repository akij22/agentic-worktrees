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

  const renderDialog = async (open: boolean) => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <NewSessionDialog
            open={open}
            contexts={contexts}
            installations={installations}
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
    const options = findAll(harness, (element) => element.tagName === "OPTION");
    const create = findAll(
      container,
      (element) => element.tagName === "BUTTON" && element.textContent === "Create chat",
    )[0];

    expect(options.map((option) => option.textContent)).toEqual([
      "Select a coding agent…",
      "OpenCode",
      "Codex (not configured)",
    ]);
    expect(options[2]?.disabled).toBe(true);
    expect(create?.disabled).toBe(true);

    await act(async () => {
      harness.value = "opencode";
      harness.dispatchEvent(new Event("change", { bubbles: true }));
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
    expect(reopenedHarness.value).toBe("");
    expect(reopenedCreate.disabled).toBe(true);

    await act(async () => {
      reopenedHarness.value = "opencode";
      reopenedHarness.dispatchEvent(new Event("change", { bubbles: true }));
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
});
