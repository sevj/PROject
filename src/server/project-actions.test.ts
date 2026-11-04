import { describe, expect, it } from "vitest";
import { composeDirectories, launch, runCompose } from "./project-actions";

const container = (workingDir: string, state = "running") => ({
  name: workingDir,
  service: "s",
  state,
  status: "",
  ports: "",
  workingDir,
});

describe("composeDirectories", () => {
  it("starts from the project root when it has a compose file", () => {
    expect(composeDirectories("up", "/p/a", true, [container("/p/a/test")])).toEqual(["/p/a"]);
  });

  it("starts from the known subfolder otherwise", () => {
    expect(composeDirectories("up", "/p/a", false, [container("/p/a/backend", "exited")])).toEqual(["/p/a/backend"]);
  });

  it("stops only the folders with running containers, once each", () => {
    expect(
      composeDirectories("stop", "/p/a", true, [
        container("/p/a/x"),
        container("/p/a/x"),
        container("/p/a/y", "exited"),
      ]),
    ).toEqual(["/p/a/x"]);
  });

  it("has nothing to do without compose or containers", () => {
    expect(composeDirectories("up", "/p/a", false, [])).toEqual([]);
    expect(composeDirectories("stop", "/p/a", false, [container("/p/a", "exited")])).toEqual([]);
  });
});

describe("runCompose", () => {
  it("reports a project without compose file instead of running anything", async () => {
    expect(await runCompose("up", [])).toContain("No Docker Compose");
  });
});

describe("launch", () => {
  it("starts a program without waiting for it", async () => {
    expect(await launch("true {path}", "/tmp")).toBeNull();
  });

  it("reports a missing program and an empty command", async () => {
    expect(await launch("no-such-program-xyz {path}", "/tmp")).toContain("Could not start");
    expect(await launch("  ", "/tmp")).toContain("No command");
  });
});
