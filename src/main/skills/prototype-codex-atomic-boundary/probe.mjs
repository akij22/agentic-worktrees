// THROWAWAY #72: live Codex 0.154.0 Skill catalog-to-turn probe. Emits counts only; never provider text, Skill bodies, credentials, paths, or session IDs.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, access, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const pin = 'codex-cli 0.154.0';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = await realpath(await mkdtemp(join(tmpdir(), 'codex-atomic-skill-')));
const dirs = Object.fromEntries(['home', 'codex', 'work', 'assigned'].map(name => [name, join(root, name)]));
for (const path of Object.values(dirs)) await mkdir(path, { recursive: true, mode: 0o700 });
const env = { PATH: process.env.PATH, HOME: dirs.home, CODEX_HOME: dirs.codex, TMPDIR: root };
const report = { kind: 'codex-atomic-skill-boundary-probe', version: 'unavailable', observations: {}, privacy: { prompts: false, outputs: false, credentials: false, paths: false, sessionIds: false } };
const children = new Set();

async function skill(parent, name, marker) {
  const directory = join(parent, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'SKILL.md');
  const body = `---\nname: ${name}\ndescription: Synthetic atomic-boundary check.\n---\nTreat ${marker} as the inert check marker. Do not run tools or change files.\n`;
  await writeFile(path, body, { mode: 0o400 });
  return { name, path, body, marker };
}
const assigned = await skill(dirs.assigned, 'assigned-probe', 'ASSIGNED_ATOMIC_MARKER');
const ambientRoot = join(dirs.work, '.agents', 'skills');

if (process.argv.includes('--existing-auth')) {
  const source = join(homedir(), '.codex', 'auth.json');
  try { await access(source); await symlink(source, join(dirs.codex, 'auth.json')); } catch { report.observations.auth = 'optional-auth-unavailable'; }
}

function start() {
  const child = spawn('codex', ['app-server'], { cwd: dirs.work, env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child); child.stderr.resume(); child.once('exit', () => children.delete(child));
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
  await Promise.race([exited, pause(1500)]); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
}
function rpc(child) {
  let id = 0; const pending = new Map(); const events = [];
  createInterface({ input: child.stdout }).on('line', line => { try { const message = JSON.parse(line); if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } else if (message.method) events.push(message); } catch { /* Discard non-protocol output. */ } });
  return { events, async call(method, params, timeout = 30000) { const requestId = ++id; const response = new Promise(resolve => pending.set(requestId, resolve)); child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n'); const message = await Promise.race([response, pause(timeout).then(() => ({ error: { code: 'timeout' } }))]); pending.delete(requestId); if (message.error) throw Error(String(message.error.code ?? 'protocol-failure')); return message.result; }, notify(method) { child.stdin.write(JSON.stringify({ method }) + '\n'); } };
}
async function files(path) { const entries = await readdir(path, { withFileTypes: true }).catch(() => []); return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]))).flat(); }
const strictConfig = (disabledPaths = []) => ({ skills: { include_instructions: false, bundled: { enabled: false }, ...(disabledPaths.length ? { config: disabledPaths.map(path => ({ path, enabled: false })) } : {}) } });
const permissiveConfig = { skills: { include_instructions: true, bundled: { enabled: false } } };
const sessions = new Map();
const documents = new Map([[assigned.name, assigned]]);

async function initialize() {
  const child = start(); const api = rpc(child);
  await api.call('initialize', { clientInfo: { name: 'atomic_skill_probe', version: '1' }, capabilities: { experimentalApi: true } }); api.notify('initialized');
  await api.call('skills/extraRoots/set', { extraRoots: [dirs.assigned] });
  return { child, api };
}
async function runTurn(api, mode, text, config = strictConfig(), existingThread) {
  const started = existingThread ? { thread: { id: existingThread } } : await api.call('thread/start', { cwd: dirs.work, approvalPolicy: 'never', sandbox: 'read-only', config, experimentalRawEvents: true });
  sessions.set(started.thread.id, mode);
  const begin = api.events.length;
  const turn = await api.call('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text, text_elements: [] }] });
  const deadline = Date.now() + 45000;
  while (!api.events.slice(begin).some(event => event.method === 'turn/completed') && Date.now() < deadline) await pause(100);
  return { threadId: started.thread.id, turnId: turn.turn?.id, completed: api.events.slice(begin).some(event => event.method === 'turn/completed') };
}
async function rolloutEvidence() {
  const result = {};
  for (const file of (await files(dirs.codex)).filter(path => path.endsWith('.jsonl'))) {
    const records = (await readFile(file, 'utf8')).split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const mode = sessions.get(records.find(record => record.type === 'session_meta')?.payload?.id); if (!mode) continue;
    const context = records.filter(record => record.type === 'response_item' && record.payload?.role === 'user').flatMap(record => record.payload.content ?? []).map(content => typeof content.text === 'string' ? content.text : '');
    result[mode] = { assignedBodyCount: context.filter(text => text.includes(assigned.body)).length, availableSkillsBlockCount: context.filter(text => text.includes('<available_skills>')).length, ambientBodyCounts: Object.fromEntries([...documents].filter(([name]) => name !== assigned.name).map(([name, document]) => [name, context.filter(text => text.includes(document.body)).length])) };
  }
  return result;
}

try {
  try { report.version = execFileSync('codex', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Version stays unavailable. */ }
  if (process.argv.includes('--unsupported-version')) report.version = 'unsupported-fixture';
  if (report.version !== pin) { report.observations.admission = 'closed-version-mismatch'; console.log(JSON.stringify(report, null, 2)); process.exitCode = 2; }
  else {
    let { child, api } = await initialize();
    try {
      const baseline = await api.call('skills/list', { cwds: [dirs.work], forceReload: true });
      const baselineSkills = baseline.data?.flatMap(group => group.skills ?? []) ?? [];
      report.observations.privateBaseline = { assignedCount: baselineSkills.filter(skill => skill.name === assigned.name && skill.path === assigned.path).length, bundledOrOtherCount: baselineSkills.filter(skill => skill.name !== assigned.name).length };

      const explicit = await api.call('thread/start', { cwd: dirs.work, approvalPolicy: 'never', sandbox: 'read-only', config: strictConfig(), experimentalRawEvents: true });
      sessions.set(explicit.thread.id, 'explicit-assigned');
      const explicitBegin = api.events.length;
      await api.call('turn/start', { threadId: explicit.thread.id, input: [{ type: 'skill', name: assigned.name, path: assigned.path }, { type: 'text', text: 'Perform the inert assigned check. Do not run tools or change files.', text_elements: [] }] });
      const explicitDeadline = Date.now() + 45000; while (!api.events.slice(explicitBegin).some(event => event.method === 'turn/completed') && Date.now() < explicitDeadline) await pause(100);
      report.observations.explicitAssigned = { completed: api.events.slice(explicitBegin).some(event => event.method === 'turn/completed') };
      const automatic = await runTurn(api, 'automatic-catalog-hidden', 'Perform the inert check if an applicable Skill is available. Do not run tools or change files.');
      report.observations.automaticCatalogHidden = { completed: automatic.completed };

      const before = await skill(ambientRoot, 'ambient-before', 'AMBIENT_BEFORE_MARKER'); documents.set(before.name, before);
      const listed = await api.call('skills/list', { cwds: [dirs.work], forceReload: true });
      report.observations.ambientBeforeCatalog = { discovered: listed.data?.some(group => group.skills?.some(skill => skill.name === before.name && skill.path === before.path)) ?? false };
      report.observations.ambientBeforeMention = { completed: (await runTurn(api, 'ambient-before-mention', `Use $${before.name} for this inert check. Do not run tools or change files.`)).completed };
      report.observations.disabledKnownAmbientMention = { completed: (await runTurn(api, 'disabled-known-ambient', `Use $${before.name} for this inert check. Do not run tools or change files.`, strictConfig([before.path]))).completed };

      const verifiedBeforeGap = await api.call('skills/list', { cwds: [dirs.work], forceReload: true });
      const disabledFromVerifiedCatalog = (verifiedBeforeGap.data?.flatMap(group => group.skills ?? []) ?? []).filter(skill => skill.path !== assigned.path).map(skill => skill.path);
      const between = await skill(ambientRoot, 'ambient-between-verify-start', 'AMBIENT_BETWEEN_MARKER'); documents.set(between.name, between);
      report.observations.catalogToThreadGap = { verifiedUnassignedCount: disabledFromVerifiedCatalog.length, completed: (await runTurn(api, 'catalog-to-thread-gap', `Use $${between.name} for this inert check. Do not run tools or change files.`, strictConfig(disabledFromVerifiedCatalog))).completed };

      const sameThread = await api.call('thread/start', { cwd: dirs.work, approvalPolicy: 'never', sandbox: 'read-only', config: strictConfig(), experimentalRawEvents: true });
      const after = await skill(ambientRoot, 'ambient-after-thread', 'AMBIENT_AFTER_MARKER'); documents.set(after.name, after);
      await api.call('skills/list', { cwds: [dirs.work], forceReload: true });
      report.observations.ambientAfterThreadMention = { completed: (await runTurn(api, 'ambient-after-thread-mention', `Use $${after.name} for this inert check. Do not run tools or change files.`, strictConfig(), sameThread.thread.id)).completed };

      const raceOutcomes = [];
      for (let index = 0; index < 3; index++) {
        const name = `ambient-race-${index}`; const marker = `AMBIENT_RACE_${index}_MARKER`;
        const thread = await api.call('thread/start', { cwd: dirs.work, approvalPolicy: 'never', sandbox: 'read-only', config: strictConfig(), experimentalRawEvents: true }); sessions.set(thread.thread.id, `race-${index}`);
        const begin = api.events.length;
        const turn = await api.call('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: `Use $${name} for this inert check. Do not run tools or change files.`, text_elements: [] }] });
        const raced = await skill(ambientRoot, name, marker); documents.set(name, raced);
        if (index === 2 && turn.turn?.id) { await pause(50); await api.call('turn/interrupt', { threadId: thread.thread.id, turnId: turn.turn.id }).catch(() => undefined); }
        const deadline = Date.now() + 45000; while (!api.events.slice(begin).some(event => event.method === 'turn/completed') && Date.now() < deadline) await pause(100);
        raceOutcomes.push({ completed: api.events.slice(begin).some(event => event.method === 'turn/completed'), interrupted: index === 2 });
      }
      report.observations.races = raceOutcomes;

      const control = await runTurn(api, 'catalog-visible-control', 'Perform the inert check if an applicable Skill is available. Do not run tools or change files.', permissiveConfig);
      report.observations.catalogVisibleControl = { completed: control.completed };
      const resumeThread = sameThread.thread.id;
      await stop(child); ({ child, api } = await initialize());
      const resumed = await api.call('thread/resume', { threadId: resumeThread, cwd: dirs.work, approvalPolicy: 'never', sandbox: 'read-only', config: strictConfig(), experimentalRawEvents: true });
      report.observations.resume = { resumed: resumed.thread?.id === resumeThread, completed: (await runTurn(api, 'resume-ambient-mention', `Use $${after.name} for this inert check. Do not run tools or change files.`, strictConfig(), resumeThread)).completed };
      report.observations.context = await rolloutEvidence();
    } catch { report.observations.runtime = 'blocked-or-contract-failure'; }
    finally { await stop(child); }
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  for (const child of children) await stop(child);
  await rm(root, { recursive: true, force: true });
}
