import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { buildCommand } from "@/lib/commands";
import type { ContainerFact } from "./db/schema";

const run = promisify(execFile);

const COMPOSE_TIMEOUT = 5 * 60_000;

/** Starts a GUI program without waiting for it to close. Resolves with an error message. */
export function launch(template: string, path: string): Promise<string | null> {
  const command = buildCommand(template, path);
  if (!command) return Promise.resolve("Aucune commande n'est configurée.");
  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, { cwd: path, detached: true, stdio: "ignore" });
    child.once("error", (error) => resolve(`Impossible de lancer ${command.file} : ${error.message}`));
    child.once("spawn", () => {
      child.unref();
      resolve(null);
    });
  });
}

export function composeDirectories(
  mode: "up" | "stop",
  projectPath: string,
  hasCompose: boolean,
  containers: ContainerFact[],
): string[] {
  const candidates =
    mode === "stop" ? containers.filter((container) => container.state === "running") : containers;
  const known = [...new Set(candidates.flatMap((container) => container.workingDir || []))];
  if (mode === "up" && hasCompose) return [projectPath];
  if (known.length > 0) return known;
  return hasCompose ? [projectPath] : [];
}

/**
 * `stop`, never `down`: containers are kept, along with anonymous volumes and any
 * state they hold, so that starting again is harmless.
 */
export async function runCompose(mode: "up" | "stop", directories: string[]): Promise<string | null> {
  if (directories.length === 0) return "Aucun fichier Docker Compose n'a été trouvé pour ce projet.";
  const args = mode === "up" ? ["compose", "up", "-d"] : ["compose", "stop"];
  for (const cwd of directories) {
    try {
      await run("docker", args, { cwd, timeout: COMPOSE_TIMEOUT, maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr?.trim();
      return stderr || String(error);
    }
  }
  return null;
}
