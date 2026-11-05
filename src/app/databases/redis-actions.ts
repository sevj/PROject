"use server";

import { type RedisInfo, type RedisKeyPage, type RedisValue, checkDbIndex, checkKey, checkScanPattern } from "@/lib/redis";
import { connectRedis, readInfo, readKey, scanKeys } from "@/server/redis";

type Fail = { error: string };

const failed = (m: { timeout: string; failed: (reason: string) => string; unreadable: string }, error: string): Fail => ({
  error: error === "timeout" ? m.timeout : error === "unreadable" ? m.unreadable : m.failed(error),
});

/** The databases that hold keys, and database 0 whatever it holds. */
export async function loadRedisDatabases(id: string): Promise<{ databases: string[]; defaultDatabase: string | null } | Fail> {
  const info = await loadRedisInfo(id);
  if ("error" in info) return info;
  const indexes = new Set([0, ...info.databases.filter(({ keys }) => keys > 0).map(({ index }) => index)]);
  const databases = [...indexes].sort((a, b) => a - b).map(String);
  return { databases, defaultDatabase: "0" };
}

export async function loadRedisInfo(id: string): Promise<RedisInfo | Fail> {
  const connected = await connectRedis(id);
  if ("error" in connected) return connected;
  const outcome = await readInfo(connected.login);
  return outcome.ok ? outcome.value : failed(connected.m, outcome.error);
}

export async function scanRedisKeys(id: string, database: string, pattern: string, cursor: string): Promise<RedisKeyPage | Fail> {
  const connected = await connectRedis(id);
  if ("error" in connected) return connected;
  const index = checkDbIndex(database);
  const checked = checkScanPattern(String(pattern ?? ""));
  if (index === null || checked === null || !/^\d{1,20}$/.test(String(cursor))) return { error: connected.m.invalidName };
  const outcome = await scanKeys(connected.login, index, checked, String(cursor));
  return outcome.ok ? outcome.value : failed(connected.m, outcome.error);
}

export async function readRedisKey(id: string, database: string, key: string): Promise<RedisValue | Fail> {
  const connected = await connectRedis(id);
  if ("error" in connected) return connected;
  const index = checkDbIndex(database);
  if (index === null || !checkKey(key)) return { error: connected.m.invalidName };
  const outcome = await readKey(connected.login, index, key);
  return outcome.ok ? outcome.value : failed(connected.m, outcome.error);
}
