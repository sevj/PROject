import { type StateKind, TONE, type Tone } from "@/lib/docker-state";

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-alert",
  info: "text-accent",
  off: "text-mut",
};
export const TONE_BG: Record<Tone, string> = { ok: "bg-ok", warn: "bg-alert", info: "bg-accent", off: "bg-rule-strong" };
export const TONE_EDGE: Record<Tone, string> = {
  ok: "border-l-ok",
  warn: "border-l-alert",
  info: "border-l-accent",
  off: "border-l-rule-strong",
};

const STROKE = { stroke: "currentColor", strokeWidth: 1.4, fill: "none" } as const;

/** The shape says as much as the color, so that the state survives color blindness. */
export function StateGlyph({ kind }: { kind: StateKind }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10" width="10" height="10" className={`shrink-0 ${TONE_TEXT[TONE[kind]]}`}>
      {kind === "running" ? <rect x="0.5" y="0.5" width="9" height="9" fill="currentColor" /> : null}
      {kind === "stopped" ? <rect x="1" y="1" width="8" height="8" {...STROKE} /> : null}
      {kind === "created" ? <rect x="1" y="1" width="8" height="8" {...STROKE} strokeDasharray="2 1.6" /> : null}
      {kind === "starting" ? (
        <>
          <rect x="1" y="1" width="8" height="8" {...STROKE} />
          <rect x="3.5" y="3.5" width="3" height="3" fill="currentColor" />
        </>
      ) : null}
      {kind === "unhealthy" ? <path d="M5 .8 9.6 9.2H.4z" fill="currentColor" /> : null}
      {kind === "failed" ? <path d="M1.5 1.5 8.5 8.5M8.5 1.5 1.5 8.5" {...STROKE} strokeWidth={1.8} /> : null}
      {kind === "paused" ? (
        <>
          <rect x="1.8" y="1" width="2.2" height="8" fill="currentColor" />
          <rect x="6" y="1" width="2.2" height="8" fill="currentColor" />
        </>
      ) : null}
      {kind === "restarting" ? <path d="M8.6 5a3.6 3.6 0 1 1-1.1-2.6M8.6 1v2.6H6" {...STROKE} /> : null}
    </svg>
  );
}

export function StateBadge({ kind, label }: { kind: StateKind; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[.06em] uppercase ${TONE_TEXT[TONE[kind]]}`}
    >
      <StateGlyph kind={kind} />
      {label}
    </span>
  );
}
