import { describe, expect, it } from "vitest";
import { assignContainers, parseDockerPs } from "./docker";

const base = { name: "n", service: "s", state: "running", status: "Up", ports: "" };

describe("parseDockerPs", () => {
  it("reads tab-separated columns, including empty labels", () => {
    expect(parseDockerPs("web\tserver\trunning\tUp 2 days\t80/tcp\t/p/app\nlone\t\texited\tExited (0)\t\t\n")).toEqual([
      { name: "web", service: "server", state: "running", status: "Up 2 days", ports: "80/tcp", workingDir: "/p/app" },
      { name: "lone", service: "", state: "exited", status: "Exited (0)", ports: "", workingDir: "" },
    ]);
  });
});

describe("assignContainers", () => {
  it("matches the deepest project and ignores look-alike paths", () => {
    const assigned = assignContainers(
      ["/p/app", "/p/app-two", "/p/group/core"],
      [
        { ...base, name: "a", workingDir: "/p/app" },
        { ...base, name: "b", workingDir: "/p/app/deploy" },
        { ...base, name: "c", workingDir: "/p/app-two" },
        { ...base, name: "d", workingDir: "/p/group/core/docker" },
        { ...base, name: "e", workingDir: "/elsewhere" },
        { ...base, name: "f", workingDir: "" },
      ],
    );
    expect(assigned.get("/p/app")?.map((c) => c.name)).toEqual(["a", "b"]);
    expect(assigned.get("/p/app-two")?.map((c) => c.name)).toEqual(["c"]);
    expect(assigned.get("/p/group/core")?.map((c) => c.name)).toEqual(["d"]);
    expect(assigned.size).toBe(3);
  });
});
