"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BUTTON, BUTTON_PRIMARY, BUTTON_TOGGLE, DATA, FIELD } from "@/app/ui";
import { usePageLock } from "@/app/use-page-lock";
import { useMessages } from "@/i18n/provider";
import {
  createLineSplitter,
  formatLogTime,
  type LogEvent,
  type LogStreamName,
  mergeLogRows,
  parseLogLine,
} from "@/lib/container-logs";
import type { StateKind } from "@/lib/docker-state";
import { StateGlyph } from "./state-badge";

type Status = "connecting" | "live" | "waiting" | "ended" | "failed";
type Row = { id: number; at: string; stream: LogStreamName; source?: string; time: string | null; text: string };

const GLYPH: Record<Status, StateKind> = { connecting: "starting", live: "running", waiting: "stopped", ended: "stopped", failed: "failed" };

/** What the browser keeps: the oldest lines go first. */
const MAX_LINES = 5000;
/** A container can write faster than it is worth drawing. */
const DRAW_MS = 150;

function useContainerLogs(url: string, connectKey: number, unreachable: string) {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    let waiting: Row[] = [];
    let nextId = 0;
    let lastTime = "";
    const draw = () => {
      if (waiting.length === 0) return;
      const added = waiting;
      waiting = [];
      setRows((current) => mergeLogRows(current, added, MAX_LINES));
    };
    const timer = setInterval(draw, DRAW_MS);

    void (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: abort.signal });
        if (!response.ok || !response.body) {
          setDetail((await response.text()) || unreachable);
          setStatus("failed");
          return;
        }
        setStatus("live");
        const splitter = createLineSplitter();
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let outcome: Status = "ended";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of splitter.push(value)) {
            if (line === "") continue;
            const event = JSON.parse(line) as LogEvent;
            if ("end" in event) {
              // A code other than 0 is explained by the last line, which Docker wrote on stderr.
              if (event.code !== 0) outcome = "failed";
              if (event.error) setDetail(event.error);
            } else if ("waiting" in event) {
              setStatus(event.waiting ? "waiting" : "live");
            } else {
              const parsed = parseLogLine(event.line);
              lastTime = parsed.time ?? lastTime;
              waiting.push({ id: nextId++, at: lastTime, stream: event.stream, source: event.source, ...parsed });
            }
          }
        }
        draw();
        setStatus(outcome);
      } catch {
        if (abort.signal.aborted) return;
        draw();
        setDetail(unreachable);
        setStatus("failed");
      }
    })();

    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [url, connectKey, unreachable]);

  const reset = () => {
    setRows([]);
    setDetail(null);
    setStatus("connecting");
  };
  return { rows, status, detail, reset };
}

const LogRow = memo(function LogRow({ row, showTime, errLabel }: { row: Row; showTime: boolean; errLabel: string }) {
  return (
    <div
      title={row.stream === "err" ? errLabel : undefined}
      className={`flex gap-3 border-l-2 px-2 ${row.stream === "err" ? "border-alert/50" : "border-transparent"}`}
    >
      {showTime && row.time ? <time dateTime={row.time} className="shrink-0 text-mut">{formatLogTime(row.time)}</time> : null}
      {row.source ? <span title={row.source} className="w-[120px] shrink-0 truncate text-accent">{row.source}</span> : null}
      <span className="min-h-[1lh] min-w-0 break-all whitespace-pre-wrap">{row.text}</span>
    </div>
  );
});

/** Read and followed only while it is open. Nothing is written anywhere, and the container is left alone. */
export function LogsPanel({
  projectId,
  containerId,
  containerName,
  onClose,
}: {
  projectId: number;
  /** Without it, all the containers of the project together. */
  containerId?: string;
  containerName: string;
  onClose: () => void;
}) {
  const sheet = useMessages().sheet;
  const m = sheet.logs;
  const [connectKey, setConnectKey] = useState(0);
  const url = containerId ? `/api/projects/${projectId}/containers/${containerId}/logs` : `/api/projects/${projectId}/logs`;
  const { rows, status, detail, reset } = useContainerLogs(url, connectKey, m.unreachable);
  const [filter, setFilter] = useState("");
  const [showTime, setShowTime] = useState(true);
  const [following, setFollowing] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  usePageLock();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle === "" ? rows : rows.filter(({ text, source }) => text.toLowerCase().includes(needle) || source?.toLowerCase().includes(needle));
  }, [rows, filter]);

  useLayoutEffect(() => {
    if (following && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [shown, following, showTime]);

  const label =
    status === "connecting" ? m.connecting : status === "live" ? m.live : status === "waiting" ? m.waiting : status === "ended" ? m.ended : m.failed;
  const empty = rows.length === 0 && (status === "live" || status === "waiting" || status === "ended");

  return (
    <section
      role="dialog"
      aria-label={m.title(containerName)}
      className="fixed inset-3 z-50 flex flex-col overscroll-contain border border-rule-strong bg-bg font-sans text-[14px] font-normal text-ink max-sm:inset-0"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule-strong px-3 py-2">
        <h2 className="min-w-0 flex-1 font-semibold break-all">{m.title(containerName)}</h2>
        <span role="status" className={`${DATA} inline-flex items-center gap-2`}>
          <StateGlyph kind={GLYPH[status]} />
          {label}
        </span>
        <div className="flex flex-wrap gap-2">
          {status === "ended" || status === "failed" ? (
            <button
              type="button"
              onClick={() => {
                reset();
                setFollowing(true);
                setConnectKey((key) => key + 1);
              }}
              className={BUTTON_PRIMARY}
            >
              {m.reload}
            </button>
          ) : null}
          <button type="button" onClick={onClose} className={BUTTON}>
            {sheet.console.close}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-3 py-2">
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={m.filter}
          aria-label={m.filter}
          spellCheck={false}
          className={`${FIELD} ${DATA} max-w-sm flex-1 basis-48 placeholder:text-mut`}
        />
        <button
          type="button"
          aria-pressed={showTime}
          onClick={() => setShowTime((on) => !on)}
          className={BUTTON_TOGGLE}
        >
          {m.timestamps}
        </button>
        <button
          type="button"
          aria-pressed={following}
          onClick={() => setFollowing((on) => !on)}
          className={BUTTON_TOGGLE}
        >
          {m.follow}
        </button>
        <span className={`${DATA} text-mut`}>{m.count(shown.length, rows.length)}</span>
      </div>

      {detail ? (
        <p role="alert" className={`${DATA} border-b border-alert px-3 py-2 break-words whitespace-pre-wrap text-alert`}>
          {detail}
        </p>
      ) : null}

      <div
        ref={scroller}
        tabIndex={0}
        aria-label={m.output}
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
          // Going back up to read stops the following, and reaching the bottom picks it up again.
          setFollowing(scrollHeight - scrollTop - clientHeight < 8);
        }}
        className={`${DATA} min-h-0 flex-1 overflow-y-auto py-2 leading-relaxed`}
      >
        {empty ? <p className="px-3 text-mut">{m.empty}</p> : null}
        {rows.length > 0 && shown.length === 0 ? <p className="px-3 text-mut">{m.noMatch}</p> : null}
        {shown.map((row) => (
          <LogRow key={row.id} row={row} showTime={showTime} errLabel={m.stderr} />
        ))}
      </div>

      <p className={`${DATA} border-t border-rule px-3 py-1.5 text-mut`}>{m.note}</p>
    </section>
  );
}
