import { describe, expect, it } from "vitest";
import { isLocalRequest } from "./local-request";

const local = { host: "127.0.0.1:4300", origin: null, secFetchSite: null };

describe("isLocalRequest", () => {
  it.each(["127.0.0.1:4300", "localhost:4300", "[::1]:4300", "127.0.0.1"])("accepts host %s", (host) => {
    expect(isLocalRequest({ ...local, host })).toBe(true);
  });

  it.each(["evil.test", "evil.test:4300", "127.0.0.1.evil.test:4300", "192.168.1.10:4300", "", "a b"])(
    "rejects host %s",
    (host) => {
      expect(isLocalRequest({ ...local, host })).toBe(false);
    },
  );

  it("rejects a missing host", () => {
    expect(isLocalRequest({ ...local, host: null })).toBe(false);
  });

  it("accepts a same-origin request", () => {
    expect(
      isLocalRequest({ ...local, origin: "http://127.0.0.1:4300", secFetchSite: "same-origin" }),
    ).toBe(true);
  });

  it.each(["https://evil.test", "http://127.0.0.1:9999", "null"])("rejects origin %s", (origin) => {
    expect(isLocalRequest({ ...local, origin })).toBe(false);
  });

  it("rejects a cross-site request with no origin", () => {
    expect(isLocalRequest({ ...local, secFetchSite: "cross-site" })).toBe(false);
  });
});
