import {
  type RedisInfo,
  type RedisKeyPage,
  type RedisValue,
  REDIS_ERROR,
  SCAN_BATCH,
  VALUE_BYTES,
  VALUE_ITEMS,
  parseInfo,
  parseKeyPage,
  parseValue,
} from "@/lib/redis";
import { getDb } from "./db/client";
import { listDatabaseServers } from "./dumps/containers";
import { runQuick } from "./dumps/docker-run";
import type { Command } from "./dumps/engines";
import { serverMessages } from "./i18n";

export type RedisLogin = { containerId: string; env: Record<string, string> };

const TIMEOUT_MS = 15_000;

/** The password the container is started with: its own variables, never typed in the browser. */
export function redisPassword(env: Record<string, string>): string | null {
  const fromArgs = /--requirepass\s+(\S+)/.exec(env.REDIS_ARGS ?? "")?.[1];
  return env.REDISCLI_AUTH || env.REDIS_PASSWORD || env.REDIS_MASTER_PASSWORD || fromArgs || null;
}

/** The client has a different name from one image to the next: the first one found is used. */
const PICK_CLIENT =
  'tool=$(command -v redis-cli || command -v valkey-cli || command -v keydb-cli) || { echo "no Redis client found in this container" >&2; exit 127; }; exec "$tool" "$@"';

export function redisCommand(env: Record<string, string>, database: number, args: string[]): Command {
  const password = redisPassword(env);
  return {
    args: ["sh", "-c", PICK_CLIENT, "sh", "--raw", "-n", String(database), ...args],
    // The client reads the password from this variable: it stays out of the command line.
    secrets: password ? { REDISCLI_AUTH: password } : {},
  };
}

export type RedisOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

async function run(login: RedisLogin, database: number, args: string[]): Promise<RedisOutcome<string>> {
  try {
    const out = await runQuick(login.containerId, redisCommand(login.env, database, args), TIMEOUT_MS);
    if (out.code === null) return { ok: false, error: "timeout" };
    const first = out.stdout.trim().split("\n")[0] ?? "";
    if (out.code !== 0 || REDIS_ERROR.test(first)) {
      return { ok: false, error: (out.code !== 0 ? out.stderr.trim() || first : first).split("\n").slice(-3).join("\n") || `exit ${out.code}` };
    }
    return { ok: true, value: out.stdout };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Fixed scripts: what comes from the browser is only ever an argument, read as data. EVAL_RO
 * (Redis 7) makes the server itself refuse a write; older servers only know EVAL, and these
 * scripts call nothing but read commands.
 */
async function script(login: RedisLogin, database: number, lua: string, argv: string[]): Promise<RedisOutcome<string>> {
  const readOnly = await run(login, database, ["EVAL_RO", lua, "0", ...argv]);
  if (readOnly.ok || !/unknown command|unknown subcommand/i.test(readOnly.error)) return readOnly;
  return run(login, database, ["EVAL", lua, "0", ...argv]);
}

const SCAN_SCRIPT = `
local cursor = ARGV[1]
local want = tonumber(ARGV[3])
local keys = {}
local calls = 0
repeat
  local reply = redis.call('SCAN', cursor, 'MATCH', ARGV[2], 'COUNT', ${SCAN_BATCH * 2})
  cursor = reply[1]
  calls = calls + 1
  for _, key in ipairs(reply[2]) do
    keys[#keys + 1] = { key, redis.call('TYPE', key)['ok'], redis.call('PTTL', key) }
  end
until cursor == '0' or #keys >= want or calls >= 100
return cjson.encode({ cursor = cursor, keys = keys })
`;

const VALUE_SCRIPT = `
local key = ARGV[1]
local count = tonumber(ARGV[2])
local bytes = tonumber(ARGV[3])
local kind = redis.call('TYPE', key)['ok']
local out = { type = kind, ttl = redis.call('PTTL', key) }
local function cut(list)
  for i, item in ipairs(list) do
    if type(item) == 'string' and #item > 1000 then list[i] = string.sub(item, 1, 1000) end
  end
  return list
end
if kind == 'string' then
  out.size = redis.call('STRLEN', key)
  out.value = redis.call('GETRANGE', key, 0, bytes - 1)
elseif kind == 'list' then
  out.size = redis.call('LLEN', key)
  out.items = cut(redis.call('LRANGE', key, 0, count))
elseif kind == 'hash' then
  out.size = redis.call('HLEN', key)
  out.items = cut(redis.call('HSCAN', key, '0', 'COUNT', count)[2])
elseif kind == 'set' then
  out.size = redis.call('SCARD', key)
  out.items = cut(redis.call('SSCAN', key, '0', 'COUNT', count)[2])
elseif kind == 'zset' then
  out.size = redis.call('ZCARD', key)
  out.items = cut(redis.call('ZRANGE', key, 0, count - 1, 'WITHSCORES'))
elseif kind == 'stream' then
  out.size = redis.call('XLEN', key)
  local entries = redis.call('XRANGE', key, '-', '+', 'COUNT', count)
  for _, entry in ipairs(entries) do entry[2] = cut(entry[2]) end
  out.items = entries
end
return cjson.encode(out)
`;

export async function scanKeys(login: RedisLogin, database: number, pattern: string, cursor: string): Promise<RedisOutcome<RedisKeyPage>> {
  const outcome = await script(login, database, SCAN_SCRIPT, [cursor, pattern, String(SCAN_BATCH)]);
  if (!outcome.ok) return outcome;
  const page = parseKeyPage(outcome.value);
  return page ? { ok: true, value: page } : { ok: false, error: "unreadable" };
}

export async function readKey(login: RedisLogin, database: number, key: string): Promise<RedisOutcome<RedisValue>> {
  const outcome = await script(login, database, VALUE_SCRIPT, [key, String(VALUE_ITEMS + 1), String(VALUE_BYTES)]);
  if (!outcome.ok) return outcome;
  const value = parseValue(outcome.value);
  return value ? { ok: true, value } : { ok: false, error: "unreadable" };
}

export async function readInfo(login: RedisLogin): Promise<RedisOutcome<RedisInfo>> {
  const outcome = await run(login, 0, ["INFO"]);
  return outcome.ok ? { ok: true, value: parseInfo(outcome.value) } : outcome;
}

/**
 * Looks the server up again among the projects' containers: the browser only names it.
 * The login (with the password from the container's variables) never leaves the server.
 */
export async function connectRedis(id: string): Promise<{ login: RedisLogin; m: ReturnType<typeof serverMessages>["databases"]["errors"] } | { error: string }> {
  const m = serverMessages(getDb()).databases.errors;
  const { redis, error } = await listDatabaseServers(getDb());
  if (error) return { error: m.dockerUnavailable(error) };
  const container = redis.find((item) => item.id === String(id));
  if (!container) return { error: m.containerGone };
  return { login: { containerId: container.info.id, env: container.info.env }, m };
}
