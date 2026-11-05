import { describe, expect, it } from "vitest";
import { parseAgentPrints, parseKeyPrint, sameKey, tooOpen } from "./ssh-keys";

describe("parseKeyPrint", () => {
  it("reads bits, fingerprint, comment and type", () => {
    expect(parseKeyPrint("256 SHA256:N/aM5+gDQ adimeo@10.2.232.2 (ED25519)\n")).toEqual({ bits: 256, fingerprint: "SHA256:N/aM5+gDQ", comment: "adimeo@10.2.232.2", type: "ED25519" });
    expect(parseKeyPrint("3072 SHA256:abc no comment (RSA)")).toMatchObject({ comment: "", type: "RSA" });
    expect(parseKeyPrint("3072 SHA256:abc two words here (RSA)")).toMatchObject({ comment: "two words here" });
    expect(parseKeyPrint("x.pub is not a public key file.")).toBeNull();
  });
});

describe("parseAgentPrints", () => {
  it("lists what the agent holds", () => {
    expect([...parseAgentPrints("256 SHA256:a me (ED25519)\n3072 SHA256:b you (RSA)\n")]).toEqual(["SHA256:a", "SHA256:b"]);
    expect(parseAgentPrints("The agent has no identities.\n").size).toBe(0);
  });
});

describe("keys on disk", () => {
  it("are too open when the group or others can read them", () => {
    expect(tooOpen(0o600)).toBe(false);
    expect(tooOpen(0o644)).toBe(true);
  });

  it("are the same whether written with ~ or in full", () => {
    expect(sameKey("~/.ssh/id_rsa", "/home/me/.ssh/id_rsa", "/home/me")).toBe(true);
    expect(sameKey("~/.ssh/id_rsa", "~/.ssh/id_rsa3", "/home/me")).toBe(false);
  });
});
