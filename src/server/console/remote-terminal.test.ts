import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keptPasswordNote, openPasswordPipe, openRemoteTerminal } from "./remote-terminal";
import type { Terminal } from "./terminal";

const NOTES = { refused: "refused note", unknownHostKey: "host key note" };

let bin: string;
let path: string | undefined;

/** Fakes on the PATH, so that this runs without a server: `sshpass` reads as the real one does, when it is prompted. */
beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), "pm-remote-bin-"));
  writeFileSync(join(bin, "sshpass"), `#!/bin/sh\nread -r got < "$2"\necho "file=$2 password=$got rest=$3 $4"\nexit "\${FAKE_EXIT:-0}"\n`);
  writeFileSync(join(bin, "ssh"), `#!/bin/sh\necho "ssh $*"\nexit 0\n`);
  chmodSync(join(bin, "sshpass"), 0o755);
  chmodSync(join(bin, "ssh"), 0o755);
  path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
});
afterAll(() => {
  process.env.PATH = path;
  rmSync(bin, { recursive: true, force: true });
});

function collect(terminal: Terminal) {
  let output = "";
  terminal.onData((data) => { output += data.toString(); });
  return new Promise<{ output: string; code: number | null }>((resolve) => {
    terminal.onExit((code) => setTimeout(() => resolve({ output, code }), 50));
  });
}

describe("openPasswordPipe", () => {
  it("holds the password in a private pipe, not in a file, and goes away", () => {
    const pipe = openPasswordPipe("hunter2");
    const stat = statSync(pipe.path);
    expect(stat.isFIFO()).toBe(true);
    expect(stat.size).toBe(0);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(statSync(dirname(pipe.path)).mode & 0o077).toBe(0);
    pipe.close();
  });

  it("leaves nothing once closed", () => {
    const pipe = openPasswordPipe("x");
    pipe.close();
    expect(existsSync(dirname(pipe.path))).toBe(false);
    pipe.close();
  });
});

describe("keptPasswordNote", () => {
  it("recognizes a refusal by sshpass or by ssh, and nothing else", () => {
    expect(keptPasswordNote(5, "", NOTES)).toBe("refused note");
    expect(keptPasswordNote(255, "x@y: Permission denied (password).\r\n", NOTES)).toBe("refused note");
    expect(keptPasswordNote(6, "", NOTES)).toBe("host key note");
    expect(keptPasswordNote(255, "Connection refused", NOTES)).toBeNull();
    expect(keptPasswordNote(0, "Permission denied", NOTES)).toBeNull();
    expect(keptPasswordNote(1, "rm: Permission denied", NOTES)).toBeNull();
  });
});

describe("openRemoteTerminal", () => {
  it("runs the program itself when there is no password", async () => {
    const { output, code } = await collect(await openRemoteTerminal({ program: "ssh", args: ["-tt", "srv"] }, NOTES));
    expect(output).toContain("ssh -tt srv");
    expect(code).toBe(0);
  });

  it("gives a kept password through the pipe, off the command line", async () => {
    const { output } = await collect(await openRemoteTerminal({ program: "ssh", args: ["srv"], password: "hunter2" }, NOTES));
    expect(output).toContain("password=hunter2 rest=ssh srv");
    const file = /file=(\S+)/.exec(output)?.[1] ?? "";
    expect(file).not.toContain("hunter2");
    expect(existsSync(file)).toBe(false);
  });

  it("says why sshpass stopped, which it does not say itself", async () => {
    process.env.FAKE_EXIT = "5";
    try {
      const { output, code } = await collect(await openRemoteTerminal({ program: "ssh", args: ["srv"], password: "x" }, NOTES));
      expect(output).toContain("refused note");
      expect(code).toBe(5);
    } finally {
      delete process.env.FAKE_EXIT;
    }
  });

  it("gives no such note for the program's own exit code", async () => {
    writeFileSync(join(bin, "ssh"), `#!/bin/sh\nexit 5\n`);
    const { output } = await collect(await openRemoteTerminal({ program: "ssh", args: [] }, NOTES));
    expect(output).not.toContain("refused note");
    writeFileSync(join(bin, "ssh"), `#!/bin/sh\necho "ssh $*"\nexit 0\n`);
  });
});
