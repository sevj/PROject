import { describe, expect, it, vi } from "vitest";
import { composeSteps, currentComposeJob, dismissComposeJob, startComposeJob } from "./compose-jobs";

const finished = async (projectId: number) => {
  for (let attempt = 0; attempt < 100 && currentComposeJob(projectId)?.running; attempt += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  return currentComposeJob(projectId);
};

describe("composeSteps", () => {
  it("ends on the new images running, and never takes anything down", () => {
    expect(composeSteps("build")).toEqual([["compose", "--progress", "plain", "up", "-d", "--build"]]);
    expect(composeSteps("pull").map((step) => step.slice(3))).toEqual([["pull", "--ignore-buildable"], ["up", "-d"]]);
    expect(composeSteps("build").concat(composeSteps("pull")).flat()).not.toContain("down");
  });
});

describe("startComposeJob", () => {
  it("runs each step in each folder and keeps the output, without its colors", async () => {
    const calls: string[] = [];
    const onFinished = vi.fn(async () => undefined);
    startComposeJob(1, "pull", ["/a", "/b"], onFinished, async (args, cwd, onOutput) => {
      calls.push(`${cwd} ${args[3]}`);
      onOutput("\x1b[32mline one\x1b[0m\nline");
      onOutput(" two\n");
      return 0;
    });
    const job = await finished(1);
    expect(calls).toEqual(["/a pull", "/a up", "/b pull", "/b up"]);
    expect(job).toMatchObject({ action: "pull", running: false, error: null });
    expect(job?.output.slice(0, 2)).toEqual(["line one", "line two"]);
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("stops at the first step that fails, and says the last thing Compose said", async () => {
    const run = vi.fn(async (_args: string[], _cwd: string, onOutput: (text: string) => void) => {
      onOutput("no such image\n");
      return 1;
    });
    startComposeJob(2, "pull", ["/a"], undefined, run);
    expect(await finished(2)).toMatchObject({ running: false, error: "no such image" });
    expect(run).toHaveBeenCalledOnce();
    dismissComposeJob(2);
    expect(currentComposeJob(2)).toBeNull();
  });

  it("keeps only the last lines", async () => {
    startComposeJob(3, "build", ["/a"], undefined, async (_args, _cwd, onOutput) => {
      onOutput(`${Array.from({ length: 500 }, (_, index) => `line ${index}`).join("\n")}\n`);
      return 0;
    });
    const job = await finished(3);
    expect(job?.output).toHaveLength(200);
    expect(job?.output.at(-1)).toBe("line 499");
  });

  it("reports a program that cannot start", async () => {
    startComposeJob(4, "build", ["/a"], undefined, async () => {
      throw new Error("docker not found");
    });
    expect((await finished(4))?.error).toBe("docker not found");
  });

  it("refuses a second job on a project, and leaves a running one on screen", async () => {
    let release: (code: number) => void = () => undefined;
    startComposeJob(5, "build", ["/a"], undefined, () => new Promise((resolve) => (release = resolve)));
    expect(startComposeJob(5, "pull", ["/a"])).toBe(false);
    dismissComposeJob(5);
    expect(currentComposeJob(5)?.running).toBe(true);
    release(0);
    expect((await finished(5))?.action).toBe("build");
  });
});
