import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import type {
  ActivityLineage,
  ResourceActivityObservation,
} from "../../shared/resource-activity";
import { validateSkillPackage } from "../skills/skill-validation";
import type { CodingAgentCapabilityConnection } from "./types";
import { normalizeOpenCodeIdentifier } from "./opencode-capability-config";
import type {
  ResourceActivityEvidenceService,
  ProviderEvidenceContract,
} from "../resource-activity/resource-activity-evidence-service";
import type { CapabilityHostObservation } from "../capabilities/capability-receipt";
// The MCP SDK exports ESM subpaths that eslint-import-resolver-typescript does not resolve.
// eslint-disable-next-line import/no-unresolved
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// eslint-disable-next-line import/no-unresolved
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const OPENCODE_RUNTIME_VERSION = "1.18.30";
export const OPENCODE_ACTIVITY_CONTRACT = "opencode/1.18.30/assignment-v1";
export const OPENCODE_BUILTIN_TOOLS = [
  "invalid",
  "question",
  "bash",
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "task",
  "webfetch",
  "todowrite",
  "websearch",
  "skill",
  "apply_patch",
];
const builtinBodyDigest =
  "eda4eae3679562180d26a31817cb5b2c8c801599b85f80b2796beae5620bad66";
const builtinDescriptionDigest =
  "005957c825ebc1eea571edbdbebcf2f942534659c6321304a456a54b31170648";
const commandDigests: Readonly<Record<string, string>> = {
  init: "1e5f1b41d7d522861e629fbb8a21ba225201efa4cf09802ac57052075df9b9c4",
  review: "fda5b502c8ab3433ac674f2e865c5ae2cae30b9e6af68af992fa45b1fa3bef73",
};
export interface OpenCodeAssignedSkill {
  identity: ResourceActivityObservation["identity"];
  name: string;
  files: ReadonlyArray<{ relativePath: string; content: string }>;
  automaticInvocation: boolean;
}
export interface OpenCodeWorktreeRuntimeOptions {
  /** Trusted main-process model endpoint, verified with the effective configuration. */
  modelProvider?: { id: string; name: string; baseUrl: string };
  namespaceRoot: string;
  /** Application-owned data namespace retained for this Worktree across process generations. */
  sessionDataRoot?: string;
  directory: string;
  lineage: ActivityLineage;
  skills: readonly OpenCodeAssignedSkill[];
  capabilities: readonly CodingAgentCapabilityConnection[];
  capabilityTools?: readonly OpenCodeAssignedTool[];
  /** Centrally prepared environment; managed launch never inherits process.env. */
  environment: Readonly<NodeJS.ProcessEnv>;
  evidence?: ResourceActivityEvidenceService;
  verifyAttestation?(lineage: ActivityLineage): Promise<boolean>;
  onVerified?(effectiveStateDigest: string): Promise<void>;
  onUnavailable?(lineage: ActivityLineage): void;
  subscribeHostObservations?(
    listener: (input: OpenCodeOwnedHostObservation) => void,
  ): () => void;
}
export interface OpenCodeOwnedHostObservation {
  runtimeGeneration: string;
  serverName: string;
  observation: CapabilityHostObservation;
  /** Exact main-process dispatch binding; never inferred from credentials or activity. */
  dispatchSessionId?: string;
}
export interface OpenCodeAssignedTool {
  serverName: string;
  toolName: string;
  hostToolName: string;
  identity: ResourceActivityObservation["identity"];
}
// Pinned MCP catalog transformation from OpenCode v1.18.30, not a reverse name parser.
export const openCodeToolName = (server: string, tool: string): string =>
  `${normalizeOpenCodeIdentifier(server)}_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
/** Fingerprints the immutable qualified intent after every effective catalog/config check succeeds. */
export const openCodeEffectiveStateDigest = (options: OpenCodeWorktreeRuntimeOptions): string =>
  `sha256:${createHash("sha256").update(JSON.stringify({
    lineage: options.lineage,
    skills: options.skills.map(skill => ({identity:skill.identity,automaticInvocation:skill.automaticInvocation})),
    tools: options.capabilityTools ?? [], skillIsolation: "enforced", adapterContractVersion: 1,
  })).digest("hex")}`;

export interface ProjectedOpenCodeSkill extends OpenCodeAssignedSkill {
  path: string;
  body: string;
  bodyDigest: string;
  commandTemplate: string;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value))
    return JSON.stringify(value.map((item) => JSON.parse(canonical(item))));
  if (value && typeof value === "object")
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, JSON.parse(canonical(item))]),
      ),
    );
  return JSON.stringify(value);
};
function fail(): never {
  throw new Error("OpenCode Worktree Resource isolation verification failed.");
}
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : fail());
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : fail();

const freezeData = (value: unknown): void => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
};

/** Immutable namespace/projection owned by one launched Worktree generation. No ambient roots are imported. */
export class OpenCodeRuntimeProjection {
  readonly options: OpenCodeWorktreeRuntimeOptions;
  readonly skills: ProjectedOpenCodeSkill[] = [];
  readonly root: string;
  readonly projectionRoot: string;
  readonly config: Record<string, unknown>;
  private initialized = false;
  private sessionDataIdentity?: {
    dev: number;
    ino: number;
    markerDev: number;
    markerIno: number;
    owner: string;
  };

  private readonly immutableIdentities = new Map<
    string,
    { dev: number; ino: number }
  >();
  constructor(options: OpenCodeWorktreeRuntimeOptions) {
    const {
      evidence,
      verifyAttestation,
      onVerified,
      onUnavailable,
      subscribeHostObservations,
      ...data
    } = options;
    const immutableData = structuredClone(data);
    freezeData(immutableData);
    this.options = Object.freeze({
      ...immutableData,
      evidence,
      verifyAttestation,
      onVerified,
      onUnavailable,
      subscribeHostObservations,
    });
    this.root = resolve(options.namespaceRoot);
    this.projectionRoot = join(this.root, "projection");
    if (
      options.lineage.provider !== "opencode" ||
      options.lineage.providerVersion !== OPENCODE_RUNTIME_VERSION ||
      options.lineage.adapterContractVersion !== 1
    )
      fail();
    const names = new Set(["customize_opencode", "init", "review"]);
    for (const skill of this.options.skills) {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) ||
        skill.name.length > 64 ||
        skill.identity.resourceKind !== "skill" ||
        skill.identity.resourceId !== skill.name
      )
        fail();
      const key = normalizeOpenCodeIdentifier(skill.name);
      if (names.has(key)) fail();
      names.add(key);
    }
    const servers = new Set<string>(),
      profiles = new Set<string>();
    const mcp: Record<string, unknown> = {};
    const permissions = Object.fromEntries([
      ["*", "deny"],
      ...this.options.skills
        .filter((s) => s.automaticInvocation)
        .map((s) => [s.name, "allow"]),
    ]);
    const agent: Record<string, unknown> = {
      build: {
        options: {},
        permission: { bash: "ask", skill: permissions, "aw_*": "deny" },
      },
    };
    for (const connection of this.options.capabilities) {
      const server = normalizeOpenCodeIdentifier(connection.serverName),
        profile = normalizeOpenCodeIdentifier(connection.profileId);
      if (servers.has(server) || profiles.has(profile) || profile === "build")
        fail();
      servers.add(server);
      profiles.add(profile);
      mcp[server] = {
        type: "remote",
        url: connection.url,
        headers: { Authorization: connection.authorizationHeader },
      };
      agent[profile] = {
        mode: "primary",
        options: {},
        permission: {
          bash: "ask",
          skill: permissions,
          "aw_*": "deny",
          [`${server}_*`]: "allow",
        },
      };
    }
    const toolNames = new Set(OPENCODE_BUILTIN_TOOLS);
    for (const tool of this.options.capabilityTools ?? []) {
      const name = openCodeToolName(tool.serverName, tool.toolName);
      if (
        !servers.has(normalizeOpenCodeIdentifier(tool.serverName)) ||
        tool.identity.resourceKind !== "capability" ||
        toolNames.has(name)
      )
        fail();
      toolNames.add(name);
    }
    this.config = {
      ...(options.modelProvider ? { provider: { [options.modelProvider.id]: { npm: "@ai-sdk/openai-compatible", name: options.modelProvider.name, options: { baseURL: options.modelProvider.baseUrl }, models: { "qualification": { name: "Qualification", limit: { context: 32000, output: 4096 } } } } } } : {}),
      skills: { paths: [this.projectionRoot] },
      plugin: [],
      command: {},
      mcp,
      permission: { skill: permissions },
      agent,
      autoupdate: false,
    };
  }
  async prepare(): Promise<void> {
    if (this.initialized) {
      await this.verifyFiles();
      return;
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (
      (await realpath(this.root)) !== this.root ||
      (await readdir(this.root)).length
    )
      fail();
    if (this.options.sessionDataRoot) {
      const dataRoot = resolve(this.options.sessionDataRoot);
      await mkdir(dataRoot, { recursive: true, mode: 0o700 });
      const stat = await lstat(dataRoot);
      if (
        stat.isSymbolicLink() ||
        (await realpath(dataRoot)) !== dataRoot ||
        stat.mode & 0o077
      )
        fail();
      const owner = JSON.stringify({
        provider: "opencode",
        worktreeId: this.options.lineage.worktreeId,
      });
      const marker = join(dataRoot, ".aw-worktree-owner");
      const contents = await readdir(dataRoot);
      if (contents.length && !contents.includes(".aw-worktree-owner")) fail();
      try {
        await writeFile(marker, owner, { flag: "wx", mode: 0o400 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") fail();
        const markerStat = await lstat(marker);
        if (
          !markerStat.isFile() ||
          markerStat.isSymbolicLink() ||
          markerStat.nlink !== 1 ||
          markerStat.mode & 0o277
        )
          fail();
        if ((await readFile(marker, "utf8")) !== owner) fail();
      }
      const markerStat = await lstat(marker);
      this.sessionDataIdentity = {
        dev: stat.dev,
        ino: stat.ino,
        markerDev: markerStat.dev,
        markerIno: markerStat.ino,
        owner,
      };
    }
    for (const path of ["home", "config/opencode", "data", "cache", "state"])
      await mkdir(join(this.root, path), { recursive: true, mode: 0o700 });
    const staging = join(this.root, ".projection");
    await mkdir(staging, { mode: 0o700 });
    for (const skill of this.options.skills) {
      const skillRoot = join(staging, skill.name);
      await mkdir(skillRoot, { mode: 0o700 });
      for (const file of skill.files) {
        const path = resolve(skillRoot, file.relativePath);
        if (
          !path.startsWith(skillRoot + sep) ||
          file.relativePath.split("/").includes("..") ||
          file.relativePath.includes("\\")
        )
          fail();
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, file.content, { flag: "wx", mode: 0o400 });
      }
      const validated = await validateSkillPackage(skillRoot);
      if (
        validated.contentDigest !== skill.identity.resourceDigest ||
        validated.descriptor.id !== skill.name
      )
        fail();
      const document = validated.files.find(
        (f) => f.relativePath === "SKILL.md",
      )?.content;
      if (!document) fail();
      const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(document);
      if (!match) fail();
      const metadata = parseDocument(
        match[0].replace(/^---\r?\n/, "").replace(/\r?\n---(?:\r?\n|$)$/, ""),
      ).toJS();
      if (
        metadata.name !== skill.name ||
        (skill.automaticInvocation && !validated.descriptor.automaticInvocation)
      )
        fail();
      const body = document.slice(match[0].length).trim();
      // OpenCode preserves the content between frontmatter and EOF in its command template.
      const commandBody = document.slice(match[0].length);
      const path = join(this.projectionRoot, skill.name, "SKILL.md");
      this.skills.push({
        ...skill,
        path,
        body,
        bodyDigest: `sha256:${hash(body)}`,
        commandTemplate: [
          commandBody,
          "",
          `Base directory for this skill: ${dirname(path)}`,
          "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
        ].join("\n"),
      });
      await this.freezeTree(skillRoot);
    }
    await chmod(staging, 0o500);
    await rename(staging, this.projectionRoot);
    for (const path of ["home", "config/opencode", "config"])
      await chmod(join(this.root, path), 0o500);
    const capture = async (path: string): Promise<void> => {
      const stat = await lstat(path);
      this.immutableIdentities.set(path, { dev: stat.dev, ino: stat.ino });
      if (stat.isDirectory())
        for (const name of await readdir(path)) await capture(join(path, name));
    };
    for (const path of ["home", "config", "projection"])
      await capture(join(this.root, path));
    this.initialized = true;
    await this.verifyFiles();
  }
  environment(password: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      "PATH",
      "TMPDIR",
      "SSL_CERT_FILE",
      "NODE_EXTRA_CA_CERTS",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_REGION",
    ]) {
      const value = this.options.environment[key];
      if (value !== undefined) env[key] = value;
    }
    return {
      ...env,
      HOME: join(this.root, "home"),
      XDG_CONFIG_HOME: join(this.root, "config"),
      XDG_DATA_HOME: this.options.sessionDataRoot ?? join(this.root, "data"),
      XDG_CACHE_HOME: join(this.root, "cache"),
      XDG_STATE_HOME: join(this.root, "state"),
      OPENCODE_CONFIG_DIR: join(this.root, "config/opencode"),
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "true",
      OPENCODE_DISABLE_PROJECT_CONFIG: "true",
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(this.config),
    };
  }
  private async freezeTree(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true }))
      if (entry.isDirectory()) await this.freezeTree(join(path, entry.name));
    await chmod(path, 0o500);
  }
  async verifyFiles(): Promise<void> {
    if ((await realpath(this.root)) !== this.root) fail();
    if (this.options.sessionDataRoot) {
      const path = resolve(this.options.sessionDataRoot),
        identity = this.sessionDataIdentity;
      const stat = await lstat(path),
        marker = join(path, ".aw-worktree-owner"),
        markerStat = await lstat(marker);
      if (
        !identity ||
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (await realpath(path)) !== path ||
        stat.mode & 0o077 ||
        stat.dev !== identity.dev ||
        stat.ino !== identity.ino ||
        !markerStat.isFile() ||
        markerStat.isSymbolicLink() ||
        markerStat.nlink !== 1 ||
        markerStat.mode & 0o277 ||
        markerStat.dev !== identity.markerDev ||
        markerStat.ino !== identity.markerIno ||
        (await readFile(marker, "utf8")) !== identity.owner
      )
        fail();
    }
    for (const [path, identity] of this.immutableIdentities) {
      const stat = await lstat(path);
      if (
        stat.dev !== identity.dev ||
        stat.ino !== identity.ino ||
        stat.isSymbolicLink() ||
        stat.mode & 0o077 ||
        stat.mode & 0o222
      )
        fail();
    }
    for (const path of ["home", "config", "config/opencode", "projection"]) {
      const stat = await lstat(join(this.root, path));
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o222)
        fail();
    }
    if (
      (await readdir(join(this.root, "home"))).length ||
      (await readdir(join(this.root, "config/opencode"))).length ||
      (await readdir(join(this.root, "config"))).join() !== "opencode"
    )
      fail();
    if (
      (await readdir(this.projectionRoot)).sort().join("\0") !==
      this.skills
        .map((s) => s.name)
        .sort()
        .join("\0")
    )
      fail();
    for (const skill of this.skills) {
      const root = dirname(skill.path);
      const validated = await validateSkillPackage(root);
      if (validated.contentDigest !== skill.identity.resourceDigest) fail();
      const walk = async (path: string): Promise<void> => {
        const stat = await lstat(path);
        if (stat.isSymbolicLink() || stat.mode & 0o222) fail();
        if (stat.isDirectory())
          for (const name of await readdir(path)) await walk(join(path, name));
      };
      await walk(root);
    }
  }
  assertDirectory(directory: string): void {
    if (resolve(directory) !== resolve(this.options.directory))
      throw new Error("OpenCode Worktree directory mismatch.");
  }
  async readHostTools(timeoutMs: number): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    for (const connection of this.options.capabilities) {
      const client = new Client({
        name: "aw-runtime-attestation",
        version: "1",
      });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(connection.url), {
            requestInit: {
              headers: { Authorization: connection.authorizationHeader },
              signal: AbortSignal.timeout(timeoutMs),
            },
          }),
        );
        if (client.getInstructions() || client.getServerCapabilities()?.prompts)
          fail();
        const tools = await client.listTools({}, { timeout: timeoutMs });
        if (tools.nextCursor) fail();
        result[normalizeOpenCodeIdentifier(connection.serverName)] = tools.tools
          .map((t) => t.name)
          .sort();
      } finally {
        await client.close();
      }
    }
    return result;
  }
  async verifyEffective(input: {
    skills: unknown;
    commands: unknown;
    config: unknown;
    tools: unknown;
    mcp: unknown;
    hostTools: Record<string, string[]>;
  }): Promise<string> {
    await this.verifyFiles();
    if (
      !Array.isArray(input.skills) ||
      !Array.isArray(input.commands) ||
      !Array.isArray(input.tools)
    )
      fail();
    const skills = array(input.skills).map(record),
      commands = array(input.commands).map(record);
    if (
      skills.length !== this.skills.length + 1 ||
      new Set(skills.map((s) => s.name)).size !== skills.length
    )
      fail();
    const baseline = skills.find((s) => s.name === "customize-opencode");
    if (
      !baseline ||
      baseline.location !== "<built-in>" ||
      typeof baseline.content !== "string" ||
      hash(baseline.content) !== builtinBodyDigest ||
      typeof baseline.description !== "string" ||
      hash(baseline.description) !== builtinDescriptionDigest
    )
      fail();
    for (const skill of this.skills) {
      const item = skills.find((s) => s.name === skill.name);
      if (
        !item ||
        item.location !== skill.path ||
        typeof item.content !== "string" ||
        item.content.trim() !== skill.body
      )
        fail();
      const cmd = commands.find((c) => c.name === skill.name);
      if (
        !cmd ||
        cmd.source !== "skill" ||
        cmd.template !== skill.commandTemplate
      )
        fail();
    }
    if (
      commands.length !== this.skills.length + 3 ||
      new Set(commands.map((c) => c.name)).size !== commands.length
    )
      fail();
    for (const [name, digest] of Object.entries(commandDigests)) {
      const cmd = commands.find((c) => c.name === name);
      if (
        !cmd ||
        cmd.source !== "command" ||
        typeof cmd.template !== "string" ||
        hash(
          name === "init"
            ? cmd.template.replaceAll(this.options.directory, "${path}")
            : cmd.template,
        ) !== digest
      )
        fail();
    }
    const builtinCommand = commands.find(
      (c) => c.name === "customize-opencode",
    );
    if (
      !builtinCommand ||
      builtinCommand.source !== "skill" ||
      builtinCommand.template !== baseline.content
    )
      fail();
    const cfg = record(input.config);
    const allowedConfigKeys = new Set([
      ...Object.keys(this.config),
      "username",
      "mode",
      "$schema",
    ]);
    if (
      Object.keys(cfg).some((key) => !allowedConfigKeys.has(key)) ||
      canonical(cfg.mode ?? {}) !== "{}"
    )
      fail();
    for (const key of [
      "skills",
      "plugin",
      "command",
      "mcp",
      "permission",
      "agent",
      "autoupdate",
      ...(this.options.modelProvider ? ["provider"] : []),
    ])
      if (
        canonical(cfg[key] ?? (key === "mcp" ? {} : undefined)) !==
        canonical(this.config[key])
      )
        fail();
    const mcp = record(input.mcp);
    if (
      Object.keys(mcp).sort().join() !==
        Object.keys(record(this.config.mcp)).sort().join() ||
      Object.values(mcp).some((s) => record(s).status !== "connected")
    )
      fail();
    // The pinned /experimental/tool/ids endpoint enumerates the native registry, not MCP tools.
    if (
      [...array(input.tools)].sort().join("\0") !==
      [...OPENCODE_BUILTIN_TOOLS].sort().join("\0")
    )
      fail();
    for (const connection of this.options.capabilities) {
      const server = normalizeOpenCodeIdentifier(connection.serverName);
      const expected = (this.options.capabilityTools ?? [])
        .filter((t) => normalizeOpenCodeIdentifier(t.serverName) === server)
        .map((t) => t.toolName)
        .sort();
      if (input.hostTools[server]?.join("\0") !== expected.join("\0")) fail();
    }
    // Credentials and transport URLs are verified in memory but never fingerprint inputs.
    return openCodeEffectiveStateDigest(this.options);
  }
  resolveExplicit(input: {
    id: string;
    name: string;
    path: string;
  }): ProjectedOpenCodeSkill {
    const skill = this.skills.find(
      (s) =>
        s.name === input.id &&
        s.name === input.name &&
        s.path === resolve(input.path),
    );
    if (!skill)
      throw new Error("Skill is not assigned to this Worktree Runtime.");
    return skill;
  }
}

/** Fixed invocation-time catalog. A new Assignment/runtime requires a new contract instance. */
export function createOpenCodeEvidenceContract(
  options: OpenCodeWorktreeRuntimeOptions,
): ProviderEvidenceContract {
  const {
    lineage,
    skills,
    capabilityTools = [],
  } = structuredClone({
    lineage: options.lineage,
    skills: options.skills.map(skill=>{const content=skill.files.find(file=>file.relativePath === "SKILL.md")?.content;return {name:skill.name,identity:skill.identity,bodyDigest:content ? `sha256:${hash(content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim())}` : null};}),
    capabilityTools: options.capabilityTools,
  });
  const matches = (value: ActivityLineage) =>
    canonical(value) === canonical(lineage);
  const skill = (value: ActivityLineage, route: string) =>
    matches(value) ? skills.find((s) => s.name === route) : undefined;
  const tool = (value: ActivityLineage, server: string, name: string) =>
    matches(value)
      ? capabilityTools.find(
          (t) =>
            normalizeOpenCodeIdentifier(t.serverName) === server &&
            t.toolName === name,
        )
      : undefined;
  return {
    name: OPENCODE_ACTIVITY_CONTRACT,
    provider: "opencode",
    providerVersion: OPENCODE_RUNTIME_VERSION,
    adapterContractVersion: 1,
    automaticSkillContextQualified: true,
    resolveSkill: (value, route) => skill(value, route)?.identity ?? null,
    resolveSkillBodyDigest: (value,route) => skill(value,route)?.bodyDigest ?? null,
    resolveTool: (value, server, name) =>
      tool(value, server, name)?.identity ?? null,
    resolveHostTool: (value, server, name) =>
      tool(value, server, name)?.hostToolName ?? null,
  };
}
