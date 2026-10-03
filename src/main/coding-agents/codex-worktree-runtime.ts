// eslint-disable-next-line import/no-unresolved
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// eslint-disable-next-line import/no-unresolved
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  ActivityLineage,
  ResourceActivityObservation,
} from "../../shared/resource-activity";
import type { CodingAgentCapabilityConnection } from "./types";
import type { CapabilityHostObservation } from "../capabilities/capability-receipt";
import type {
  ResourceActivityEvidenceService,
  ProviderEvidenceContract,
} from "../resource-activity/resource-activity-evidence-service";
export const CODEX_RUNTIME_VERSION = "0.154.0";
export const CODEX_ACTIVITY_CONTRACT = "codex/0.154.0/assignment-v1";
export const CODEX_SKILL_ISOLATION = "not_enforced" as const;
export interface CodexAssignedSkill {
  name: string;
  identity: ResourceActivityObservation["identity"];
  files: ReadonlyArray<{ relativePath: string; content: string }>;
}
export interface CodexOwnedHostObservation {
  runtimeGeneration: string;
  serverName: string;
  observation: CapabilityHostObservation;
  dispatchSessionId?: string;
}
export interface CodexWorktreeRuntimeOptions {
  namespaceRoot: string;
  directory: string;
  sessionDataRoot?: string;
  lineage: ActivityLineage;
  skills: readonly CodexAssignedSkill[];
  capabilities: readonly CodingAgentCapabilityConnection[];
  capabilityTools: ReadonlyArray<{
    serverName: string;
    toolName: string;
    hostToolName: string;
    identity: ResourceActivityObservation["identity"];
  }>;
  environment: Readonly<NodeJS.ProcessEnv>;
  evidence?: ResourceActivityEvidenceService;
  verifyAttestation?(lineage: ActivityLineage): Promise<boolean>;
  onVerified?(effectiveStateDigest: string): Promise<void>;
  onUnavailable?(lineage: ActivityLineage): void;
  subscribeHostObservations?(
    listener: (input: CodexOwnedHostObservation) => void,
  ): () => void;
  /** Centrally supplied provider endpoint; never sourced from renderer payloads. */
  modelProvider?: { id: string; name: string; baseUrl: string };
}

import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  readFile,
  mkdir,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { validateSkillPackage } from "../skills/skill-validation";
function fail(): never {
  throw new Error("Codex Worktree Resource verification failed.");
}
export class CodexRuntimeProjection {
  readonly options: CodexWorktreeRuntimeOptions;
  readonly root: string;
  readonly skillRoot: string;
  readonly dataRoot: string;
  private ownerMarker?: string;
  private dataIdentity?: { dev: number; ino: number };
  private configText = "";
  private initialized = false;
  private readonly files = new Map<string, { dev: number; ino: number }>();
  constructor(options: CodexWorktreeRuntimeOptions) {
    const {
      evidence,
      verifyAttestation,
      onVerified,
      onUnavailable,
      subscribeHostObservations,
      ...data
    } = options;
    const snapshot = structuredClone({
      ...data,
      skills: data.skills.map((skill) => ({
        ...skill,
        files: skill.files.map((file) => ({
          relativePath: file.relativePath,
          content: file.content,
        })),
      })),
    });
    const freeze = (v: unknown): void => {
      if (v && typeof v === "object") {
        Object.values(v).forEach(freeze);
        Object.freeze(v);
      }
    };
    freeze(snapshot);
    this.options = Object.freeze({
      ...snapshot,
      evidence,
      verifyAttestation,
      onVerified,
      onUnavailable,
      subscribeHostObservations,
    });
    this.root = resolve(options.namespaceRoot);
    this.skillRoot = join(this.root, "skills");
    this.dataRoot = resolve(options.sessionDataRoot ?? join(this.root, "data"));
    if (
      options.lineage.provider !== "codex" ||
      options.lineage.providerVersion !== CODEX_RUNTIME_VERSION ||
      options.lineage.adapterContractVersion !== 1
    )
      fail();
    const servers = new Set<string>(),
      tools = new Set<string>();
    for (const connection of this.options.capabilities) {
      if (
        !/^[a-zA-Z0-9_-]+$/.test(connection.serverName) ||
        servers.has(connection.serverName) ||
        !connection.authorizationHeader ||
        !/^https?:$/.test(new URL(connection.url).protocol)
      )
        fail();
      servers.add(connection.serverName);
    }
    for (const tool of this.options.capabilityTools) {
      const key = `${tool.serverName}\0${tool.toolName}`;
      if (tools.has(key) || tool.identity.resourceKind !== "capability") fail();
      tools.add(key);
    }
    const names = new Set<string>();
    for (const skill of this.options.skills) {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) ||
        names.has(skill.name) ||
        skill.identity.resourceKind !== "skill" ||
        skill.identity.resourceId !== skill.name
      )
        fail();
      names.add(skill.name);
    }
  }
  async prepare(): Promise<void> {
    if (this.initialized) {
      await this.verifyFiles();
      return;
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (
      (await realpath(this.root)) !== this.root ||
      (await readdir(this.root)).length ||
      (await lstat(this.root)).mode & 0o077
    )
      fail();
    for (const directory of ["home", "data", ".skills"])
      await mkdir(join(this.root, directory), { mode: 0o700 });
    if (this.options.sessionDataRoot) {
      await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
      if (
        (await realpath(this.dataRoot)) !== this.dataRoot ||
        (await lstat(this.dataRoot)).mode & 0o077
      )
        fail();
      this.ownerMarker = JSON.stringify({
        provider: "codex",
        worktreeId: this.options.lineage.worktreeId,
      });
      const marker = join(this.dataRoot, ".aw-worktree-owner"),
        entries = await readdir(this.dataRoot);
      if (entries.length && !entries.includes(".aw-worktree-owner")) fail();
      try {
        await writeFile(marker, this.ownerMarker, { flag: "wx", mode: 0o400 });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          (await readFile(marker, "utf8")) !== this.ownerMarker
        )
          fail();
      }
      const stat = await lstat(marker);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.mode & 0o277
      )
        fail();
    }
    for (const skill of this.options.skills) {
      const root = join(this.root, ".skills", skill.name);
      await mkdir(root, { mode: 0o700 });
      for (const file of skill.files) {
        const path = resolve(root, file.relativePath);
        if (
          !path.startsWith(root + sep) ||
          file.relativePath.includes("\\") ||
          file.relativePath
            .split("/")
            .some((p) => p === ".." || p === "." || !p)
        )
          fail();
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, file.content, { flag: "wx", mode: 0o400 });
      }
      const validated = await validateSkillPackage(root);
      if (
        validated.contentDigest !== skill.identity.resourceDigest ||
        validated.descriptor.id !== skill.name ||
        validated.descriptor.name !== skill.name
      )
        fail();
    }
    const seal = async (path: string): Promise<void> => {
      for (const entry of await readdir(path, { withFileTypes: true }))
        if (entry.isDirectory()) await seal(join(path, entry.name));
      await chmod(path, 0o500);
    };
    await seal(join(this.root, ".skills"));
    await rename(join(this.root, ".skills"), this.skillRoot);
    const capture = async (path: string): Promise<void> => {
      const stat = await lstat(path);
      this.files.set(path, { dev: stat.dev, ino: stat.ino });
      if (stat.isDirectory())
        for (const name of await readdir(path)) await capture(join(path, name));
    };
    await capture(this.skillRoot);
    const dataStat = await lstat(this.dataRoot);
    this.dataIdentity = { dev: dataStat.dev, ino: dataStat.ino };
    if (this.ownerMarker)
      await capture(join(this.dataRoot, ".aw-worktree-owner"));
    const lines: string[] = [];
    for (const connection of this.options.capabilities) {
      lines.push(
        `[mcp_servers.${JSON.stringify(connection.serverName)}]`,
        `url = ${JSON.stringify(connection.url)}`,
        'default_tools_approval_mode = "approve"',
        `[mcp_servers.${JSON.stringify(connection.serverName)}.http_headers]`,
        `Authorization = ${JSON.stringify(connection.authorizationHeader)}`,
        "",
      );
    }
    if (this.options.modelProvider) {
      const model = this.options.modelProvider;
      lines.unshift(`model_provider = ${JSON.stringify(model.id)}`, "");
      lines.push(
        `[model_providers.${JSON.stringify(model.id)}]`,
        `name = ${JSON.stringify(model.name)}`,
        `base_url = ${JSON.stringify(model.baseUrl)}`,
        'wire_api = "responses"',
        "requires_openai_auth = false",
        "supports_websockets = false",
      );
    }
    lines.push(
      "",
      `[projects.${JSON.stringify(this.options.directory)}]`,
      'trust_level = "trusted"',
    );
    const configPath = join(this.dataRoot, "config.toml");
    this.configText = lines.join("\n") + "\n";
    const stagedConfig = join(this.root, ".config.toml");
    await writeFile(stagedConfig, this.configText, { flag: "wx", mode: 0o400 });
    await rename(stagedConfig, configPath);
    await capture(configPath);

    this.initialized = true;
    await this.verifyFiles();
  }
  capabilityConfig(): Record<string, unknown> {
    return {
      ...(this.options.modelProvider
        ? {
            model_provider: this.options.modelProvider.id,
            model_providers: {
              [this.options.modelProvider.id]: {
                name: this.options.modelProvider.name,
                base_url: this.options.modelProvider.baseUrl,
                wire_api: "responses",
                requires_openai_auth: false,
                supports_websockets: false,
              },
            },
          }
        : {}),
      mcp_servers: Object.fromEntries(
        this.options.capabilities.map((connection) => [
          connection.serverName,
          {
            url: connection.url,
            http_headers: { Authorization: connection.authorizationHeader },
            default_tools_approval_mode: "approve",
          },
        ]),
      ),
    };
  }
  environment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      "PATH",
      "TMPDIR",
      "OPENAI_API_KEY",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "SSL_CERT_FILE",
      "NODE_EXTRA_CA_CERTS",
    ]) {
      const value = this.options.environment[key];
      if (value !== undefined) env[key] = value;
    }
    return { ...env, HOME: join(this.root, "home"), CODEX_HOME: this.dataRoot };
  }
  async verifyFiles(): Promise<void> {
    if (
      (await realpath(this.root)) !== this.root ||
      (await lstat(this.root)).mode & 0o077 ||
      (await realpath(this.dataRoot)) !== this.dataRoot
    )
      fail();
    const dataStat = await lstat(this.dataRoot);
    if (
      !this.dataIdentity ||
      dataStat.dev !== this.dataIdentity.dev ||
      dataStat.ino !== this.dataIdentity.ino ||
      dataStat.isSymbolicLink() ||
      dataStat.mode & 0o077
    )
      fail();
    if (
      this.ownerMarker &&
      (await readFile(join(this.dataRoot, ".aw-worktree-owner"), "utf8")) !==
        this.ownerMarker
    )
      fail();
    if (
      (await readFile(join(this.dataRoot, "config.toml"), "utf8")) !==
      this.configText
    )
      fail();
    for (const [path, identity] of this.files) {
      const stat = await lstat(path);
      if (
        stat.dev !== identity.dev ||
        stat.ino !== identity.ino ||
        stat.isSymbolicLink() ||
        stat.mode & 0o277
      )
        fail();
    }
    if (
      (await readdir(this.skillRoot)).sort().join("\0") !==
      this.options.skills
        .map((s) => s.name)
        .sort()
        .join("\0")
    )
      fail();
    for (const skill of this.options.skills)
      if (
        (await validateSkillPackage(join(this.skillRoot, skill.name)))
          .contentDigest !== skill.identity.resourceDigest
      )
        fail();
  }

  async verifyOwnedHostCatalog(): Promise<void> {
    for (const connection of this.options.capabilities) {
      const client = new Client({
        name: "aw-codex-runtime-attestation",
        version: "1",
      });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(connection.url), {
            requestInit: {
              headers: { Authorization: connection.authorizationHeader },
              signal: AbortSignal.timeout(10000),
            },
          }),
        );
        const catalog = await client.listTools({}, { timeout: 10000 });
        const expected = this.options.capabilityTools
          .filter((t) => t.serverName === connection.serverName)
          .map((t) => t.hostToolName)
          .sort();
        if (
          catalog.nextCursor ||
          client.getInstructions() ||
          client.getServerCapabilities()?.prompts ||
          catalog.tools
            .map((t) => t.name)
            .sort()
            .join("\0") !== expected.join("\0")
        )
          fail();
      } finally {
        await client.close();
      }
    }
  }
  assertDirectory(directory: string): void {
    if (resolve(directory) !== resolve(this.options.directory))
      throw new Error("Codex Worktree directory mismatch.");
  }
  verifyCatalog(value: unknown): void {
    const data =
      value && typeof value === "object" && "data" in value ? value.data : null;
    if (!Array.isArray(data)) fail();
    const groups = data as Array<{
      cwd?: string;
      skills?: Array<{ name: string; path: string; enabled: boolean }>;
      errors?: unknown[];
    }>;
    const group = groups.find((g) => g.cwd === this.options.directory);
    if (
      !group ||
      !Array.isArray(group.skills) ||
      !Array.isArray(group.errors) ||
      group.errors.length
    )
      fail();
    for (const skill of this.options.skills) {
      if (
        group.skills.filter(
          (s) =>
            s.name === skill.name &&
            s.path === join(this.skillRoot, skill.name, "SKILL.md") &&
            s.enabled === true,
        ).length !== 1
      )
        fail();
    }
    // Additional ambient/native entries are not claimed to be excluded on Codex.
  }
}

export const codexBodyDigest = (body: string): string =>
  `sha256:${createHash("sha256").update(body).digest("hex")}`;
export function createCodexEvidenceContract(
  options: CodexWorktreeRuntimeOptions,
): ProviderEvidenceContract {
  const snapshot = structuredClone({
    lineage: options.lineage,
    skills: options.skills,
    tools: options.capabilityTools,
  });
  const matches = (lineage: ActivityLineage) =>
    Object.keys(snapshot.lineage).every(
      (key) =>
        lineage[key as keyof ActivityLineage] ===
        snapshot.lineage[key as keyof ActivityLineage],
    );
  const tool = (lineage: ActivityLineage, server: string, name: string) =>
    matches(lineage)
      ? snapshot.tools.find(
          (t) => t.serverName === server && t.toolName === name,
        )
      : undefined;
  const skill = (lineage: ActivityLineage, name: string) =>
    matches(lineage) ? snapshot.skills.find((s) => s.name === name) : undefined;
  return {
    name: CODEX_ACTIVITY_CONTRACT,
    provider: "codex",
    providerVersion: CODEX_RUNTIME_VERSION,
    adapterContractVersion: 1,
    automaticSkillContextQualified: false,
    resolveTool: (l, s, t) => tool(l, s, t)?.identity ?? null,
    resolveHostTool: (l, s, t) => tool(l, s, t)?.hostToolName ?? null,
    resolveSkill: (l, s) => skill(l, s)?.identity ?? null,
    resolveSkillBodyDigest: (l, s) => {
      const body = skill(l, s)?.files.find(
        (f) => f.relativePath === "SKILL.md",
      )?.content;
      return body ? codexBodyDigest(body) : null;
    },
  };
}
