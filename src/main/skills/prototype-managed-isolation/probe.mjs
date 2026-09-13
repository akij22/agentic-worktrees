// THROWAWAY #69: synthetic Skill documents exercised through live local provider protocols. Never prints provider payloads or private paths.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
const pins = { codex: 'codex-cli 0.154.0', opencode: '1.18.30' };
const root = await realpath(await mkdtemp(join(tmpdir(), 'managed-isolation-')));
const children = new Set();
const delay = ms => new Promise(r => setTimeout(r, ms));
const digest = value => createHash('sha256').update(value).digest('hex');
const report = { kind: 'live-synthetic-provider-probe', pins, observations: [], qualification: 'closed-pending-all-channel-proof' };
const record = (provider, generation, outcome, details = {}) => report.observations.push({ provider, generation, outcome, ...details });
async function namespace(id) {
  const base = join(root, id);
  for (const dir of ['home', 'config/opencode', 'data', 'cache', 'state', 'codex', 'work', 'projection']) await mkdir(join(base, dir), { recursive: true, mode: 0o700 });
  // Allowlist environment: no inherited credentials, provider flags, plugins or configuration.
  const env = { PATH: process.env.PATH, HOME: join(base, 'home'), CODEX_HOME: join(base, 'codex'), XDG_CONFIG_HOME: join(base, 'config'), XDG_DATA_HOME: join(base, 'data'), XDG_CACHE_HOME: join(base, 'cache'), XDG_STATE_HOME: join(base, 'state'), TMPDIR: root, OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true', OPENCODE_DISABLE_PROJECT_CONFIG: 'true' };
  if (process.argv.includes('--existing-auth')) {
    const { symlink, access } = await import('node:fs/promises');
    await mkdir(join(base, 'data/opencode'), { recursive: true, mode: 0o700 });
    for (const [source, target] of [[join(homedir(), '.codex/auth.json'), join(base, 'codex/auth.json')], [join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'opencode/auth.json'), join(base, 'data/opencode/auth.json')]]) {
      try { await access(source); await symlink(source, target); } catch { record('auth', 'none', 'optional-auth-link-unavailable'); }
    }
  }
  return { base, env, cwd: join(base, 'work'), projection: join(base, 'projection') };
}
async function skill(parent, name, revision = '1', directory = name) {
  const body = `---\nname: ${name}\ndescription: Synthetic harmless isolation check.\n---\nReply CHECK_OK for ${name} revision ${revision}. Do not change files.\n`;
  const dir = join(parent, directory); await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'SKILL.md'); await writeFile(path, body, { mode: 0o400 }); await chmod(dir, 0o500);
  return { name, path, digest: digest(body) };
}
async function snapshot(ns, name, revision = '1') {
  const key = digest(`${name}:${revision}`); const parent = join(ns.projection, key);
  const entry = await skill(parent, name, revision); await chmod(parent, 0o500);
  // The directory address is the manifest digest, containing the content digest and identity.
  const address = digest(JSON.stringify({ name, revision, digest: entry.digest }));
  const { rename } = await import('node:fs/promises'); const target = join(ns.projection, address); await rename(parent, target);
  return { ...entry, path: join(target, name, 'SKILL.md'), root: target, generation: address };
}
async function verify(entry) {
  const { lstat, readdir } = await import('node:fs/promises');
  const dir = join(entry.root, entry.name);
  for (const path of [entry.root, dir, entry.path]) { const info = await lstat(path); if (info.isSymbolicLink() || (info.mode & 0o222) !== 0 || !(await realpath(path)).startsWith(root + '/')) return false; }
  return JSON.stringify(await readdir(entry.root)) === JSON.stringify([entry.name]) && JSON.stringify(await readdir(dir)) === JSON.stringify(['SKILL.md']) && digest(await readFile(entry.path)) === entry.digest;
}
function start(binary, args, ns) { const p = spawn(binary, args, { env: ns.env, cwd: ns.cwd, stdio: ['pipe', 'pipe', 'pipe'] }); children.add(p); p.stderr.resume(); p.on('error', () => { /* Startup/request timeout reports a sanitized failure. */ }); p.once('exit', () => children.delete(p)); return p; }
async function stop(p) { if (p.exitCode !== null || p.signalCode !== null) return; const done = new Promise(r => p.once('exit', r)); p.kill('SIGTERM'); await Promise.race([done, delay(1200)]); if (p.exitCode === null && p.signalCode === null) { p.kill('SIGKILL'); await done; } }
function rpc(p) {
  let id = 0; const pending = new Map(); const events = [];
  createInterface({ input: p.stdout }).on('line', line => { try { const msg = JSON.parse(line); if (pending.has(msg.id)) pending.get(msg.id)(msg); else if (msg.method) events.push(msg.method); } catch { /* Nonprotocol output is discarded. */ } });
  return { events, async call(method, params) { const n = ++id; let timer; const answer = new Promise(resolve => { pending.set(n, resolve); timer = setTimeout(() => resolve({ error: true }), 15000); }); p.stdin.write(JSON.stringify({ id: n, method, params }) + '\n'); const result = await answer; clearTimeout(timer); pending.delete(n); if (result.error) throw Error('protocol-failure'); return result.result; }, notify(method) { p.stdin.write(JSON.stringify({ method }) + '\n'); } };
}
async function codex(ns, projection) {
  const p = start('codex', ['app-server'], ns); const api = rpc(p);
  await api.call('initialize', { clientInfo: { name: 'isolation_probe', version: '1' }, capabilities: { experimentalApi: true } }); api.notify('initialized');
  await api.call('skills/extraRoots/set', { extraRoots: projection ? [projection] : [] });
  return { p, api, async catalog() { const result = await api.call('skills/list', { cwds: [ns.cwd], forceReload: true }); if (result.data?.some(g => g.errors?.length)) throw Error('catalog-errors'); return result.data.flatMap(g => g.skills); } };
}
async function opencode(ns, projection, command = {}) {
  ns.env.OPENCODE_SERVER_USERNAME = 'prototype'; ns.env.OPENCODE_SERVER_PASSWORD = randomBytes(24).toString('hex');
  ns.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ skills: { paths: projection ? [projection] : [] }, command, plugin: [], permission: { '*': 'deny', skill: { '*': 'deny', ...(process.argv.includes('--deny-skills') ? {} : { [ns.base.endsWith('-a') ? 'probe-a' : 'probe-b']: 'allow' }) } } });
  const p = start('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], ns); let base; let output = '';
  p.stdout.on('data', data => { output += data; base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  const end = Date.now() + 20000; while (!base && p.exitCode === null && Date.now() < end) await delay(100);
  if (!base) throw Error('startup-failure');
  const call = async (path, data) => { const r = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-opencode-directory': ns.cwd, Authorization: 'Basic ' + Buffer.from('prototype:' + ns.env.OPENCODE_SERVER_PASSWORD).toString('base64') }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(45000) }); if (!r.ok) throw Error('http-failure'); return r.json(); };
  return { p, call, catalog: () => call('/skill') };
}
function admit(entries, request, generation, activeGeneration) {
  if (generation !== activeGeneration) return false;
  // Names, aliases and caller paths are not trusted as provider input. Resolve exact assigned identity.
  return entries.some(e => e.name === request.name && (!request.path || request.path === e.path));
}
async function turns(provider, runtime, assigned, foreign, ns) {
  const text = 'Perform the synthetic harmless isolation check. Use its skill if available. Do not use shell commands or change files.';
  if (provider === 'codex') {
    const ids = []; const modes = new Map();
    for (const mode of ['native-assigned', 'automatic', 'raw-foreign-path']) {
      try {
        const t = await runtime.api.call('thread/start', { cwd: ns.cwd, approvalPolicy: 'never', sandbox: 'read-only' }); ids.push(t.thread.id); modes.set(t.thread.id, mode);
        const entry = mode === 'raw-foreign-path' ? foreign : assigned;
        const input = [...(mode === 'automatic' ? [] : [{ type: 'skill', name: entry.name, path: entry.path }]), { type: 'text', text, text_elements: [] }];
        const begin = runtime.api.events.length;
        await runtime.api.call('turn/start', { threadId: t.thread.id, input });
        const end = Date.now() + 45000; while (!runtime.api.events.slice(begin).includes('turn/completed') && Date.now() < end) await delay(200);
        const h = await runtime.api.call('thread/read', { threadId: t.thread.id, includeTurns: true });
        record(provider, assigned.generation, mode, { submitted: true, completed: runtime.api.events.slice(begin).includes('turn/completed'), failedTurnCount: h.thread.turns.filter(t => t.status === 'failed').length, nativeRecordedCount: h.thread.turns.flatMap(t => t.items ?? []).filter(i => i.type === 'userMessage' && i.content?.some(c => c.type === 'skill')).length });
      } catch { record(provider, assigned.generation, mode + '-runtime-blocked'); }
    }
    const { readdir } = await import('node:fs/promises');
    const files = async dir => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))).flat();
    const body = await readFile(foreign.path, 'utf8'); const assignedBody = await readFile(assigned.path, 'utf8'); let injections = 0;
    for (const path of (await files(ns.env.CODEX_HOME)).filter(p => p.endsWith('.jsonl'))) {
      const records = (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
      const mode = modes.get(records.find(r => r.type === 'session_meta')?.payload?.id) ?? 'unknown';
      const context = records.filter(r => r.type === 'response_item' && r.payload?.role === 'user').flatMap(r => r.payload.content ?? []).map(c => c.text ?? '');
      const foreignCount = context.filter(t => t.includes(body) && t.includes(foreign.path)).length; injections += foreignCount;
      record(provider, assigned.generation, 'private-rollout-context-check', { channel: mode, exactAssignedDocumentCount: context.filter(t => t.includes(assignedBody)).length, assignedInstructionCount: context.filter(t => t.includes(assignedBody.split('---\n').at(-1).trim())).length, exactForeignDocumentCount: foreignCount, foreignInstructionCount: context.filter(t => t.includes(body.split('---\n').at(-1).trim())).length });
    }
    record(provider, assigned.generation, 'raw-foreign-path-context-observation', { injectionCount: injections });
    return ids[0];
  }
  const providers = await runtime.call('/provider');
  const providerID = process.argv.includes('--public-model') ? 'opencode' : providers.connected?.includes('openai') ? 'openai' : providers.connected?.[0]; const modelID = process.argv.includes('--public-model') ? 'big-pickle' : providerID === 'openai' ? 'gpt-5.4' : providers.default?.[providerID];
  record(provider, assigned.generation, 'model-availability', { connectedCount: providers.connected?.length ?? 0 });
  for (const mode of ['command-assigned', 'automatic', 'raw-unassigned-command', 'raw-model-unassigned']) {
    const session = await runtime.call('/session', {}); let submitted = false;
    try {
      if (mode === 'automatic' || mode === 'raw-model-unassigned') await runtime.call('/session/' + session.id + '/message', { ...(providerID ? { model: { providerID, modelID } } : {}), parts: [{ type: 'text', text: mode === 'raw-model-unassigned' ? `Load ${foreign.name} using the builtin skill tool. Do not use other tools or change files.` : text }] });
      else await runtime.call('/session/' + session.id + '/command', { command: mode === 'raw-unassigned-command' ? foreign.name : assigned.name, arguments: '', ...(providerID ? { model: `${providerID}/${modelID}` } : {}) });
      submitted = true;
    } catch { /* Report sanitized outcome and history below, not raw error payloads. */ }
    const history = await runtime.call('/session/' + session.id + '/message'); const parts = history.flatMap(m => m.parts ?? []);
    const syntheticBody = await readFile(assigned.path, 'utf8'); const instruction = syntheticBody.split('---\n').at(-1).trim();
    const loads = parts.filter(p => p.type === 'tool' && p.tool === 'skill' && p.state?.status === 'completed');
    record(provider, assigned.generation, mode, { submitted, assistantErrorCount: history.filter(m => m.info?.error).length, errorCategories: [...new Set(history.filter(m => m.info?.error).map(m => { const text = JSON.stringify(m.info.error); return /auth|credential|api.key|unauthorized/i.test(text) ? 'authentication' : /install|package|module|ENOENT/i.test(text) ? 'dependency-or-runtime' : /fetch|connect|network|socket/i.test(text) ? 'network' : 'unclassified-redacted'; }))], builtinSkillLoadCount: loads.length, exactAssignedBuiltinLoadCount: loads.filter(p => p.state.metadata?.name === assigned.name && p.state.metadata?.dir === join(assigned.root, assigned.name) && p.state.output?.includes(instruction)).length, foreignBuiltinLoadCount: loads.filter(p => p.state.metadata?.name === foreign.name).length, failedSkillLoadCount: parts.filter(p => p.type === 'tool' && p.tool === 'skill' && p.state?.status === 'error').length, denyAllSkills: process.argv.includes('--deny-skills'), assignedCommandInjectionCount: parts.filter(p => p.type === 'text' && p.text?.includes(syntheticBody.split('---\n').at(-1).trim())).length });
  }
}
function summarize(catalog, entries) {
  const assigned = catalog.filter(s => entries.some(e => s.name === e.name && (s.path ?? s.location) === e.path));
  const rest = catalog.filter(s => !assigned.includes(s));
  return { count: catalog.length, assignedCount: assigned.length, enabledAssignedCount: assigned.filter(s => s.enabled !== false).length, otherCount: rest.length, otherIdentityDigests: rest.map(s => digest(`${s.name}:${s.scope ?? ''}:${s.location === '<built-in>' ? 'builtin' : 'other'}`)).sort() };
}
try {
  for (const provider of Object.keys(pins).filter(p => !process.argv.includes('--opencode-only') || p === 'opencode')) {
    let version; try { version = execFileSync(provider, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { version = 'unavailable'; }
    if (process.argv.includes('--unsupported-version')) version = 'unsupported-fixture';
    if (version !== pins[provider]) { record(provider, 'none', 'unsupported-version-admission-closed'); continue; }
    const a = await namespace(provider + '-a'); const b = await namespace(provider + '-b');
    const sa = await snapshot(a, 'probe-a'); const sb = await snapshot(b, 'probe-b'); const updated = await snapshot(a, 'probe-a', '2');
    const minimalRegistration = config => config.plugin.length === 0 && Object.keys(config.command).length === 0;
    record(provider, 'none', 'application-registration-gate', { minimalAccepted: minimalRegistration({ plugin: [], command: {} }), unexpectedPluginDenied: !minimalRegistration({ plugin: ['opaque-plugin-fixture'], command: {} }), unexpectedCommandDenied: !minimalRegistration({ plugin: [], command: { 'opaque-command': {} } }) });
    record(provider, sa.generation, 'snapshot-verified', { valid: await verify(sa), updatedValid: await verify(updated), disjoint: sa.digest !== sb.digest, updatedDigestDistinct: sa.digest !== updated.digest });
    const launch = provider === 'codex' ? codex : opencode;
    try {
      let runtime = await launch(b); const empty = await runtime.catalog(); record(provider, 'empty', 'raw-baseline-observed-not-approved', summarize(empty, []));
      await stop(runtime.p);
      const ra = await launch(a, sa.root); const rb = await launch(b, sb.root);
      record(provider, sa.generation, 'disjoint-a-catalog', summarize(await ra.catalog(), [sa]));
      record(provider, sb.generation, 'disjoint-b-catalog', { ...summarize(await rb.catalog(), [sb]), unassignedObserved: (await rb.catalog()).some(s => s.name === sa.name) });
      // This is deliberately application rejection, not a claim that a raw API denies arbitrary paths.
      for (const channel of ['native-name', 'native-path', 'command', 'alias']) {
        let submittedCount = 0;
        if (admit([sb], { name: channel === 'native-path' ? sb.name : sa.name, ...(channel === 'native-path' ? { path: sa.path } : {}) }, sb.generation, sb.generation)) submittedCount++;
        if (submittedCount) throw Error('allowlist-failure');
        record(provider, sb.generation, 'application-pre-provider-denial', { channel, submittedCount });
      }
      record(provider, sb.generation, 'stale-generation-denial', { denied: !admit([sb], { name: sb.name }, sa.generation, sb.generation) });
      const resumeId = await turns(provider, rb, sb, sa, b);
      if (provider === 'opencode') {
        const commands = await rb.call('/command'); const instructions = (await readFile(sb.path, 'utf8')).split('---\n').at(-1).trim(); record(provider, sb.generation, 'command-resolution', { exactAssignedTemplateCount: commands.filter(c => c.name === sb.name && c.source === 'skill' && c.template?.split('Base directory for this skill:')[0].trim() === instructions && c.template.includes(join(sb.root, sb.name))).length, assignedCount: commands.filter(c => c.name === sb.name && c.source === 'skill').length, unassignedCount: commands.filter(c => c.name === sa.name).length });
        const session = await rb.call('/session', {}); await stop(rb.p); runtime = await launch(b, sb.root);
        record(provider, sb.generation, 'restart-session-read', { readable: Boolean((await runtime.call('/session/' + session.id)).id) });
        await stop(runtime.p);
      } else { await stop(rb.p); runtime = await launch(b, sb.root); record(provider, sb.generation, 'restart-catalog', summarize(await runtime.catalog(), [sb]));
        if (resumeId) { try { const resumed = await runtime.api.call('thread/resume', { threadId: resumeId, cwd: b.cwd, approvalPolicy: 'never', sandbox: 'read-only' }); record(provider, sb.generation, 'restart-thread-resume', { resumed: resumed.thread.id === resumeId }); } catch { record(provider, sb.generation, 'restart-thread-resume-blocked'); } }
        await stop(runtime.p); }
      // Seed only synthetic ambient sources inside our private namespace/worktree.
      await skill(join(a.cwd, '.agents/skills'), 'ambient-probe'); await skill(join(a.cwd, '.opencode/skills'), 'project-probe'); await skill(join(a.env.HOME, '.agents/skills'), 'home-probe'); await skill(join(a.env.XDG_CONFIG_HOME, 'opencode/skills'), 'config-probe');
      await delay(1200); const drift = await ra.catalog(); record(provider, sa.generation, 'ambient-watcher-check', { count: drift.length, syntheticAmbientCount: drift.filter(s => ['ambient-probe', 'project-probe', 'home-probe', 'config-probe'].includes(s.name)).length, changedNotificationCount: ra.api?.events.filter(e => e === 'skills/changed').length ?? 0, admission: 'closed-unprovable-race' });
      if (provider === 'codex') {
        const ambient = drift.filter(s => ['ambient-probe', 'home-probe'].includes(s.name));
        for (const entry of ambient) await ra.api.call('skills/config/write', { path: entry.path, enabled: false });
        const disabled = await ra.catalog(); record(provider, sa.generation, 'per-path-disable-observation', { syntheticAmbientEnabledCount: disabled.filter(s => ['ambient-probe', 'home-probe'].includes(s.name) && s.enabled).length, atomicAllChannelProof: false });
      }
      await stop(ra.p);
      runtime = await launch(a, updated.root); record(provider, updated.generation, 'generation-replacement', summarize(await runtime.catalog(), [updated])); await stop(runtime.p);
      // Raw provider duplicate precedence is observed but never used as application admission policy.
      const collisions = join(a.base, 'collisions'); await skill(collisions, 'probe-a', '1', 'first'); await skill(collisions, 'probe-a', '2', 'second'); await skill(collisions, 'probe:a', '1', 'third');
      runtime = await launch(a, collisions, { 'probe-a': { template: 'Reply SYNTHETIC_SHADOW.' } });
      const duplicate = await runtime.catalog(); record(provider, 'collision', 'raw-duplicate-observation', { duplicateNameCount: duplicate.filter(s => s.name === 'probe-a').length, transformedNameCount: duplicate.filter(s => s.name === 'probe-a' || s.name === 'probe:a').length, admission: 'closed-before-launch-in-managed-mode' });
      if (provider === 'opencode') { const commands = await runtime.call('/command'); record(provider, 'collision', 'config-command-shadow', { configWinsCount: commands.filter(c => c.name === 'probe-a' && c.template === 'Reply SYNTHETIC_SHADOW.').length, transformedCommandCount: commands.filter(c => c.name === 'probe_a').length, literalColonCommandCount: commands.filter(c => c.name === 'probe:a').length }); }
      await stop(runtime.p);
    } catch { record(provider, 'unknown', 'runtime-or-contract-failure-admission-closed'); }
    await chmod(sa.path, 0o600); record(provider, sa.generation, 'permission-corruption-detected', { detected: !(await verify(sa)) });
    await writeFile(sa.path, 'synthetic corruption'); await chmod(sa.path, 0o400); record(provider, sa.generation, 'digest-corruption-detected', { detected: !(await verify(sa)) });
    // Same OS identity can read the other worktree's snapshot despite managed denial.
    record(provider, sb.generation, 'filesystem-non-goal', { crossNamespaceReadPossible: digest(await readFile(sb.path)) === sb.digest });
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const p of children) await stop(p);
  // Restore owner write permission only within this launcher's owned scratch root for cleanup.
  const { readdir } = await import('node:fs/promises');
  const writable = async dir => { await chmod(dir, 0o700); for (const e of await readdir(dir, { withFileTypes: true })) if (e.isDirectory()) await writable(join(dir, e.name)); };
  await writable(root); await rm(root, { recursive: true, force: true });
}
