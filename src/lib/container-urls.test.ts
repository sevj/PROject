import { describe, expect, it } from "vitest";
import { containerUrls } from "./container-urls";

const rule = (router: string, value: string) => ({ [`traefik.http.routers.${router}.rule`]: value });

describe("containerUrls", () => {
  it("reads a Traefik address, and keeps https when two routers share it", () => {
    const labels = {
      ...rule("app", "Host(`app.dev.local`)"),
      "traefik.http.routers.app.entrypoints": "http",
      ...rule("app-secure", "Host(`app.dev.local`)"),
      "traefik.http.routers.app-secure.tls": "true",
    };
    expect(containerUrls(labels, [])).toEqual([{ url: "https://app.dev.local", label: "app.dev.local" }]);
  });

  it("knows https from the entrypoint, and http when nothing says otherwise", () => {
    expect(
      containerUrls(
        {
          ...rule("a", "Host(`a.local`)"),
          "traefik.http.routers.a.entrypoints": "web, websecure",
          ...rule("b", "Host(`b.local`)"),
        },
        [],
      ).map(({ url }) => url),
    ).toEqual(["https://a.local", "http://b.local"]);
  });

  it("reads several hosts and a path", () => {
    expect(containerUrls(rule("a", "Host(`a.local`, `b.local`) && PathPrefix(`/api`)"), []).map(({ label }) => label)).toEqual([
      "a.local/api",
      "b.local/api",
    ]);
    expect(containerUrls(rule("a", "Host(`a.local`) || Host(`b.local`)"), []).map(({ label }) => label)).toEqual(["a.local", "b.local"]);
    expect(containerUrls(rule("a", "Host(`a.local`) && PathPrefix(`/`)"), [])[0].label).toBe("a.local");
  });

  it("gives no link for a broken rule, or for something that is not an address", () => {
    expect(containerUrls(rule("a", "Host(`a.local)"), [])).toEqual([]);
    expect(containerUrls(rule("a", "Host(`javascript:alert(1)`)"), [])).toEqual([]);
    expect(containerUrls(rule("a", "HostRegexp(`.+`)"), [])).toEqual([]);
  });

  it("leaves a container Traefik must not route", () => {
    expect(containerUrls({ "traefik.enable": "false", ...rule("a", "Host(`a.local`)") }, [])).toEqual([]);
  });

  it("links the published web ports only", () => {
    const ports = [
      { host: "8080", container: "80/tcp" },
      { host: "127.0.0.1:8443", container: "443/tcp" },
      { host: "5438", container: "5432/tcp" },
      { host: "9000", container: "9000/tcp" },
      { host: null, container: "3000/tcp" },
      { host: "8000-8010", container: "8000/tcp" },
      { host: "5353", container: "80/udp" },
    ];
    expect(containerUrls({}, ports)).toEqual([
      { url: "http://127.0.0.1:8080", label: "127.0.0.1:8080" },
      { url: "https://127.0.0.1:8443", label: "127.0.0.1:8443" },
    ]);
  });

  it("prefers the Traefik address to a published port", () => {
    expect(containerUrls(rule("a", "Host(`a.local`)"), [{ host: "8080", container: "80/tcp" }])).toHaveLength(1);
  });
});
