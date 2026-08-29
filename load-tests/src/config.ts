import { existsSync, readFileSync } from 'node:fs';

export const PRODUCTION_REF = 'yoozrnosmqtaiksgcixc';
const WRITE_CONFIRMATION = 'i-understand-this-writes-to-staging';

export type LoadTestConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  stagingRef: string;
  writeApproved: boolean;
  universityId: string;
  emailDomain: string;
  databaseUrl?: string;
  resultsDir: string;
  seedNamespace: string;
  requestTimeoutMs: number;
  observeIntervalMs: number;
};

type RawConfig = Record<string, unknown>;

function readConfigFile(): RawConfig {
  const file = process.env.LOADTEST_CONFIG_FILE?.trim();
  if (!file) return {};
  if (!existsSync(file)) throw new Error(`LOADTEST_CONFIG_FILE does not exist: ${file}`);
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LOADTEST_CONFIG_FILE must contain a JSON object');
  }
  return parsed as RawConfig;
}

function value(file: RawConfig, env: string, ...aliases: string[]): string | undefined {
  const envValue = process.env[env]?.trim();
  if (envValue) return envValue;
  for (const alias of aliases) {
    const fileValue = file[alias];
    if (typeof fileValue === 'string' && fileValue.trim()) return fileValue.trim();
  }
  return undefined;
}

function required(file: RawConfig, env: string, ...aliases: string[]): string {
  const found = value(file, env, ...aliases);
  if (!found) throw new Error(`Missing ${env} (or ${aliases.join(', ')})`);
  return found;
}

function integer(file: RawConfig, env: string, fallback: number, ...aliases: string[]): number {
  const envValue = process.env[env]?.trim();
  const fileValue = aliases.map((alias) => file[alias]).find((candidate) => typeof candidate === 'number' || (typeof candidate === 'string' && candidate.trim()));
  const raw: string | number | undefined = envValue || (typeof fileValue === 'number' || typeof fileValue === 'string' ? fileValue : undefined);
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${env} must be a non-negative integer`);
  return parsed;
}

function assertUuid(name: string, input: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)) {
    throw new Error(`${name} must be a UUID`);
  }
  return input;
}

function parsedSupabaseRef(supabaseUrl: string): string {
  let hostname: string;
  try {
    hostname = new URL(supabaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('LOADTEST_SUPABASE_URL must be a valid URL');
  }
  const match = hostname.match(/^([a-z]{20})\.supabase\.co$/);
  if (!match?.[1]) {
    throw new Error('LOADTEST_SUPABASE_URL hostname must be exactly <20-letter-project-ref>.supabase.co');
  }
  return match[1];
}

export function loadConfig(): LoadTestConfig {
  const file = readConfigFile();
  const supabaseUrl = required(file, 'LOADTEST_SUPABASE_URL', 'supabaseUrl', 'SUPABASE_URL').replace(/\/$/, '');
  const anonKey = required(file, 'LOADTEST_SUPABASE_ANON_KEY', 'anonKey', 'SUPABASE_ANON_KEY');
  const serviceKey = required(file, 'LOADTEST_SUPABASE_SERVICE_KEY', 'serviceKey', 'SUPABASE_SERVICE_ROLE_KEY');
  const stagingRef = required(file, 'LOADTEST_STAGING_REF', 'stagingRef');
  const universityId = assertUuid(
    'LOADTEST_UNIVERSITY_ID',
    required(file, 'LOADTEST_UNIVERSITY_ID', 'universityId'),
  );
  const emailDomain = required(file, 'LOADTEST_EMAIL_DOMAIN', 'emailDomain').replace(/^@/, '').toLowerCase();

  if (supabaseUrl.toLowerCase().includes(PRODUCTION_REF)) {
    throw new Error(
      `REFUSING TO RUN: target URL contains the production Supabase ref ${PRODUCTION_REF}. ` +
        'Point LOADTEST_SUPABASE_URL at a staging project.',
    );
  }
  if (!/^[a-z]{20}$/.test(stagingRef)) throw new Error('LOADTEST_STAGING_REF must match ^[a-z]{20}$');
  if (stagingRef === PRODUCTION_REF) throw new Error(`REFUSING TO RUN: LOADTEST_STAGING_REF is the production ref ${PRODUCTION_REF}`);
  const urlRef = parsedSupabaseRef(supabaseUrl);
  if (urlRef !== stagingRef) {
    throw new Error(
      `REFUSING TO RUN: LOADTEST_STAGING_REF does not match the target URL.\n` +
        `  configured staging ref: ${stagingRef}\n` +
        `  URL project ref: ${urlRef}\n` +
        'Point both values at the same staging Supabase project.',
    );
  }
  const databaseUrl = value(file, 'LOADTEST_DATABASE_URL', 'databaseUrl');
  if (databaseUrl?.toLowerCase().includes(PRODUCTION_REF)) {
    throw new Error(`REFUSING TO RUN: LOADTEST_DATABASE_URL contains the production Supabase ref ${PRODUCTION_REF}`);
  }
  if (!/^https:\/\//i.test(supabaseUrl)) throw new Error('LOADTEST_SUPABASE_URL must use https://');
  if (anonKey === serviceKey) throw new Error('Anon and service keys must be different');
  if (!emailDomain.includes('.')) throw new Error('LOADTEST_EMAIL_DOMAIN must be a domain such as staging.example.edu');

  return {
    supabaseUrl,
    anonKey,
    serviceKey,
    stagingRef,
    writeApproved: process.env.LOADTEST_CONFIRM_WRITES === WRITE_CONFIRMATION,
    universityId,
    emailDomain,
    databaseUrl,
    resultsDir: value(file, 'LOADTEST_RESULTS_DIR', 'resultsDir') ?? 'load-tests/results',
    seedNamespace: value(file, 'LOADTEST_SEED_NAMESPACE', 'seedNamespace') ?? 'default',
    requestTimeoutMs: integer(file, 'LOADTEST_REQUEST_TIMEOUT_MS', 20_000, 'requestTimeoutMs'),
    observeIntervalMs: integer(file, 'LOADTEST_OBSERVE_INTERVAL_MS', 5_000, 'observeIntervalMs'),
  };
}

export function assertWriteApproved(config: LoadTestConfig): void {
  let urlRef: string | undefined;
  try { urlRef = parsedSupabaseRef(config.supabaseUrl); } catch { urlRef = undefined; }
  const refMatched = urlRef === config.stagingRef && config.stagingRef !== PRODUCTION_REF;
  if (config.writeApproved === true && refMatched) return;
  throw new Error(
    'REFUSING TO WRITE: explicit staging approval is required.\n' +
      `  target URL: ${config.supabaseUrl}\n` +
      `  configured staging ref: ${config.stagingRef}\n` +
      `  URL project ref: ${urlRef ?? 'unparseable'}\n` +
      `  staging ref matched: ${refMatched ? 'yes' : 'no'}\n` +
      `  write confirmation: ${config.writeApproved ? 'accepted' : 'missing or invalid'}\n` +
      'Set LOADTEST_CONFIRM_WRITES=i-understand-this-writes-to-staging only after verifying this is the intended staging project.',
  );
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[body] = next;
      i += 1;
    } else {
      args[body] = true;
    }
  }
  return args;
}

export function argString(args: Record<string, string | boolean>, name: string, fallback: string): string {
  const raw = args[name];
  return typeof raw === 'string' ? raw : fallback;
}

export function argNumber(args: Record<string, string | boolean>, name: string, fallback: number): number {
  const raw = argString(args, name, String(fallback));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative number`);
  return parsed;
}
