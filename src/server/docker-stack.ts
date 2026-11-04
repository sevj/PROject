import { readdir } from "node:fs/promises";
import { join, normalize } from "node:path";
import { parse } from "yaml";
import { readProjectDoc } from "./project-files";
import { COMPOSE_FILE } from "./scan/detect";

export type DockerImage = { name: string; version: string };

export type DockerComponent = {
  service: string;
  images: DockerImage[];
  /** The Dockerfile that builds it, when it is not a ready-made image. */
  builtFrom: string | null;
  sources: string[];
  ports: string[];
};

export type DockerStack = { components: DockerComponent[]; invalidFiles: string[] };

const OVERRIDE_FILE = /^(docker-)?compose\.override\.ya?ml$/;
const BASE_FILE = /^(docker-)?compose\.ya?ml$/;

/** A digest is shortened, and a port in a registry address is not a version. */
export function parseImage(reference: string): DockerImage {
  const [withoutDigest, digest] = reference.trim().split("@");
  const colon = withoutDigest.lastIndexOf(":");
  const hasTag = colon > withoutDigest.lastIndexOf("/");
  const name = hasTag ? withoutDigest.slice(0, colon) : withoutDigest;
  if (hasTag) return { name, version: withoutDigest.slice(colon + 1) };
  return { name, version: digest ? digest.slice(0, 19) : "latest" };
}

/** Only the defaults written in the file: `.env` files are not opened for this. */
function applyDefaults(value: string): string {
  return value.replace(/\$\{\w+:?-([^}]*)\}/g, "$1");
}

export function parseDockerfile(content: string): DockerImage[] {
  const args = new Map<string, string>();
  const stages = new Set<string>();
  const images: DockerImage[] = [];
  const substitute = (value: string) =>
    applyDefaults(value).replace(/\$\{(\w+)\}|\$(\w+)/g, (raw, braced, bare) => args.get(braced ?? bare) ?? raw);

  for (const line of content.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    const arg = /^\s*ARG\s+(\w+)=(\S+)/i.exec(line);
    if (arg) args.set(arg[1], arg[2].replace(/^["']|["']$/g, ""));
    const from = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (!from) continue;
    const reference = substitute(from[1]);
    // A stage built on an earlier stage adds no image of its own.
    if (reference !== "scratch" && !stages.has(reference.toLowerCase())) {
      const image = parseImage(reference);
      if (!images.some((item) => item.name === image.name && item.version === image.version)) images.push(image);
    }
    if (from[2]) stages.add(from[2].toLowerCase());
  }
  return images;
}

function parsePort(port: unknown): string | null {
  if (typeof port === "string" || typeof port === "number") {
    // The address it listens on says nothing about which port it is.
    return applyDefaults(String(port)).replace(/^\[?[\d.:a-f]*\]?:(?=\d+:)/i, "").replace(/^\d+\.\d+\.\d+\.\d+:/, "");
  }
  const { published, target } = (port ?? {}) as { published?: unknown; target?: unknown };
  if (target === undefined) return null;
  return published === undefined ? String(target) : `${applyDefaults(String(published))}:${target}`;
}

type ComposeService = { image?: unknown; build?: unknown; ports?: unknown };

async function readBuild(projectPath: string, build: unknown) {
  const { context = ".", dockerfile = "Dockerfile" } =
    typeof build === "string" ? { context: build } : ((build ?? {}) as { context?: unknown; dockerfile?: unknown });
  if (typeof context !== "string" || typeof dockerfile !== "string") return null;
  const file = normalize(join(applyDefaults(context), applyDefaults(dockerfile)));
  // Refuses anything outside the project, as any other document.
  const content = await readProjectDoc(projectPath, file);
  return { file, images: content === null ? [] : parseDockerfile(content) };
}

async function toComponent(projectPath: string, service: string, definition: ComposeService, source: string) {
  const build = definition.build === undefined ? null : await readBuild(projectPath, definition.build);
  const declared = typeof definition.image === "string" ? [parseImage(applyDefaults(definition.image))] : [];
  return {
    service,
    images: build && build.images.length > 0 ? build.images : declared,
    builtFrom: build?.file ?? null,
    sources: [source],
    ports: Array.isArray(definition.ports) ? definition.ports.flatMap((port) => parsePort(port) ?? []) : [],
  };
}

/**
 * What a project declares, read when asked and never stored. An override file completes
 * the base file, as Compose does by default. Other variants, such as `compose.prod.yml`,
 * are alternatives: they only add the services the others do not have.
 */
export async function readDockerStack(projectPath: string): Promise<DockerStack> {
  const files = await readdir(projectPath).catch(() => [] as string[]);
  const rank = (file: string) => (BASE_FILE.test(file) ? 0 : OVERRIDE_FILE.test(file) ? 1 : 2);
  const composeFiles = files.filter((file) => COMPOSE_FILE.test(file)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const components = new Map<string, DockerComponent>();
  const invalidFiles: string[] = [];
  for (const file of composeFiles) {
    let services: Record<string, ComposeService> | undefined;
    try {
      const content = await readProjectDoc(projectPath, file);
      if (content === null) throw new Error("unreadable");
      services = parse(content)?.services;
    } catch {
      invalidFiles.push(file);
      continue;
    }
    for (const [service, definition] of Object.entries(services ?? {})) {
      const next = await toComponent(projectPath, service, definition ?? {}, file);
      const known = components.get(service);
      if (!known) {
        components.set(service, next);
      } else if (rank(file) < 2) {
        components.set(service, {
          service,
          images: next.images.length > 0 ? next.images : known.images,
          builtFrom: next.builtFrom ?? known.builtFrom,
          sources: [...known.sources, file],
          ports: [...new Set([...known.ports, ...next.ports])],
        });
      }
    }
  }

  // A Dockerfile that Compose does not use is still what the project runs on.
  if (components.size === 0 && files.includes("Dockerfile")) {
    const content = await readProjectDoc(projectPath, "Dockerfile");
    components.set("Dockerfile", {
      service: "Dockerfile",
      images: content === null ? [] : parseDockerfile(content),
      builtFrom: "Dockerfile",
      sources: ["Dockerfile"],
      ports: [],
    });
  }
  return { components: [...components.values()], invalidFiles };
}
