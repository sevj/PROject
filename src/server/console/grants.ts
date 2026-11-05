import { randomBytes } from "node:crypto";
import type { ClaudeTask } from "@/lib/claude-console";
import type { ConsoleOptions } from "@/lib/console-options";
import { hostnameOf, LOOPBACK_HOSTNAMES } from "@/lib/local-request";

export type GrantTarget =
  | { kind: "docker"; containerId: string; options: ConsoleOptions }
  | {
      kind: "claude";
      /** What a page connects to again. A console already running ignores the rest. */
      consoleId: string;
      projectId: number;
      projectName: string;
      startedAt: number;
      cwd: string;
      sessionId: string;
      resume: boolean;
      task?: ClaudeTask;
    };

export type Grant = GrantTarget & {
  /** `Host` of the page that asked, which the WebSocket's `Origin` must match. */
  appHost: string;
  expiresAt: number;
};

export const GRANT_TTL_MS = 30_000;

// Kept on globalThis so that a hot reload in dev does not lose a grant being used.
const holder = globalThis as unknown as { __pmConsoleGrants?: Map<string, Grant> };
const grants = () => (holder.__pmConsoleGrants ??= new Map());

/** One use, a short life, and nothing to guess: a token is the whole key to a shell. */
export function issueGrant(grant: GrantTarget & { appHost: string }, now = Date.now()): string {
  const store = grants();
  for (const [token, { expiresAt }] of store) if (expiresAt <= now) store.delete(token);
  const token = randomBytes(32).toString("base64url");
  store.set(token, { ...grant, expiresAt: now + GRANT_TTL_MS });
  return token;
}

export function takeGrant(token: string, now = Date.now()): Grant | null {
  const store = grants();
  const grant = store.get(token);
  store.delete(token);
  return grant && grant.expiresAt > now ? grant : null;
}

/**
 * The WebSocket server answers on its own port, which any page open in the browser could
 * try. `Host` stops DNS rebinding, `Origin` must be the app that issued the token, and
 * the token is spent whatever happens next.
 */
export function authorizeUpgrade(
  headers: { host?: string; origin?: string },
  url: string | undefined,
  port: number,
  now = Date.now(),
): Grant | null {
  if (!headers.host) return null;
  let host: URL;
  try {
    host = new URL(`http://${headers.host}`);
  } catch {
    return null;
  }
  if (!LOOPBACK_HOSTNAMES.has(hostnameOf(headers.host) ?? "") || Number(host.port) !== port) return null;

  const token = new URL(url ?? "/", "http://console").searchParams.get("token");
  if (!token) return null;
  const grant = takeGrant(token, now);
  if (!grant || !headers.origin) return null;
  try {
    return new URL(headers.origin).host === grant.appHost ? grant : null;
  } catch {
    return null;
  }
}
