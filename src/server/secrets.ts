import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const VERSION = "v1";
const KEY_BYTES = 32;

/**
 * Outside the data folder, so that a copy of that folder or of the database reveals nothing.
 * A program running under the same account can still read it: this is not a vault.
 */
export function defaultKeyPath(): string {
  if (process.env.PM_SECRET_KEY_PATH) return process.env.PM_SECRET_KEY_PATH;
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "project-manager", "secret.key");
}

function readKey(path: string): Buffer {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      // `wx`: two requests at once must not each make a key, and lose what the first one encrypted.
      writeFileSync(path, randomBytes(KEY_BYTES).toString("base64"), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  chmodSync(path, 0o600);
  const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  if (key.length !== KEY_BYTES) throw new Error(`${path} does not hold a key`);
  return key;
}

export function encryptSecret(plain: string, keyPath = defaultKeyPath()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", readKey(keyPath), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** Null when it cannot be read, such as after losing the key: it can only be typed again. */
export function decryptSecret(stored: string, keyPath = defaultKeyPath()): string | null {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", readKey(keyPath), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
