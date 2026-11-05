import { describe, expect, it } from "vitest";
import { isHeaderName, maskHeader, placeholdersIn, prettyBody, statusTone, substitute, writes } from "./http-requests";

describe("substitute", () => {
  const variables = [
    { name: "baseUrl", value: "https://recette.example", secret: false },
    { name: "token", value: "s3cr3t", secret: true },
  ];

  it("replaces each {{name}}, masks the secrets in what is shown, and lists the missing ones", () => {
    expect(substitute("{{baseUrl}}/api?key={{ token }}&x={{other}}", variables)).toEqual({
      text: "https://recette.example/api?key=s3cr3t&x={{other}}",
      shown: "https://recette.example/api?key=••••&x={{other}}",
      missing: ["other"],
    });
  });

  it("finds the names a text uses", () => {
    expect(placeholdersIn("{{a}} {{ b }} {{a}} {{ not a name }}")).toEqual(["a", "b"]);
  });
});

describe("requests", () => {
  it("tells which methods write", () => {
    expect(writes("GET")).toBe(false);
    expect(writes("DELETE")).toBe(true);
  });

  it("checks header names and masks credentials", () => {
    expect(isHeaderName("X-Api-Key")).toBe(true);
    expect(isHeaderName("bad name")).toBe(false);
    expect(maskHeader(["Authorization", "Bearer x"])).toEqual(["Authorization", "••••"]);
    expect(maskHeader(["Accept", "application/json"])).toEqual(["Accept", "application/json"]);
  });

  it("indents JSON only", () => {
    expect(prettyBody('{"a":1}', "application/json")).toBe('{\n  "a": 1\n}');
    expect(prettyBody("<p>hi</p>", "text/html")).toBe("<p>hi</p>");
    expect(prettyBody("{broken", "application/json")).toBe("{broken");
  });

  it("gives each status a tone", () => {
    expect([200, 301, 404, 503, null].map(statusTone)).toEqual(["ok", "redirect", "client", "server", "error"]);
  });
});
