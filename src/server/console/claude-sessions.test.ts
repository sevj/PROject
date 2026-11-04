import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { endConsole, isSessionOpen, sessionsOfConsole, trackConsole } from "./claude-sessions";

const hookSays = (file: string, id: string) => appendFileSync(file, `${JSON.stringify({ session_id: id, source: "x" })}\n`);

describe("claude sessions", () => {
  it("knows a console by the session it started on", () => {
    const id = randomUUID();
    const tracked = trackConsole(id);
    expect(isSessionOpen(id)).toBe(true);
    expect(sessionsOfConsole(id)).toEqual([id]);
    endConsole(tracked);
  });

  it("follows a /clear, from the old id as from the new one", () => {
    const first = randomUUID();
    const second = randomUUID();
    const tracked = trackConsole(first);
    hookSays(tracked.file, first);
    hookSays(tracked.file, second);
    expect(sessionsOfConsole(first)).toEqual([first, second]);
    expect(sessionsOfConsole(second)).toEqual([first, second]);
    // The program is on the new one, so the old one can be resumed elsewhere.
    expect(isSessionOpen(second)).toBe(true);
    expect(isSessionOpen(first)).toBe(false);
    endConsole(tracked);
  });

  it("does not mix two consoles up", () => {
    const a = randomUUID();
    const b = randomUUID();
    const one = trackConsole(a);
    const two = trackConsole(b);
    expect(sessionsOfConsole(a)).toEqual([a]);
    expect(sessionsOfConsole(b)).toEqual([b]);
    endConsole(one);
    endConsole(two);
  });

  it("frees a session when its program ends, and removes the hook's file", () => {
    const id = randomUUID();
    const tracked = trackConsole(id);
    const { file } = tracked;
    hookSays(file, id);
    endConsole(tracked);
    expect(isSessionOpen(id)).toBe(false);
    expect(existsSync(dirname(file))).toBe(false);
  });

  it("remembers what it knew when the same console resumes", () => {
    const first = randomUUID();
    const second = randomUUID();
    const tracked = trackConsole(first);
    hookSays(tracked.file, second);
    endConsole(tracked);

    const resumed = trackConsole(second);
    expect(resumed).toBe(tracked);
    hookSays(resumed.file, second);
    expect(sessionsOfConsole(second)).toEqual([first, second]);
    expect(isSessionOpen(second)).toBe(true);
    endConsole(resumed);
  });

  it("ignores what is not a session id, and a line being written", () => {
    const id = randomUUID();
    const tracked = trackConsole(id);
    appendFileSync(tracked.file, '{"session_id":"--help"}\n{"session_id":12}\n{"sess');
    expect(sessionsOfConsole(id)).toEqual([id]);
    endConsole(tracked);
  });

  it("answers for a session it never saw", () => {
    const id = randomUUID();
    expect(sessionsOfConsole(id)).toEqual([id]);
    expect(isSessionOpen(id)).toBe(false);
  });
});
