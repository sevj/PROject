import { describe, expect, it } from "vitest";
import { isMarkdown, resolveDocLink, stripFrontMatter } from "./docs";

const docs = ["README.md", "docs/guide.md", "docs/api.md"];

describe("isMarkdown", () => {
  it("recognizes Markdown only", () => {
    expect(isMarkdown("README.md")).toBe(true);
    expect(isMarkdown("docs/A.MARKDOWN")).toBe(true);
    expect(isMarkdown("notes.txt")).toBe(false);
    expect(isMarkdown("guide.rst")).toBe(false);
  });
});

describe("stripFrontMatter", () => {
  it("removes it at the very start only", () => {
    expect(stripFrontMatter("---\ntitle: a\n---\n# Title")).toBe("# Title");
    expect(stripFrontMatter("---\r\ntitle: a\r\n---\r\n# Title")).toBe("# Title");
    expect(stripFrontMatter("# Title\n\n---\n\ntext\n\n---\n")).toBe("# Title\n\n---\n\ntext\n\n---\n");
  });
});

describe("resolveDocLink", () => {
  it("keeps web links and anchors", () => {
    expect(resolveDocLink("https://a.test/x", "README.md", docs)).toEqual({ kind: "external", href: "https://a.test/x" });
    expect(resolveDocLink("mailto:a@a.test", "README.md", docs).kind).toBe("external");
    expect(resolveDocLink("#setup", "README.md", docs)).toEqual({ kind: "anchor", href: "#setup" });
  });

  it("follows a link to another document, relative to the current one", () => {
    expect(resolveDocLink("docs/guide.md", "README.md", docs)).toEqual({ kind: "document", file: "docs/guide.md", hash: "" });
    expect(resolveDocLink("./api.md#auth", "docs/guide.md", docs)).toEqual({ kind: "document", file: "docs/api.md", hash: "auth" });
    expect(resolveDocLink("../README.md", "docs/guide.md", docs)).toEqual({ kind: "document", file: "README.md", hash: "" });
  });

  it("refuses dangerous schemes, absolute paths and what is not a document", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "/etc/passwd", "src/main.ts", "../../secret.md", undefined]) {
      expect(resolveDocLink(href, "README.md", docs)).toEqual({ kind: "none" });
    }
  });
});
