import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export function parseSocketPath(host: string): string | null {
  return host.startsWith("unix://") ? host.slice("unix://".length) || null : null;
}

let cached: { key: string; path: Promise<string> } | undefined;

async function resolve(): Promise<string> {
  const fromEnv = process.env.DOCKER_HOST;
  if (fromEnv) {
    const path = parseSocketPath(fromEnv);
    if (path) return path;
    throw new Error(`DOCKER_HOST=${fromEnv} is not a local socket`);
  }
  // The `docker` command follows its current context (Docker Desktop has its own socket).
  try {
    const { stdout } = await run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], {
      timeout: 5000,
    });
    const path = parseSocketPath(stdout.trim());
    if (path) return path;
  } catch {
    // Without a readable context, the default socket is the best guess.
  }
  return "/var/run/docker.sock";
}

export function dockerSocketPath(): Promise<string> {
  const key = process.env.DOCKER_HOST ?? "";
  if (!cached || cached.key !== key) {
    const path = resolve();
    cached = { key, path };
    path.catch(() => {
      cached = undefined;
    });
  }
  return cached.path;
}
