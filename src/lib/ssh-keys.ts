/** What `ssh-keygen -lf` says of a key: "256 SHA256:… comment (ED25519)". */
export type KeyPrint = { bits: number; fingerprint: string; comment: string; type: string };

export function parseKeyPrint(output: string): KeyPrint | null {
  const match = /^(\d+)\s+(\S+)\s+(.*?)\s*\(([A-Z0-9-]+)\)\s*$/.exec(output.trim().split("\n")[0] ?? "");
  if (!match) return null;
  const [, bits, fingerprint, comment, type] = match;
  return { bits: Number(bits), fingerprint, comment: comment === "no comment" ? "" : comment, type };
}

/** The fingerprints the agent holds, from `ssh-add -l`; none when it has none or does not answer. */
export function parseAgentPrints(output: string): Set<string> {
  return new Set(output.split("\n").flatMap((line) => parseKeyPrint(line)?.fingerprint ?? []));
}

/** ssh refuses a private key that others than its owner can read. */
export const tooOpen = (mode: number) => (mode & 0o077) !== 0;

/** `~/.ssh/x` and `/home/me/.ssh/x` are the same key. */
export const sameKey = (a: string, b: string, home: string) => {
  const full = (path: string) => (path.startsWith("~/") ? `${home}${path.slice(1)}` : path);
  return full(a) === full(b);
};
