export type StateKind =
  | "running"
  | "unhealthy"
  | "starting"
  | "restarting"
  | "paused"
  | "failed"
  | "stopped"
  | "created";

export type Tone = "ok" | "warn" | "info" | "off";

export const TONE: Record<StateKind, Tone> = {
  running: "ok",
  unhealthy: "warn",
  failed: "warn",
  starting: "info",
  restarting: "info",
  paused: "info",
  stopped: "off",
  created: "off",
};

/** Worst first: what needs attention comes before what is simply fine. */
export const STATE_ORDER: StateKind[] = ["unhealthy", "failed", "restarting", "starting", "paused", "running", "created", "stopped"];

/**
 * Docker stopping a container leaves 143 (asked politely) or 137 (killed after the delay),
 * and Ctrl+C leaves 130: none of them is a crash. Being killed for memory always is one.
 */
const CLEAN_EXITS = new Set([0, 130, 137, 143]);

export function classify({
  state,
  health = null,
  exitCode = null,
  outOfMemory = false,
}: {
  state: string;
  health?: string | null;
  exitCode?: number | null;
  outOfMemory?: boolean;
}): StateKind {
  switch (state) {
    case "running":
      return health === "unhealthy" ? "unhealthy" : health === "starting" ? "starting" : "running";
    case "restarting":
      return "restarting";
    case "paused":
      return "paused";
    case "created":
      return "created";
    case "dead":
      return "failed";
    default:
      return outOfMemory || (exitCode !== null && !CLEAN_EXITS.has(exitCode)) ? "failed" : "stopped";
  }
}

/** For what was stored from `docker ps`, which only has the words of its status column. */
export function classifyStatus(state: string, status: string): StateKind {
  const health = /\((unhealthy|healthy|health: starting)\)/.exec(status)?.[1];
  const code = /^Exited \((\d+)\)/.exec(status)?.[1];
  return classify({
    state,
    health: health === "unhealthy" ? "unhealthy" : health === "health: starting" ? "starting" : null,
    exitCode: code === undefined ? null : Number(code),
  });
}

export function countStates(kinds: StateKind[]): { kind: StateKind; count: number }[] {
  return STATE_ORDER.map((kind) => ({ kind, count: kinds.filter((item) => item === kind).length })).filter(
    ({ count }) => count > 0,
  );
}
