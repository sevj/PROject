import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secrets";

let dir: string;
let key: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-secrets-"));
  key = join(dir, "nested", "secret.key");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("secrets", () => {
  it("gets back what it encrypted, without showing it", () => {
    const stored = encryptSecret("pâss:wörd", key);
    expect(stored).not.toContain("pâss");
    expect(decryptSecret(stored, key)).toBe("pâss:wörd");
  });

  it("never encrypts twice the same way", () => {
    expect(encryptSecret("x", key)).not.toBe(encryptSecret("x", key));
  });

  it("keeps its key private, and tightens a key left open", () => {
    encryptSecret("x", key);
    expect(statSync(key).mode & 0o777).toBe(0o600);
    const before = readFileSync(key, "utf8");
    writeFileSync(key, before, { mode: 0o644 });
    encryptSecret("x", key);
    expect(statSync(key).mode & 0o777).toBe(0o600);
    expect(readFileSync(key, "utf8")).toBe(before);
  });

  it("answers null when it cannot read: another key, a changed value, or something else", () => {
    const stored = encryptSecret("x", key);
    expect(decryptSecret(stored, join(dir, "other.key"))).toBeNull();
    const parts = stored.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(decryptSecret(parts.join(":"), key)).toBeNull();
    expect(decryptSecret("nonsense", key)).toBeNull();
  });

  it("refuses a file that is no key", () => {
    writeFileSync(join(dir, "bad.key"), "short");
    expect(() => encryptSecret("x", join(dir, "bad.key"))).toThrow(/does not hold a key/);
  });
});
