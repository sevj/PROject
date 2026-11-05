import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findFavicon, readFavicon } from "./project-favicon";

let base: string;
let project: string;

function put(relative: string, content: string | Buffer = "<svg/>") {
  const path = join(project, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "pm-favicon-"));
  project = join(base, "project");
  mkdirSync(project);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("findFavicon", () => {
  it("finds nothing in a project without an icon", () => {
    put("README.md", "# hello");
    expect(findFavicon(project)).toBeNull();
  });

  it("finds a Next.js icon", () => {
    put("src/app/favicon.ico", "ico");
    expect(findFavicon(project)).toMatchObject({ path: join(project, "src/app/favicon.ico"), type: "image/x-icon" });
  });

  it("prefers an SVG to an ICO, wherever it is", () => {
    put("favicon.ico", "ico");
    put("public/favicon.svg");
    expect(findFavicon(project)?.path).toBe(join(project, "public/favicon.svg"));
  });

  it("looks in a frontend subfolder when the root has none", () => {
    put("frontend/public/favicon.png", "png");
    expect(findFavicon(project)).toMatchObject({ path: join(project, "frontend/public/favicon.png"), type: "image/png" });
  });

  it("finds a Symfony icon among the images, whatever its suffix", () => {
    put("public/assets/images/favicon-client.png", "png");
    expect(findFavicon(project)?.path).toBe(join(project, "public/assets/images/favicon-client.png"));
  });

  it("prefers the root's icon to a subfolder's", () => {
    put("public/favicon.ico", "ico");
    put("frontend/public/favicon.svg");
    expect(findFavicon(project)?.path).toBe(join(project, "public/favicon.ico"));
  });

  it("skips empty files, oversized files and symlinks", () => {
    put("public/favicon.svg", "");
    put("public/icon.svg", Buffer.alloc(600 * 1024));
    writeFileSync(join(base, "outside.svg"), "<svg/>");
    symlinkSync(join(base, "outside.svg"), join(project, "favicon.svg"));
    expect(findFavicon(project)).toBeNull();
  });

  it("finds nothing in a missing folder", () => {
    expect(findFavicon(join(base, "gone"))).toBeNull();
  });
});

describe("readFavicon", () => {
  it("returns the icon's content and type", async () => {
    put("public/favicon.svg", "<svg>x</svg>");
    const favicon = await readFavicon(project);
    expect(favicon?.type).toBe("image/svg+xml");
    expect(favicon?.body.toString()).toBe("<svg>x</svg>");
  });
});
