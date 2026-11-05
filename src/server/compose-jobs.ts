import { spawn } from "node:child_process";
import { cleanLogText } from "@/lib/container-logs";

export type ComposeAction = "build" | "pull";

export type ComposeJob = {
  id: number;
  action: ComposeAction;
  running: boolean;
  error: string | null;
  /** The last lines, as Compose words them. */
  output: string[];
};

const OUTPUT_LINES = 200;
/** A first build can download half the internet. */
const STEP_TIMEOUT_MS = 30 * 60_000;

/**
 * Both end on the new images running: an image that is ready but not used is not what these
 * buttons are for. `up` keeps the volumes, the anonymous ones included, and leaves alone the
 * services whose image did not change. What Compose can build, it does not try to pull.
 */
export function composeSteps(action: ComposeAction): string[][] {
  const compose = ["compose", "--progress", "plain"];
  return action === "build"
    ? [[...compose, "up", "-d", "--build"]]
    : [
        [...compose, "pull", "--ignore-buildable"],
        [...compose, "up", "-d"],
      ];
}

type Runner = (args: string[], cwd: string, onOutput: (text: string) => void) => Promise<number | null>;

const runDocker: Runner = (args, cwd, onOutput) =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: STEP_TIMEOUT_MS });
    child.stdout.on("data", (chunk: Buffer) => onOutput(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => onOutput(chunk.toString()));
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });

// Kept on globalThis so that a hot reload in dev does not lose a running job.
const holder = globalThis as unknown as { __pmComposeJobs?: Map<number, ComposeJob>; __pmComposeNext?: number };
const jobs = () => (holder.__pmComposeJobs ??= new Map());

export function currentComposeJob(projectId: number): ComposeJob | null {
  const job = jobs().get(projectId);
  return job ? { ...job, output: [...job.output] } : null;
}

/** A failure stays on screen until it has been read. */
export function dismissComposeJob(projectId: number): void {
  if (!jobs().get(projectId)?.running) jobs().delete(projectId);
}

/**
 * In the background, since a request of the app waits for the one before it and a build
 * takes minutes. False when one is already running for this project.
 */
export function startComposeJob(
  projectId: number,
  action: ComposeAction,
  directories: string[],
  onFinished: () => Promise<void> = async () => undefined,
  run: Runner = runDocker,
): boolean {
  if (jobs().get(projectId)?.running) return false;
  holder.__pmComposeNext = (holder.__pmComposeNext ?? 0) + 1;
  const job: ComposeJob = { id: holder.__pmComposeNext, action, running: true, error: null, output: [] };
  jobs().set(projectId, job);

  let partial = "";
  const onOutput = (text: string) => {
    const lines = (partial + text).split(/\r?\n|\r/);
    partial = lines.pop() ?? "";
    job.output.push(...lines.map(cleanLogText).filter(Boolean));
    job.output.splice(0, Math.max(0, job.output.length - OUTPUT_LINES));
  };

  void (async () => {
    try {
      for (const cwd of directories) {
        for (const args of composeSteps(action)) {
          const code = await run(args, cwd, onOutput);
          if (code !== 0) {
            job.error = cleanLogText(partial) || job.output.at(-1) || `docker compose: ${code}`;
            return;
          }
        }
      }
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
    }
  })()
    .then(onFinished)
    .catch((error) => console.error("Compose job could not finish", error))
    .finally(() => {
      if (partial) job.output.push(cleanLogText(partial));
      job.running = false;
    });
  return true;
}
