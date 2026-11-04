import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db/client";
import { claudeTranscripts } from "../db/schema";
import { readSessionTitles } from "./session-titles";

let dir: string;
let db: Db;

const title = (aiTitle: unknown) => `${JSON.stringify({ type: "ai-title", aiTitle, sessionId: "s" })}\n`;

const transcript = (relative: string, content: string) => {
  const path = join(dir, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  db.insert(claudeTranscripts).values({ path, offset: 0 }).run();
  return path;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-titles-"));
  db = openDb(":memory:");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readSessionTitles", () => {
  it("takes the last title of the transcript of the session", async () => {
    transcript("p/one.jsonl", `${title("First")}{"type":"user"}\n${title("Latest")}`);
    expect(await readSessionTitles(db, ["one"])).toEqual({ one: "Latest" });
  });

  it("reads only the sessions asked for", async () => {
    transcript("p/one.jsonl", title("One"));
    transcript("p/two.jsonl", title("Two"));
    expect(await readSessionTitles(db, ["two"])).toEqual({ two: "Two" });
  });

  it("does not take the title of a subagent for that of the session", async () => {
    transcript("p/one/subagents/agent-1.jsonl", title("Agent"));
    expect(await readSessionTitles(db, ["one"])).toEqual({});
  });

  it("is not fooled by a conversation that talks about titles", async () => {
    transcript("p/one.jsonl", `${title("Real")}${JSON.stringify({ type: "user", text: '"ai-title"' })}\n`);
    expect(await readSessionTitles(db, ["one"])).toEqual({ one: "Real" });
  });

  it("sees a new title when the transcript has changed", async () => {
    const path = transcript("p/one.jsonl", title("Before"));
    expect(await readSessionTitles(db, ["one"])).toEqual({ one: "Before" });
    appendFileSync(path, title("After"));
    expect(await readSessionTitles(db, ["one"])).toEqual({ one: "After" });
  });

  it("leaves out what has no usable title", async () => {
    transcript("p/empty.jsonl", '{"type":"user"}\n');
    transcript("p/blank.jsonl", title("   "));
    transcript("p/odd.jsonl", title(12));
    expect(await readSessionTitles(db, ["empty", "blank", "odd"])).toEqual({});
  });

  it("gets through a transcript that was purged", async () => {
    const path = transcript("p/one.jsonl", title("Gone"));
    rmSync(path);
    expect(await readSessionTitles(db, ["one"])).toEqual({});
  });

  it("keeps a title to a sensible length", async () => {
    transcript("p/one.jsonl", title("x".repeat(500)));
    expect((await readSessionTitles(db, ["one"])).one).toHaveLength(120);
  });
});
