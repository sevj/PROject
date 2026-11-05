import { randomBytes, timingSafeEqual } from "node:crypto";

// Kept on globalThis so that a hot reload in dev does not cut off the consoles already open.
const holder = globalThis as unknown as { __pmMcpToken?: string };

/** Known to this server and to the consoles it starts, and gone when it stops. */
export const mcpToken = () => (holder.__pmMcpToken ??= randomBytes(32).toString("base64url"));

export function isMcpToken(header: string | null): boolean {
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${mcpToken()}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** What a console is given to reach the app, written to a private file rather than on its command line. */
export const mcpConfig = (appHost: string, projectId: number) =>
  JSON.stringify({
    mcpServers: {
      "project-manager": {
        type: "http",
        url: `http://${appHost}/api/mcp`,
        headers: { Authorization: `Bearer ${mcpToken()}`, "X-PM-Project": String(projectId) },
      },
    },
  });
