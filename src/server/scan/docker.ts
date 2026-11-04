import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ContainerFact } from "../db/schema";

const run = promisify(execFile);

const FORMAT = [
  "{{.Names}}",
  '{{.Label "com.docker.compose.service"}}',
  "{{.State}}",
  "{{.Status}}",
  "{{.Ports}}",
  '{{.Label "com.docker.compose.project.working_dir"}}',
].join("\t");

export type DockerContainer = ContainerFact & { workingDir: string };
export type DockerState = { containers: DockerContainer[]; error: string | null };

export function parseDockerPs(output: string): DockerContainer[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, service, state, status, ports, workingDir] = line.split("\t");
      return { name, service, state, status, ports, workingDir };
    });
}

/** A compose file can live in a subfolder, so the deepest project containing it wins. */
export function assignContainers(
  projectPaths: string[],
  containers: DockerContainer[],
): Map<string, ContainerFact[]> {
  const assigned = new Map<string, ContainerFact[]>();
  for (const container of containers) {
    const { workingDir } = container;
    if (!workingDir) continue;
    const owner = projectPaths
      .filter((path) => workingDir === path || workingDir.startsWith(`${path}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (owner) {
      assigned.set(owner, [...(assigned.get(owner) ?? []), container]);
    }
  }
  return assigned;
}

/** Docker being stopped is a normal state, so it is reported instead of thrown. */
export async function readDocker(): Promise<DockerState> {
  try {
    const { stdout } = await run("docker", ["ps", "-a", "--no-trunc", "--format", FORMAT], {
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { containers: parseDockerPs(stdout), error: null };
  } catch (error) {
    const message = (error as { stderr?: string }).stderr?.trim() || String(error);
    return { containers: [], error: message };
  }
}
