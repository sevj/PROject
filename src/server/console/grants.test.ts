import { describe, expect, it } from "vitest";
import { DEFAULT_CONSOLE_OPTIONS } from "@/lib/console-options";
import { authorizeUpgrade, GRANT_TTL_MS, issueGrant, takeGrant } from "./grants";

const grant = { kind: "docker" as const, containerId: "c1", options: DEFAULT_CONSOLE_OPTIONS, appHost: "127.0.0.1:4300" };
const headers = { host: "127.0.0.1:5000", origin: "http://127.0.0.1:4300" };

describe("grants", () => {
  it("are single use, unguessable, and short lived", () => {
    const token = issueGrant(grant, 1000);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(takeGrant(token, 1000 + GRANT_TTL_MS - 1)).toMatchObject({ containerId: "c1" });
    expect(takeGrant(token, 1000)).toBeNull();
    const late = issueGrant(grant, 1000);
    expect(takeGrant(late, 1000 + GRANT_TTL_MS)).toBeNull();
    expect(takeGrant("unknown")).toBeNull();
    expect(issueGrant(grant)).not.toBe(issueGrant(grant));
  });
});

describe("authorizeUpgrade", () => {
  const url = (token: string) => `/?token=${token}`;

  it("lets the app that asked in, on the loopback port of the server", () => {
    expect(authorizeUpgrade(headers, url(issueGrant(grant)), 5000)).toMatchObject({ containerId: "c1" });
    expect(authorizeUpgrade({ ...headers, host: "localhost:5000" }, url(issueGrant(grant)), 5000)).not.toBeNull();
  });

  it.each([
    ["another site", { origin: "http://evil.test" }],
    ["the same site on another port", { origin: "http://127.0.0.1:9999" }],
    ["no origin", { origin: undefined }],
    ["a malformed origin", { origin: "null" }],
    ["a rebound host name", { host: "evil.test:5000" }],
    ["another port", { host: "127.0.0.1:5001" }],
    ["no host", { host: undefined }],
  ])("refuses %s", (_, change) => {
    expect(authorizeUpgrade({ ...headers, ...change }, url(issueGrant(grant)), 5000)).toBeNull();
  });

  it("refuses a missing, unknown or spent token, and spends it even when the origin is wrong", () => {
    expect(authorizeUpgrade(headers, "/", 5000)).toBeNull();
    expect(authorizeUpgrade(headers, url("nope"), 5000)).toBeNull();
    const token = issueGrant(grant);
    expect(authorizeUpgrade({ ...headers, origin: "http://evil.test" }, url(token), 5000)).toBeNull();
    expect(authorizeUpgrade(headers, url(token), 5000)).toBeNull();
  });
});
