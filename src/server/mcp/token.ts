import { randomBytes, timingSafeEqual } from "node:crypto";
import { hostnameOf, LOOPBACK_HOSTNAMES } from "@/lib/local-request";

// Kept on globalThis so that a hot reload in dev does not cut off the consoles already open.
const holder = globalThis as unknown as { __pmMcpToken?: string };

/** Known to this server and to the consoles it starts, and gone when it stops. */
export const mcpToken = () => (holder.__pmMcpToken ??= randomBytes(32).toString("base64url"));

export function isMcpToken(header: string | null): boolean {
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${mcpToken()}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Where a program on this machine reaches the app: the page's own host when it is a loopback
 * one, else the port it listens on, since a name such as project.dev.local may lead through a
 * proxy that answers only https.
 */
export function directAppHost(pageHost: string, port: string | undefined = process.env.PORT): string {
  return LOOPBACK_HOSTNAMES.has(hostnameOf(pageHost) ?? "") ? pageHost : `127.0.0.1:${port ?? "4300"}`;
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
