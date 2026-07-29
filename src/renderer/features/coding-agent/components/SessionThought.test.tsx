import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionThought } from "./SessionThought";

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
    this.listeners.get(type)?.add(listener) ?? this.listeners.set(type, new Set([listener]));
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
    while (event.bubbles && !event.cancelBubble && current) {
      notify(current);
      current = current.parentNode;
    }
    return !event.defaultPrevented;
  }
}

class TestText extends TestNode {
  constructor(ownerDocument: TestDocument, private data: string) {
    super(ownerDocument, 3, "#text");
  }

  override get textContent(): string {
    return this.data;
  }

  override set textContent(value: string) {
    this.data = value;
  }
}

class TestElement extends TestNode {
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  className = "";
  hidden = false;
  style: Record<string, string> & { setProperty: (name: string, value: string) => void };
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
    if (name === "hidden") this.hidden = true;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === "hidden") this.hidden = false;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

class TestDocument extends TestNode {
  documentElement: TestElement;
  body: TestElement;
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

describe("SessionThought", () => {
  let document: TestDocument;
  let container: TestElement;
  let root: import("react-dom/client").Root;

  const renderThought = async (text: string) => {
    await act(async () => {
      root.render(<SessionThought agentName="OpenCode" text={text} />);
    });
  };

  const findControl = (label: string): TestElement => {
    const control = findAll(
      container,
      (element) =>
        element.tagName === "BUTTON" && element.getAttribute("aria-label") === label,
    )[0];
    if (!control) throw new Error(`Missing ${label} control`);
    return control;
  };

  const findThoughtBody = (control: TestElement): TestElement => {
    const contentId = control.getAttribute("aria-controls");
    const body = findAll(
      container,
      (element) => element.getAttribute("id") === contentId,
    )[0];
    if (!body) throw new Error("Missing thought body");
    return body;
  };

  beforeEach(async () => {
    document = new TestDocument();
    container = document.createElement("div");
    document.body.appendChild(container);
    const window = {
      document,
      addEventListener: (...args: Parameters<TestNode["addEventListener"]>) =>
        document.addEventListener(...args),
      removeEventListener: (...args: Parameters<TestNode["removeEventListener"]>) =>
        document.removeEventListener(...args),
      setTimeout,
      clearTimeout,
      HTMLElement: TestElement,
      HTMLIFrameElement: class {},
      Node: TestNode,
    };
    document.defaultView = window;
    Object.defineProperty(globalThis, "window", { configurable: true, value: window });
    Object.defineProperty(globalThis, "document", { configurable: true, value: document });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    const { createRoot } = await import("react-dom/client");
    root = createRoot(container as unknown as Element);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("renders every thought as a collapsed thinking disclosure", () => {
    const markup = renderToStaticMarkup(
      <SessionThought agentName="OpenCode" text="Inspecting the repository." />,
    );

    expect(markup).toContain("Thinking...");
    expect(markup).toContain("Inspecting the repository.");
    expect(markup).toContain('aria-label="Expand thinking"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it("starts a long thought collapsed with an accessible control", () => {
    const markup = renderToStaticMarkup(
      <SessionThought agentName="OpenCode" text={"x".repeat(481)} />,
    );

    expect(markup).toContain("Thinking...");
    expect(markup).toContain('aria-label="Expand thinking"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it("expands, compacts, and stays expanded while the same long thought streams", async () => {
    await renderThought("x".repeat(481));
    const expand = findControl("Expand thinking");

    await act(async () => {
      expand.dispatchEvent(new Event("click", { bubbles: true }));
    });
    const collapse = findControl("Collapse thinking");
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(findThoughtBody(collapse).hidden).toBe(false);

    await renderThought("x".repeat(600));
    const updatedCollapse = findControl("Collapse thinking");
    expect(updatedCollapse.getAttribute("aria-expanded")).toBe("true");
    expect(findThoughtBody(updatedCollapse).textContent).toBe("x".repeat(600));

    await act(async () => {
      updatedCollapse.dispatchEvent(new Event("click", { bubbles: true }));
    });
    const updatedExpand = findControl("Expand thinking");
    expect(updatedExpand.getAttribute("aria-expanded")).toBe("false");
    expect(findThoughtBody(updatedExpand).hidden).toBe(true);
  });
});
