import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';

export interface EnvConfig {
  workspaceRoot: string;
}

let cachedConfig: EnvConfig | null = null;

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
};

const resolveUserPath = (inputPath: string): string => {
  if (inputPath === '~') {
    return os.homedir();
  }

  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return path.resolve(inputPath);
};

export const getEnvConfig = (): EnvConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const workspaceRoot = resolveUserPath(requireEnv('WORKTREEHUB_WORKSPACE_ROOT'));

  cachedConfig = { workspaceRoot };

  return cachedConfig;
};

/** Main-owned launch inputs. No provider inherits the application's complete environment. */
export const getResourceRuntimeEnvironment = (): Readonly<NodeJS.ProcessEnv> => Object.freeze(Object.fromEntries([
  'PATH','TMPDIR','OPENAI_API_KEY','ANTHROPIC_API_KEY','GOOGLE_GENERATIVE_AI_API_KEY',
  'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_REGION',
  'HTTP_PROXY','HTTPS_PROXY','NO_PROXY','SSL_CERT_FILE','NODE_EXTRA_CA_CERTS',
].flatMap(key => process.env[key] === undefined ? [] : [[key,process.env[key]]])));

/** Persistent local evidence key supplied by deployment; absent key closes Resource cutover. */
export const getResourceEvidenceKey = (): Uint8Array|null => {
  const raw = process.env.WORKTREEHUB_RESOURCE_EVIDENCE_KEY;
  if (!raw) return null;
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) throw new Error('resource_evidence_key_unavailable');
  return Buffer.from(raw,'hex');
};
export const getResourceEvidenceConfiguration = (): {keyVersion:number;evidenceKey:Uint8Array;previousKeys:Readonly<Record<number,Uint8Array>>}|null => {
  const evidenceKey=getResourceEvidenceKey();
  if(!evidenceKey)return null;
  const rawVersion=process.env.WORKTREEHUB_RESOURCE_EVIDENCE_KEY_VERSION ?? '1';
  if(!/^[1-9][0-9]*$/.test(rawVersion) || !Number.isSafeInteger(Number(rawVersion)))throw new Error('resource_evidence_key_unavailable');
  const keyVersion=Number(rawVersion),previousKeys:Record<number,Uint8Array>={};
  const rawPrevious=process.env.WORKTREEHUB_RESOURCE_EVIDENCE_PREVIOUS_KEYS;
  if(rawPrevious) {
    let parsed:unknown;
    try {parsed=JSON.parse(rawPrevious);} catch {throw new Error('resource_evidence_key_unavailable');}
    if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length>32)throw new Error('resource_evidence_key_unavailable');
    for(const [version,key] of Object.entries(parsed)) {
      if(!/^[1-9][0-9]*$/.test(version) || !Number.isSafeInteger(Number(version)) || Number(version)>=keyVersion || typeof key !== 'string' || !/^[a-fA-F0-9]{64}$/.test(key))throw new Error('resource_evidence_key_unavailable');
      previousKeys[Number(version)]=Buffer.from(key,'hex');
    }
  }
  return {keyVersion,evidenceKey,previousKeys:Object.freeze(previousKeys)};
};
