import { describe, expect, it } from "vitest";
import { parseRemote, publishedPorts } from "./remote";

describe("parseRemote", () => {
  it.each([
    ["git@github.com:sevj/gproject.git", "sevj/gproject", "https://github.com/sevj/gproject"],
    ["git@gitlab.adimeo.tech:group/sub/app.git", "group/sub/app", "https://gitlab.adimeo.tech/group/sub/app"],
    ["https://github.com/sevj/a.git", "sevj/a", "https://github.com/sevj/a"],
    ["http://intranet.test/a/b/", "a/b", "http://intranet.test/a/b"],
    ["ssh://git@host.test:2222/a/b.git", "a/b", "https://host.test/a/b"],
    ["/srv/git/app.git", "/srv/git/app.git", null],
    ["file:///srv/git/app.git", "file:///srv/git/app.git", null],
  ])("reads %s", (remote, label, url) => {
    expect(parseRemote(remote)).toEqual({ label, url });
  });
});

describe("publishedPorts", () => {
  it("keeps the ports published on the machine, once each", () => {
    expect(publishedPorts("0.0.0.0:5438->5432/tcp, [::]:5438->5432/tcp, 80/tcp")).toEqual(["5438"]);
    expect(publishedPorts("127.0.0.1:8000-8002->8000-8002/tcp, 0.0.0.0:443->443/udp")).toEqual(["8000-8002", "443"]);
    expect(publishedPorts("80/tcp, 443/tcp")).toEqual([]);
    expect(publishedPorts("")).toEqual([]);
  });
});
