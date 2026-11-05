import { describe, expect, it, vi } from "vitest";
import { currentBulkJob, startBulkJob } from "./bulk-jobs";

const finished = async () => {
  for (let attempt = 0; attempt < 100 && currentBulkJob()?.running; attempt += 1) await new Promise((r) => setTimeout(r, 5));
  return currentBulkJob();
};

describe("startBulkJob", () => {
  it("runs every item and keeps what failed, a thrown error included", async () => {
    const onFinished = vi.fn(async () => undefined);
    const started = startBulkJob(
      "fetch",
      [{ name: "a" }, { name: "b" }, { name: "c" }],
      2,
      async ({ name }) => {
        if (name === "b") return "refused";
        if (name === "c") throw new Error("broken");
        return null;
      },
      onFinished,
    );
    expect(started).toBe(true);
    expect(await finished()).toMatchObject({
      kind: "fetch",
      total: 3,
      done: 3,
      running: false,
      failures: [
        { name: "b", message: "refused" },
        { name: "c", message: "broken" },
      ],
    });
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("refuses a second one while the first runs, and gives each its own id", async () => {
    let release = () => {};
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const before = currentBulkJob()?.id ?? 0;
    expect(
      startBulkJob("analyze", [{ name: "a" }], 1, async () => {
        await blocked;
        return null;
      }),
    ).toBe(true);
    expect(currentBulkJob()).toMatchObject({ id: before + 1, running: true, done: 0 });
    expect(startBulkJob("fetch", [{ name: "b" }], 1, async () => null)).toBe(false);
    release();
    expect((await finished())?.kind).toBe("analyze");
  });
});
