"use client";

import { useEffect, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import type { RedisInfo, RedisKey, RedisValue } from "@/lib/redis";
import { BADGE, BUTTON_PRIMARY, BUTTON_SMALL, CARD, DATA, FIELD, LABEL, SECTION_TITLE } from "../ui";
import { loadRedisInfo, readRedisKey, scanRedisKeys } from "./redis-actions";

const duration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
};

function ServerInfo({ info }: { info: RedisInfo }) {
  const m = useMessages().databases.redis;
  const hits = Number(info.fields.keyspace_hits);
  const misses = Number(info.fields.keyspace_misses);
  const facts: [string, string][] = [
    [m.version, info.fields.redis_version ?? "–"],
    [m.uptime, info.fields.uptime_in_seconds ? duration(Number(info.fields.uptime_in_seconds) * 1000) : "–"],
    [m.clients, info.fields.connected_clients ?? "–"],
    [m.memory, info.fields.used_memory_human ?? "–"],
    [m.hits, hits + misses > 0 ? `${Math.round((hits / (hits + misses)) * 100)}%` : "–"],
  ];
  return (
    <div className={`${CARD} flex flex-wrap gap-x-8 gap-y-2`}>
      {facts.map(([label, value]) => (
        <div key={label}>
          <div className={LABEL}>{label}</div>
          <div className={DATA}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function ValueView({ keyName, value }: { keyName: string; value: RedisValue }) {
  const m = useMessages().databases.redis;
  return (
    <div className="grid gap-3">
      <h3 className={`${DATA} text-[15px] font-bold break-all`}>{keyName}</h3>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-mut">
        <span className={BADGE}>{value.type}</span>
        {value.size !== null ? <span>{m.size(value.type, value.size)}</span> : null}
        <span>· {value.ttlMs === null ? m.noExpiry : m.expiresIn(duration(value.ttlMs))}</span>
      </div>
      {value.truncated ? <p className="text-[12px] text-mut">{m.partial}</p> : null}
      {value.text !== null ? (
        <pre className={`${DATA} max-h-[520px] overflow-auto border border-rule p-2 break-words whitespace-pre-wrap`}>{value.text === "" ? m.empty : value.text}</pre>
      ) : value.entries.length === 0 ? (
        <p className="text-mut">{m.empty}</p>
      ) : (
        <div className="max-h-[520px] overflow-auto border border-rule">
          <table className="w-full border-collapse text-left">
            <tbody>
              {value.entries.map((entry, index) => (
                <tr key={index} className="border-b border-rule align-top">
                  {entry.label !== "" ? <td className={`${DATA} max-w-[240px] px-2 py-1 break-words whitespace-pre-wrap text-mut`}>{entry.label}</td> : null}
                  <td className={`${DATA} px-2 py-1 break-words whitespace-pre-wrap`}>{entry.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function RedisBrowser({ containerId, database, onError }: { containerId: string; database: string; onError: (reason: string | null) => void }) {
  const m = useMessages().databases.redis;
  const [info, setInfo] = useState<RedisInfo | null>(null);
  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<RedisKey[]>([]);
  const [cursor, setCursor] = useState("0");
  const [busy, setBusy] = useState<"keys" | "value" | null>(null);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState<{ key: string; value: RedisValue } | null>(null);

  const search = async (from: string) => {
    onError(null);
    setBusy("keys");
    const page = await scanRedisKeys(containerId, database, pattern, from);
    setBusy(null);
    if ("error" in page) return onError(page.error);
    setSearched(true);
    setCursor(page.cursor);
    setKeys((current) => (from === "0" ? page.keys : [...current, ...page.keys]));
  };

  const show = async (key: string) => {
    onError(null);
    setBusy("value");
    const value = await readRedisKey(containerId, database, key);
    setBusy(null);
    if ("error" in value) return onError(value.error);
    setOpen({ key, value });
  };

  // The parent gives a new browser (a new `key`) to each server and database, so this runs once.
  const report = useRef(onError);
  useEffect(() => {
    report.current = onError;
  });
  useEffect(() => {
    let current = true;
    void loadRedisInfo(containerId).then((result) => {
      if (current) setInfo("error" in result ? null : result);
    });
    void scanRedisKeys(containerId, database, "*", "0").then((page) => {
      if (!current) return;
      if ("error" in page) return report.current(page.error);
      setSearched(true);
      setCursor(page.cursor);
      setKeys(page.keys);
    });
    return () => {
      current = false;
    };
  }, [containerId, database]);

  return (
    <div className="grid gap-4">
      {info ? <ServerInfo info={info} /> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className={`${CARD} grid gap-2`}>
          <h2 className={SECTION_TITLE}>{m.keysTitle}</h2>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void search("0");
            }}
          >
            <input value={pattern} onChange={(event) => setPattern(event.target.value)} title={m.patternHint} aria-label={m.pattern} spellCheck={false} className={`${FIELD} ${DATA}`} />
            <button type="submit" disabled={busy === "keys"} className={BUTTON_PRIMARY}>
              {busy === "keys" ? m.searching : m.search}
            </button>
          </form>
          {searched && keys.length === 0 ? <p className="text-mut">{m.noKeys}</p> : null}
          <ul className="grid max-h-[520px] gap-0.5 overflow-y-auto">
            {keys.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  aria-pressed={open?.key === item.key}
                  onClick={() => void show(item.key)}
                  className="flex w-full cursor-pointer items-baseline justify-between gap-2 px-2 py-1 text-left hover:bg-accent-soft aria-pressed:bg-accent-soft aria-pressed:text-accent"
                >
                  <span className={`${DATA} min-w-0 break-all`}>{item.key}</span>
                  <span className="shrink-0 text-[11px] text-mut">
                    {item.type}
                    {item.ttlMs !== null ? ` · ${duration(item.ttlMs)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            {searched ? <span className="text-[12px] text-mut">{m.shown(keys.length)}</span> : null}
            {cursor !== "0" ? (
              <button type="button" disabled={busy === "keys"} onClick={() => void search(cursor)} className={BUTTON_SMALL}>
                {m.more}
              </button>
            ) : null}
          </div>
        </section>
        <section className={`${CARD} grid gap-2`}>
          {busy === "value" ? <p className="text-mut">…</p> : open ? <ValueView keyName={open.key} value={open.value} /> : <p className="text-mut">{m.pickKey}</p>}
        </section>
      </div>
    </div>
  );
}
