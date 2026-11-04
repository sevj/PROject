import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { parseInspect, type Raw } from "../docker-containers";
import type { Command } from "./engines";

const run = promisify(execFile);

const CONTAINER_ID = /^[0-9a-f]{12,64}$/;

export type ContainerInfo = {
  id: string;
  name: string;
  image: string;
  service: string;
  running: boolean;
  /** Read here to log in to the database, and never sent to the browser. */
  env: Record<string, string>;
};

export function parseContainerInfo(raw: Raw): ContainerInfo {
  const env: Record<string, string> = {};
  for (const entry of raw.Config?.Env ?? []) {
    const at = entry.indexOf("=");
    if (at > 0) env[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return {
    id: raw.Id ?? "",
    name: (raw.Name ?? "").replace(/^\//, ""),
    image: raw.Config?.Image ?? "",
    service: raw.Config?.Labels?.["com.docker.compose.service"] ?? "",
    running: raw.State?.Running === true && raw.State?.Status !== "paused",
    env,
  };
}

export async function inspectInfo(names: string[]): Promise<ContainerInfo[]> {
  if (names.length === 0) return [];
  try {
    const { stdout } = await run("docker", ["inspect", "--type", "container", "--format", "{{json .}}", ...names], {
      timeout: 20_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return parseInspect(stdout).map(parseContainerInfo);
  } catch (error) {
    // One container gone since the list was made must not hide the others.
    const stdout = (error as { stdout?: string }).stdout;
    if (stdout) return parseInspect(stdout).map(parseContainerInfo);
    throw error;
  }
}

/** `-e NAME` without a value takes it from the environment of `docker` itself. */
export function execArgs(containerId: string, command: Command, marker?: string): string[] {
  if (!CONTAINER_ID.test(containerId)) throw new Error("Invalid container id");
  return [
    "exec",
    "-i",
    ...(marker ? ["-e", marker] : []),
    ...Object.keys(command.secrets ?? {}).flatMap((name) => ["-e", name]),
    containerId,
    ...command.args,
  ];
}

export const execEnv = (command: Command): NodeJS.ProcessEnv => ({ ...process.env, ...command.secrets });

export type QuickResult = { code: number | null; stdout: string; stderr: string };

const CAP = 1 << 20;

/** For what answers in a moment: the list of databases, a size, a statement. */
export function runQuick(containerId: string, command: Command, timeoutMs = 30_000): Promise<QuickResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", execArgs(containerId, command), {
      env: execEnv(command),
      stdio: [command.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout = (stdout + chunk.toString()).slice(0, CAP)));
    child.stderr?.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-CAP)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (command.stdin !== undefined) {
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(command.stdin);
    }
  });
}
