import { describe, expect, it } from "vitest";
import { buildPortRows, parseDeclaredPort, parseListeners, parsePsPorts, type PortEntry } from "./ports";

describe("parsePsPorts", () => {
  it("keeps published ports once, with ranges and addresses", () => {
    expect(parsePsPorts("0.0.0.0:5450->5432/tcp, [::]:5450->5432/tcp, 80/tcp, 127.0.0.1:8000-8001->80-81/tcp, 443/udp")).toEqual([
      { port: 5450, protocol: "tcp", address: null },
      { port: 8000, protocol: "tcp", address: "127.0.0.1" },
      { port: 8001, protocol: "tcp", address: "127.0.0.1" },
    ]);
  });
});

describe("parseDeclaredPort", () => {
  it("reads the published side only", () => {
    expect(parseDeclaredPort("5438:5432")).toEqual([{ port: 5438, protocol: "tcp", address: null }]);
    expect(parseDeclaredPort("127.0.0.1:8080:80/udp")).toEqual([{ port: 8080, protocol: "udp", address: "127.0.0.1" }]);
    expect(parseDeclaredPort("9000")).toEqual([]);
    expect(parseDeclaredPort("${PORT}:80")).toEqual([]);
    expect(parseDeclaredPort("8000-8001:80")).toHaveLength(2);
  });
});

describe("parseListeners", () => {
  it("reads address, port and process", () => {
    const out = [
      'LISTEN 0 1024 127.0.0.1:4300 0.0.0.0:* users:(("next-server (v1",pid=1,fd=22))',
      "LISTEN 0 4096 [::]:5450 [::]:*",
      "LISTEN 0 4096 127.0.0.54:53 0.0.0.0:*",
      "ESTAB 0 0 1.1.1.1:22 2.2.2.2:5",
    ].join("\n");
    expect(parseListeners(out)).toEqual([
      { port: 4300, address: "127.0.0.1", process: "next-server (v1" },
      { port: 5450, address: null, process: null },
      { port: 53, address: "127.0.0.54", process: null },
    ]);
  });
});

const entry = (over: Partial<PortEntry>): PortEntry => ({
  port: 8081,
  protocol: "tcp",
  kind: "declared",
  owner: "p:1:web",
  label: "web",
  projectId: 1,
  projectName: "A",
  address: null,
  ...over,
});

describe("buildPortRows", () => {
  it("flags a declared port that something else already holds, first", () => {
    const rows = buildPortRows([
      entry({ port: 3000 }),
      entry({ port: 8081, kind: "docker", owner: "p:2:web", label: "b-web", projectId: 2, projectName: "B" }),
      entry({ port: 8081 }),
    ]);
    expect(rows.map(({ port, status }) => [port, status])).toEqual([[8081, "taken"], [3000, "ok"]]);
  });

  it("merges a declared port with the container that publishes it", () => {
    const rows = buildPortRows([entry({ kind: "docker" }), entry({ kind: "declared" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].entries).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
  });

  it("calls two stopped projects that declare the same port an overlap", () => {
    const rows = buildPortRows([entry({}), entry({ owner: "p:2:web", projectId: 2, projectName: "B" })]);
    expect(rows[0].status).toBe("overlap");
  });

  it("ignores the proxy that Docker leaves listening on a published port", () => {
    const rows = buildPortRows([
      entry({ kind: "docker" }),
      entry({ kind: "host", owner: "host:docker-proxy", label: "docker-proxy", projectId: null, projectName: null }),
    ]);
    expect(rows[0].status).toBe("ok");
  });

  it("flags a program of the machine that holds a port a project declares", () => {
    const rows = buildPortRows([
      entry({ kind: "host", owner: "host:node", label: "node", projectId: null, projectName: null }),
      entry({}),
    ]);
    expect(rows[0].status).toBe("taken");
  });
});
