import { describe, expect, it } from "vitest";
import {
  type DependencyAnalysis,
  isMajorUpdate,
  parseComposerAudit,
  parseComposerOutdated,
  parseNodeOutdated,
  parseNpmAudit,
  parsePnpmAudit,
  parseYarnAudit,
  parseYarnOutdated,
  summarize,
} from "./dependencies";

describe("isMajorUpdate", () => {
  it("compares the first number", () => {
    expect(isMajorUpdate("1.9.0", "2.0.0")).toBe(true);
    expect(isMajorUpdate("v1.2.0", "1.3.0")).toBe(false);
    expect(isMajorUpdate(null, "2.0.0")).toBe(false);
  });
});

describe("parseNodeOutdated", () => {
  it("reads npm and pnpm output and flags dev packages and major updates", () => {
    const out = JSON.stringify({
      zod: { current: "3.0.0", wanted: "3.9.0", latest: "4.0.0" },
      vitest: { current: "1.0.0", wanted: "1.0.0", latest: "1.0.0" },
      eslint: { current: "8.0.0", wanted: "8.5.0", latest: "8.5.0", dependencyType: "devDependencies" },
    });
    expect(parseNodeOutdated(out)).toEqual([
      { name: "eslint", current: "8.0.0", wanted: "8.5.0", latest: "8.5.0", dev: true, major: false },
      { name: "zod", current: "3.0.0", wanted: "3.9.0", latest: "4.0.0", dev: false, major: true },
    ]);
    expect(parseNodeOutdated("not json")).toEqual([]);
    expect(parseNodeOutdated(JSON.stringify({ a: { current: "1.0.0", latest: "1.1.0" } }), new Set(["a"]))[0].dev).toBe(true);
  });
});

describe("parseYarnOutdated", () => {
  it("reads the table line", () => {
    const out = [
      '{"type":"info","data":"Color legend"}',
      JSON.stringify({ type: "table", data: { head: [], body: [["left-pad", "1.0.0", "1.1.0", "2.0.0", "dependencies", "https://x"]] } }),
    ].join("\n");
    expect(parseYarnOutdated(out)).toEqual([
      { name: "left-pad", current: "1.0.0", wanted: "1.1.0", latest: "2.0.0", dev: false, major: true },
    ]);
  });
});

describe("audits", () => {
  it("npm: one advisory per vulnerable package, worst first, links only http(s)", () => {
    const out = JSON.stringify({
      vulnerabilities: {
        lodash: { severity: "high", range: "<4.17.21", via: [{ title: "Prototype pollution", url: "https://github.com/advisories/x" }] },
        minimist: { severity: "critical", range: "*", via: [{ title: "Bad", url: "javascript:alert(1)" }] },
        wrapper: { severity: "moderate", range: "*", via: ["lodash"] },
      },
    });
    expect(parseNpmAudit(out)).toEqual([
      { package: "minimist", severity: "critical", title: "Bad", url: null, range: "*" },
      { package: "lodash", severity: "high", title: "Prototype pollution", url: "https://github.com/advisories/x", range: "<4.17.21" },
      { package: "wrapper", severity: "moderate", title: "via lodash", url: null, range: "*" },
    ]);
  });

  it("pnpm and yarn read their advisories", () => {
    const advisory = { module_name: "qs", severity: "low", title: "DoS", url: "https://a.b", vulnerable_versions: "<6.0.0" };
    const expected = [{ package: "qs", severity: "low", title: "DoS", url: "https://a.b", range: "<6.0.0" }];
    expect(parsePnpmAudit(JSON.stringify({ advisories: { 1: advisory } }))).toEqual(expected);
    expect(parseYarnAudit(JSON.stringify({ type: "auditAdvisory", data: { advisory } }))).toEqual(expected);
  });

  it("composer: advisories by package, ungraded ones are information", () => {
    const out = JSON.stringify({
      advisories: { "symfony/http-kernel": [{ title: "CVE thing", link: "https://symfony.com/cve", affectedVersions: ">=5,<5.4", severity: "high" }, { cve: "CVE-1", title: "" }] },
    });
    const result = parseComposerAudit(out);
    expect(result.map(({ severity }) => severity)).toEqual(["high", "info"]);
    expect(result[1].title).toBe("CVE-1");
  });
});

describe("notices before the JSON", () => {
  it("are skipped", () => {
    const out = `Deprecation Notice: something\n${JSON.stringify({ installed: [{ name: "a/a", version: "1.0.0", latest: "2.0.0" }] })}`;
    expect(parseComposerOutdated(out)).toHaveLength(1);
  });
});

describe("parseComposerOutdated", () => {
  it("drops what is up to date", () => {
    const out = JSON.stringify({
      installed: [
        { name: "a/a", version: "1.0.0", latest: "2.0.0", "latest-status": "update-possible" },
        { name: "b/b", version: "1.0.0", latest: "1.0.0", "latest-status": "up-to-date" },
      ],
    });
    expect(parseComposerOutdated(out).map(({ name, major }) => [name, major])).toEqual([["a/a", true]]);
  });
});

describe("summarize", () => {
  it("counts by severity and names the worst", () => {
    const analysis: DependencyAnalysis = {
      results: [
        {
          ecosystem: "npm",
          folder: ".",
          runner: "host",
          outdated: [{ name: "a", current: "1.0.0", wanted: null, latest: "2.0.0", dev: false, major: true }],
          advisories: [
            { package: "x", severity: "high", title: "", url: null, range: null },
            { package: "y", severity: "low", title: "", url: null, range: null },
          ],
          outdatedError: null,
          auditError: null,
        },
      ],
    };
    const summary = summarize(analysis);
    expect(summary).toMatchObject({ outdated: 1, major: 1, vulnerabilities: 2, worst: "high" });
    expect(summarize({ results: [] }).worst).toBeNull();
  });
});
