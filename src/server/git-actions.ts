import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { en, type Messages } from "@/i18n/en";
import { readBranches, readDirtyCount, readRemoteBranches } from "./scan/git";

const run = promisify(execFile);

const LOCAL_TIMEOUT = 60_000;
const FETCH_TIMEOUT = 2 * 60_000;

/** Null when it went well, otherwise what git said, as it is what explains the refusal. */
async function gitAction(cwd: string, args: string[], timeout = LOCAL_TIMEOUT): Promise<string | null> {
  try {
    await run("git", ["-c", "core.fsmonitor=false", ...args], {
      cwd,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      // Nothing can answer a prompt here: it would only hang until the timeout.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    return null;
  } catch (error) {
    return (error as { stderr?: string }).stderr?.trim() || String(error);
  }
}

/**
 * Stricter than git, which would carry the changes along when they do not conflict:
 * they would then quietly end up on another branch.
 * The name comes from the browser, so it must be one that exists in this repository.
 */
export async function switchBranch(
  path: string,
  branch: string,
  m: Messages["gitTab"] = en.gitTab,
): Promise<string | null> {
  const known = (await readBranches(path)).find(({ name }) => name === branch);
  if (!known) return m.branchGone(branch);
  if (known.current) return null;
  return (await refusalWhenDirty(path, m)) ?? gitAction(path, ["switch", "--", branch]);
}

async function refusalWhenDirty(path: string, m: Messages["gitTab"]): Promise<string | null> {
  const dirty = await readDirtyCount(path);
  if (dirty === null) return m.dirtyUnknown;
  return dirty > 0 ? m.dirtyBlocksSwitch(dirty) : null;
}

/** Makes the local branch of a remote one, and moves to it. Same rules as a switch. */
export async function checkOutRemoteBranch(
  path: string,
  remoteBranch: string,
  m: Messages["gitTab"] = en.gitTab,
): Promise<string | null> {
  const known = await readRemoteBranches(path, await readBranches(path));
  if (!known.some(({ name }) => name === remoteBranch)) return m.branchGone(remoteBranch);
  return (await refusalWhenDirty(path, m)) ?? gitAction(path, ["switch", "--track", remoteBranch]);
}

/**
 * Makes a local branch for each remote one, without moving to any: neither the files nor
 * the current branch change, so a dirty folder is no reason to refuse. The list is read
 * here, so the browser has no say in what gets created.
 */
export async function checkOutAllRemoteBranches(path: string): Promise<{ created: string[]; errors: string[] }> {
  const created: string[] = [];
  const errors: string[] = [];
  // One at a time: git locks the refs it changes.
  for (const { name } of await readRemoteBranches(path, await readBranches(path))) {
    const local = name.slice(name.indexOf("/") + 1);
    // The same name on two remotes: the most recent one was just made, and git would refuse this one.
    if (created.includes(local)) continue;
    const error = await gitAction(path, ["branch", "--track", local, name]);
    if (error) errors.push(error);
    else created.push(local);
  }
  return { created, errors };
}

/**
 * From the current commit, and moved to at once. Modified files are fine here: they stay
 * as they are, since both branches are the same commit.
 */
export async function createBranch(path: string, input: string, m: Messages["gitTab"] = en.gitTab): Promise<string | null> {
  const name = input.trim();
  if (!name) return m.branchNameRequired;
  if (name.startsWith("-") || (await gitAction(path, ["check-ref-format", "--branch", name])) !== null) {
    return m.branchNameInvalid(name);
  }
  return gitAction(path, ["switch", "-c", name]);
}

/** Never makes a merge: it either moves the branch forward, or git refuses. */
export function pullFastForward(path: string): Promise<string | null> {
  return gitAction(path, ["pull", "--no-rebase", "--ff-only"], FETCH_TIMEOUT);
}

export function fetchRemotes(path: string): Promise<string | null> {
  // --prune only forgets the remote branches that are gone, never a local one.
  return gitAction(path, ["fetch", "--all", "--prune"], FETCH_TIMEOUT);
}

/** The hash is what allows making the branch again. */
export type DeletedBranch = { name: string; hash: string };

/**
 * What can be deleted is read again here: the browser's list may be old. `-d` and not `-D`,
 * so that git also refuses a branch with commits its upstream does not have.
 */
export async function deleteMergedBranches(
  path: string,
  branches: string[],
  m: Messages["gitTab"] = en.gitTab,
): Promise<{ deleted: DeletedBranch[]; errors: string[] }> {
  const removable = new Map(
    (await readBranches(path)).filter((branch) => branch.removable).map(({ name, hash }) => [name, hash]),
  );
  const deleted: DeletedBranch[] = [];
  const errors: string[] = [];
  // One at a time: git locks the refs it changes.
  for (const branch of branches) {
    if (!removable.has(branch)) {
      errors.push(m.branchNotRemovable(branch));
      continue;
    }
    const error = await gitAction(path, ["branch", "-d", "--", branch]);
    if (error) errors.push(error);
    else deleted.push({ name: branch, hash: removable.get(branch) ?? "" });
  }
  return { deleted, errors };
}
