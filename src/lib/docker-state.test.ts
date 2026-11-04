import { describe, expect, it } from "vitest";
import { classify, classifyStatus, countStates } from "./docker-state";

describe("classify", () => {
  it.each([
    [{ state: "running" }, "running"],
    [{ state: "running", health: "healthy" }, "running"],
    [{ state: "running", health: "unhealthy" }, "unhealthy"],
    [{ state: "running", health: "starting" }, "starting"],
    [{ state: "restarting" }, "restarting"],
    [{ state: "paused" }, "paused"],
    [{ state: "created" }, "created"],
    [{ state: "dead" }, "failed"],
    [{ state: "exited", exitCode: 0 }, "stopped"],
    [{ state: "exited", exitCode: 1 }, "failed"],
    [{ state: "exited", exitCode: 139 }, "failed"],
    [{ state: "exited" }, "stopped"],
    [{ state: "removing" }, "stopped"],
  ] as const)("reads %j as %s", (input, expected) => {
    expect(classify(input)).toBe(expected);
  });

  it("does not take a container stopped on request for a crash, but a memory kill is one", () => {
    for (const exitCode of [130, 137, 143]) expect(classify({ state: "exited", exitCode })).toBe("stopped");
    expect(classify({ state: "exited", exitCode: 137, outOfMemory: true })).toBe("failed");
  });
});

describe("classifyStatus", () => {
  it("reads the health and the exit code from the status words", () => {
    expect(classifyStatus("running", "Up 2 weeks (healthy)")).toBe("running");
    expect(classifyStatus("running", "Up 2 minutes (unhealthy)")).toBe("unhealthy");
    expect(classifyStatus("running", "Up 5 seconds (health: starting)")).toBe("starting");
    expect(classifyStatus("exited", "Exited (1) 3 days ago")).toBe("failed");
    expect(classifyStatus("exited", "Exited (0) 3 days ago")).toBe("stopped");
    expect(classifyStatus("exited", "")).toBe("stopped");
  });
});

describe("countStates", () => {
  it("counts only what exists, with what needs attention first", () => {
    expect(countStates(["stopped", "running", "running", "unhealthy"])).toEqual([
      { kind: "unhealthy", count: 1 },
      { kind: "running", count: 2 },
      { kind: "stopped", count: 1 },
    ]);
    expect(countStates([])).toEqual([]);
  });
});
