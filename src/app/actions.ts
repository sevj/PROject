"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  addTag,
  deleteTag,
  isStatus,
  removeTag,
  renameTag,
  setAbandoned,
  setDescription,
  setDisplayName,
  setFavorite,
  setNote,
  setStatus,
} from "@/server/classification";
import { getDb } from "@/server/db/client";
import { highlightSource } from "@/server/highlight";
import { normalizeHost, removeGitlabToken, saveGitlabToken } from "@/server/gitlab";
import { removeGithubToken, saveGithubToken } from "@/server/github";
import { type ApmProblem, type ApmProject, listApmProjects, removeApmConnection, saveApmConnection } from "@/server/apm";
import { type DirectoryListing, downloadsFolder, listDirectories } from "@/server/directory-browser";
import { serverMessages } from "@/server/i18n";
import type { ProjectStatus } from "@/server/db/schema";
import { isLocale } from "@/i18n";
import { ideCommandFor } from "@/lib/commands";
import { randomUUID } from "node:crypto";
import { type ClaudeConsoleGrant, isClaudeTask, isSessionId, MAX_CLAUDE_CONSOLES, type RunningClaudeConsole } from "@/lib/claude-console";
import { getFetchRemote, setApmProjectId, setFetchRemote } from "@/server/classification";
import { readRemotes } from "@/server/scan/git";
import { parseConsoleOptions } from "@/lib/console-options";
import { findSessionStart, readClaudeUsage } from "@/server/claude-usage/report";
import { syncClaudeUsageNow } from "@/server/claude-usage/scheduler";
import { isSessionOpen, sessionsOfConsole } from "@/server/console/claude-sessions";
import { ensureConsoleServer } from "@/server/console/server";
import { startBulkJob } from "@/server/bulk-jobs";
import { analyzeDependencies } from "@/server/dependencies";
import { dismissComposeJob, startComposeJob } from "@/server/compose-jobs";
import { issueGrant } from "@/server/console/grants";
import { listLiveConsoles, liveConsoleCount, stopLiveConsole } from "@/server/console/live-consoles";
import { listProjectContainers } from "@/server/docker-containers";
import {
  checkOutAllRemoteBranches,
  checkOutRemoteBranch,
  createBranch,
  type DeletedBranch,
  deleteMergedBranches,
  fetchRemotes,
  pullFastForward,
  switchBranch,
} from "@/server/git-actions";
import {
  type Blame,
  type CommitFile,
  type CommitPage,
  type CommitView,
  readBlame,
  readCommits,
  readCommitView,
  readStashView,
  readWorkingDiff,
} from "@/server/scan/git";
import { type ContainerAction, composeDirectories, launch, runCompose, runContainers } from "@/server/project-actions";
import { declareEnvVariable, restoreEnvValue, saveEnvValue } from "@/server/env-vars";
import {
  type EnvEntry,
  listProjectFolder,
  readEnvFile,
  readFolderSizes,
  readProjectSource,
  type SourceFile,
  type TreeListing,
} from "@/server/project-files";
import { getProject, getRegistry } from "@/server/registry";
import {
  changeDirectory,
  type ProjectInput,
  type Registered,
  registerMultiProject,
  registerProject,
  registerSubProject,
  removeProjects,
  type SubProjectInput,
} from "@/server/projects";
import { startRefresh, startSizing } from "@/server/scan/jobs";
import { refreshProjects, rescanProject } from "@/server/scan/run";
import { getSettings, saveSettings } from "@/server/settings";
import { type AliasProblem, checkAliases, type CommandAlias } from "@/lib/aliases";

export async function refreshEverything(): Promise<{ error: string | null }> {
  try {
    await startRefresh();
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    revalidatePath("/");
  }
}

/** Reads the folders that were just registered, so that they appear with their facts. */
async function readRegistered(result: Registered): Promise<Registered> {
  if ("ids" in result) {
    await refreshProjects(getDb(), result.ids);
    startSizing(result.ids);
  }
  revalidatePath("/", "layout");
  return result;
}

export async function addProject(input: ProjectInput): Promise<Registered> {
  return readRegistered(registerProject(getDb(), input));
}

export async function addMultiProject(input: ProjectInput, subProjects: SubProjectInput[]): Promise<Registered> {
  return readRegistered(registerMultiProject(getDb(), input, subProjects));
}

export async function addSubProject(groupId: number, input: SubProjectInput): Promise<Registered> {
  return readRegistered(registerSubProject(getDb(), groupId, input));
}

export async function browseDirectories(path: string, root?: string): Promise<DirectoryListing> {
  return listDirectories(String(path ?? ""), root === undefined ? undefined : String(root));
}

const PICKABLE = new Set(["ovpn", "conf"]);

/** For a field that holds a file's path: the browser never gives a page the path of a file it picked. */
export async function browseFiles(path: string, extensions: string[]): Promise<DirectoryListing> {
  const wanted = (Array.isArray(extensions) ? extensions : []).map(String).filter((extension) => PICKABLE.has(extension));
  const start = String(path ?? "").trim();
  return listDirectories(start || downloadsFolder(), undefined, wanted);
}

export async function moveProject(projectId: number, directory: string): Promise<string | null> {
  const result = await readRegistered(changeDirectory(getDb(), projectId, directory));
  return "error" in result ? result.error : null;
}

export async function removeFromList(projectIds: number[]): Promise<void> {
  removeProjects(getDb(), ids(projectIds));
  revalidatePath("/", "layout");
}

export async function refreshProject(projectId: number): Promise<void> {
  const exists = await rescanProject(getDb(), projectId);
  if (exists) startSizing([projectId]);
  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
}

export async function listFolderSizes(projectId: number, relative: string): Promise<Record<string, number> | null> {
  const project = getProject(getDb(), projectId);
  return project && !project.row.missing ? readFolderSizes(project.absolutePath, String(relative)) : null;
}

/** The path comes from the browser: only what is inside this project can be listed. */
export async function listProjectTree(projectId: number, relative: string): Promise<TreeListing | null> {
  const project = getProject(getDb(), projectId);
  return project ? listProjectFolder(project.absolutePath, String(relative)) : null;
}

/** Read-only, for the file explorer: the path comes from the browser and is checked there. */
export async function readSourceFile(projectId: number, relative: string): Promise<SourceFile> {
  const project = getProject(getDb(), projectId);
  if (!project || project.row.missing) return { kind: "unreadable" };
  const file = await readProjectSource(project.absolutePath, String(relative));
  return file.kind === "text" ? { ...file, tokens: await highlightSource(String(relative), file.content) } : file;
}

export async function loadBlame(projectId: number, relative: string): Promise<Blame | null> {
  const target = gitTarget(projectId);
  return "error" in target ? null : readBlame(target.path, String(relative));
}

export async function revealEnvFile(projectId: number, fileName: string): Promise<EnvEntry[] | null> {
  const project = getProject(getDb(), projectId);
  return project ? readEnvFile(project.absolutePath, fileName) : null;
}

function refreshAll() {
  revalidatePath("/", "layout");
}

function ids(values: number[]): number[] {
  return values.filter(Number.isInteger);
}

export async function updateStatus(projectIds: number[], status: ProjectStatus | null): Promise<void> {
  if (status !== null && !isStatus(status)) return;
  setStatus(getDb(), ids(projectIds), status);
  refreshAll();
}

export async function toggleFavorite(projectId: number, favorite: boolean): Promise<void> {
  setFavorite(getDb(), projectId, favorite === true);
  refreshAll();
}

export async function saveNote(projectId: number, note: string): Promise<void> {
  setNote(getDb(), projectId, String(note));
  refreshAll();
}

export async function renameProject(projectId: number, name: string): Promise<void> {
  setDisplayName(getDb(), projectId, String(name));
  refreshAll();
}

export async function saveDescription(projectId: number, description: string): Promise<void> {
  setDescription(getDb(), projectId, String(description));
  refreshAll();
}

export async function addTagTo(projectIds: number[], name: string): Promise<void> {
  addTag(getDb(), ids(projectIds), name);
  refreshAll();
}

export async function removeTagFrom(projectIds: number[], name: string): Promise<void> {
  removeTag(getDb(), ids(projectIds), String(name));
  refreshAll();
}

export async function renameTagByName(name: string, nextName: string): Promise<string | null> {
  const error = renameTag(getDb(), String(name), nextName);
  refreshAll();
  return error;
}

export async function deleteTagByName(name: string): Promise<void> {
  deleteTag(getDb(), String(name));
  refreshAll();
}

/** Restoring picks the project back up, since its data stopped being updated. */
export async function markAbandoned(projectIds: number[], abandoned: boolean): Promise<string | null> {
  const db = getDb();
  const projects = ids(projectIds);
  setAbandoned(db, projects, abandoned === true);
  if (abandoned !== true) {
    for (const projectId of projects) await rescanProject(db, projectId);
    startSizing(projects);
  }
  refreshAll();
  return null;
}

function launchable(projectId: number) {
  const project = getProject(getDb(), projectId);
  // The path comes from the database, never from the browser.
  return project && !project.row.missing ? project : null;
}

export async function openIde(projectId: number): Promise<string | null> {
  const m = serverMessages(getDb()).errors;
  const project = launchable(projectId);
  if (!project) return m.projectGone;
  const { ideCommands } = getSettings(getDb());
  return launch(ideCommandFor(project.row.stacks, ideCommands), project.absolutePath, m);
}

export async function openTerminal(projectId: number): Promise<string | null> {
  const m = serverMessages(getDb()).errors;
  const project = launchable(projectId);
  if (!project) return m.projectGone;
  return launch(getSettings(getDb()).terminalCommand, project.absolutePath, m);
}

const CONTAINER_ACTIONS: ContainerAction[] = ["start", "stop", "restart"];

/**
 * One container when `containerId` is given, else all of the project's. Ids are checked
 * against what Docker reports for this project, so the browser cannot name another one.
 */
export async function controlContainers(
  projectId: number,
  action: ContainerAction,
  containerId?: string,
): Promise<string | null> {
  const db = getDb();
  const m = serverMessages(db).errors;
  if (!CONTAINER_ACTIONS.includes(action)) return m.unknownAction;
  const project = launchable(projectId);
  if (!project) return m.projectGone;
  if (project.row.abandoned) return m.abandonedProject;

  const live = await listProjectContainers(db, projectId);
  if (live.error) return m.dockerUnavailable(live.error);

  let targets = live.containers;
  if (containerId !== undefined) {
    targets = targets.filter(({ id }) => id === containerId);
    if (targets.length === 0) return m.containerGone;
  } else if (action === "start") {
    targets = targets.filter(({ running }) => !running);
  } else if (action === "stop") {
    targets = targets.filter(({ running }) => running);
  }

  let error: string | null;
  if (live.containers.length === 0 && containerId === undefined && action === "start") {
    // Nothing exists yet: Compose is what creates the containers.
    const { hasCompose, containers } = project.compose;
    error = await runCompose("up", composeDirectories("up", project.absolutePath, hasCompose, containers), m);
  } else {
    error = await runContainers(action, targets.map(({ id }) => id));
  }
  // The list shows how many containers run, and would otherwise keep the old number.
  await rescanProject(db, projectId);
  refreshAll();
  revalidatePath(`/projects/${projectId}`);
  return error;
}

/**
 * A shell in a container is as powerful as it gets, so the browser is given nothing but a
 * token that works once, for this container, and only from this page.
 */
export async function openConsole(
  projectId: number,
  containerId: string,
  rawOptions: unknown,
): Promise<{ port: number; token: string } | { error: string }> {
  const db = getDb();
  const m = serverMessages(db).errors;
  const project = launchable(projectId);
  if (!project) return { error: m.projectGone };
  if (project.row.abandoned) return { error: m.abandonedProject };

  const parsed = parseConsoleOptions(rawOptions);
  if ("error" in parsed) return { error: m.consoleOption(parsed.error) };

  const live = await listProjectContainers(db, projectId);
  if (live.error) return { error: m.dockerUnavailable(live.error) };
  const container = live.containers.find(({ id }) => id === String(containerId));
  if (!container) return { error: m.containerGone };
  if (!container.running || container.state === "paused") return { error: m.containerNotRunning };

  const appHost = (await headers()).get("host");
  if (!appHost) return { error: m.consoleUnavailable("no host") };
  try {
    const port = await ensureConsoleServer();
    return { port, token: issueGrant({ kind: "docker", containerId: container.id, options: parsed.options, appHost }) };
  } catch (error) {
    return { error: m.consoleUnavailable(error instanceof Error ? error.message : String(error)) };
  }
}

/**
 * Claude in the folder of the project. A console still running is joined again, and so is
 * the one already on the session to resume. Otherwise, a session is honoured only if it is
 * known to be of this project, and a new conversation starts if it is not, as it does when a
 * console that was never spoken to is reopened.
 */
export async function openClaudeConsole(
  projectId: number,
  resumeId: unknown,
  consoleId?: unknown,
  task?: unknown,
): Promise<ClaudeConsoleGrant | { error: string }> {
  const db = getDb();
  const m = serverMessages(db).errors;
  const project = launchable(projectId);
  if (!project) return { error: m.projectGone };
  if (project.row.abandoned) return { error: m.abandonedProject };

  const appHost = (await headers()).get("host");
  if (!appHost) return { error: m.consoleUnavailable("no host") };

  const listed = listLiveConsoles().filter((live) => live.projectId === projectId);
  const running =
    listed.find(({ id }) => id === consoleId) ??
    (isSessionId(resumeId) ? listed.find(({ sessionId }) => sessionsOfConsole(sessionId).at(-1) === resumeId) : undefined);

  let resumeFrom: string | null = null;
  if (!running) {
    if (liveConsoleCount() >= MAX_CLAUDE_CONSOLES) return { error: m.tooManyConsoles(MAX_CLAUDE_CONSOLES) };
    if (isSessionId(resumeId)) {
      if (isSessionOpen(resumeId)) return { error: m.claudeSessionOpen };
      // What was said a moment ago in this console may not have been read yet.
      await syncClaudeUsageNow();
      resumeFrom = findSessionStart(db, projectId, resumeId);
    }
  }
  const resume = resumeFrom !== null;
  const sessionId = running ? sessionsOfConsole(running.sessionId).at(-1) ?? running.sessionId : resume ? (resumeId as string) : randomUUID();
  const id = running?.id ?? randomUUID();
  const startedAt = running?.startedAt ?? Date.now();
  try {
    const port = await ensureConsoleServer();
    const cwd = resumeFrom ?? project.absolutePath;
    const token = issueGrant({
      kind: "claude",
      consoleId: id,
      projectId,
      projectName: project.row.name,
      startedAt,
      cwd,
      sessionId,
      resume,
      // Only what starts a new conversation is given one: a console that comes back has its own.
      task: !running && !resume && isClaudeTask(task) ? task : undefined,
      appHost,
    });
    return { port, sessionId, consoleId: id, token };
  } catch (error) {
    return { error: m.consoleUnavailable(error instanceof Error ? error.message : String(error)) };
  }
}

/** What is still running from before this page was opened, or in another tab. */
export async function listClaudeConsoles(): Promise<RunningClaudeConsole[]> {
  return listLiveConsoles().map(({ id, projectId, projectName, sessionId, startedAt }) => ({
    consoleId: id,
    projectId,
    projectName,
    sessionId: sessionsOfConsole(sessionId).at(-1) ?? sessionId,
    startedAt,
  }));
}

export async function endClaudeConsole(consoleId: unknown): Promise<void> {
  if (typeof consoleId === "string") stopLiveConsole(consoleId);
}

/** What one console has consumed since it was opened, and the session it is on by now. */
export async function readClaudeConsoleUsage(
  projectId: number,
  sessionId: unknown,
  since: number,
): Promise<{ costInDollars: number; calls: number; sessionId: string | null }> {
  if (!isSessionId(sessionId)) return { costInDollars: 0, calls: 0, sessionId: null };
  await syncClaudeUsageNow();
  const sessionIds = sessionsOfConsole(sessionId);
  const usage = readClaudeUsage(getDb(), projectId, Date.now(), { since, sessionIds });
  return { costInDollars: usage?.costInDollars ?? 0, calls: usage?.calls ?? 0, sessionId: sessionIds.at(-1) ?? null };
}

export async function saveSettingsForm(form: Record<string, string>): Promise<string | null> {
  const clean = (value: unknown) => String(value ?? "").trim();
  const ideCommands: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    if (key.startsWith("ide:") && clean(value)) ideCommands[key.slice(4)] = clean(value);
  }
  if (!clean(form.terminal) || !ideCommands.default) return serverMessages(getDb()).errors.commandsRequired;
  saveSettings(getDb(), {
    terminalCommand: clean(form.terminal),
    ideCommands,
    ...(isLocale(form.locale) ? { locale: form.locale } : {}),
  });
  refreshAll();
  return null;
}

/** The token never comes back: only who it belongs to, or what is wrong with it. */
export async function saveGitlabTokenForm(
  host: string,
  token: string,
): Promise<{ host: string; user: string } | { problem: "host" | "token" | "refused" | "unreachable" }> {
  const saved = await saveGitlabToken(getDb(), String(host ?? ""), String(token ?? ""));
  if ("problem" in saved) return saved;
  revalidatePath("/settings");
  return { host: normalizeHost(String(host))!, user: saved.user };
}

export async function removeGitlabTokenForm(host: string): Promise<void> {
  removeGitlabToken(getDb(), String(host ?? ""));
  revalidatePath("/settings");
}

export async function saveGithubTokenForm(
  owner: string,
  token: string,
): Promise<{ owner: string; user: string } | { problem: "host" | "token" | "refused" | "unreachable" }> {
  const saved = await saveGithubToken(getDb(), String(owner ?? ""), String(token ?? ""));
  if (!("problem" in saved)) revalidatePath("/settings");
  return saved;
}

export async function removeGithubTokenForm(owner: string): Promise<void> {
  removeGithubToken(getDb(), String(owner ?? ""));
  revalidatePath("/settings");
}

/** The token never comes back: only who it belongs to, or what is wrong with it. */
export async function saveApmConnectionForm(
  url: string,
  token: string,
): Promise<{ url: string; user: string } | { problem: "url" | "token" | "refused" | "unreachable" }> {
  const saved = await saveApmConnection(getDb(), String(url ?? ""), String(token ?? ""));
  if (!("problem" in saved)) revalidatePath("/", "layout");
  return saved;
}

export async function removeApmConnectionForm(): Promise<void> {
  removeApmConnection(getDb());
  revalidatePath("/", "layout");
}

/** For the picker of the Tickets tab: asked when it opens. */
export async function readApmProjects(): Promise<{ projects: ApmProject[] } | { problem: ApmProblem }> {
  const read = await listApmProjects(getDb());
  return "problem" in read ? { problem: read.problem } : read;
}

/** Null unlinks. Any positive id is kept: APM tells in the tab whether the token can see it. */
export async function linkApmProject(projectId: number, apmProjectId: unknown): Promise<string | null> {
  const db = getDb();
  if (!getProject(db, projectId)) return serverMessages(db).tickets.projectGone;
  if (apmProjectId !== null && (!Number.isSafeInteger(apmProjectId) || (apmProjectId as number) <= 0)) {
    return serverMessages(db).tickets.invalidId;
  }
  setApmProjectId(db, projectId, apmProjectId as number | null);
  revalidatePath(`/projects/${projectId}`);
  return null;
}

/** Shown in local consoles: read when one opens, so a change in the settings reaches the next console. */
export async function readConsoleAliases(): Promise<CommandAlias[]> {
  return getSettings(getDb()).aliases;
}

export async function saveConsoleAliases(rows: { name: string; command: string }[]): Promise<AliasProblem | null> {
  const aliases = checkAliases(Array.isArray(rows) ? rows : []);
  if (!Array.isArray(aliases)) return aliases;
  saveSettings(getDb(), { aliases });
  revalidatePath("/settings");
  return null;
}

/** After a git action, what the list and the sheet show must follow. */
async function afterGitAction(projectId: number) {
  await rescanProject(getDb(), projectId);
  refreshAll();
  revalidatePath(`/projects/${projectId}`);
}

function gitTarget(projectId: number): { path: string } | { error: string } {
  const m = serverMessages(getDb()).errors;
  const project = launchable(projectId);
  if (!project) return { error: m.projectGone };
  if (project.row.abandoned) return { error: m.abandonedProject };
  return { path: project.absolutePath };
}

/** The list of `.env` files shown on the General tab comes from the last refresh. */
async function afterEnvChange(projectId: number) {
  await rescanProject(getDb(), projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function saveEnvVariable(projectId: number, key: string, value: string): Promise<string | null> {
  const target = gitTarget(projectId);
  if ("error" in target) return target.error;
  const error = saveEnvValue(getDb(), projectId, target.path, String(key), String(value), serverMessages(getDb()).envTab);
  if (!error) await afterEnvChange(projectId);
  return error;
}

export async function removeEnvVariable(projectId: number, key: string): Promise<string | null> {
  const target = gitTarget(projectId);
  if ("error" in target) return target.error;
  const error = saveEnvValue(getDb(), projectId, target.path, String(key), null, serverMessages(getDb()).envTab);
  if (!error) await afterEnvChange(projectId);
  return error;
}

export async function declareEnvVariableInProject(projectId: number, key: string): Promise<string | null> {
  const target = gitTarget(projectId);
  if ("error" in target) return target.error;
  const error = declareEnvVariable(target.path, String(key), serverMessages(getDb()).envTab);
  if (!error) await afterEnvChange(projectId);
  return error;
}

export async function restoreEnvVariable(projectId: number, entryId: number): Promise<string | null> {
  const target = gitTarget(projectId);
  if ("error" in target) return target.error;
  const error = restoreEnvValue(getDb(), projectId, target.path, Number(entryId), serverMessages(getDb()).envTab);
  if (!error) await afterEnvChange(projectId);
  return error;
}

export async function switchProjectBranch(projectId: number, branch: string): Promise<string | null> {
  const target = gitTarget(projectId);
  if ("error" in target) return target.error;
  const error = await switchBranch(target.path, branch, serverMessages(getDb()).gitTab);
  await afterGitAction(projectId);
  return error;
}

export async function fetchProject(projectId: number): Promise<string | null> {
  const target = gitTarget(projectId);
  if ("error" in target) return target.error;
  const db = getDb();
  const error = await fetchRemotes(target.path, getFetchRemote(db, projectId), serverMessages(db).gitTab);
  await afterGitAction(projectId);
  return error;
}

/** Null reads them all. A name comes from the browser, so it must be one this repository has. */
export async function chooseFetchRemote(projectId: number, remote: unknown): Promise<string | null> {
  const target = gitTarget(projectId);
  if ("error" in target) return target.error;
  const db = getDb();
  if (remote !== null && (typeof remote !== "string" || !(await readRemotes(target.path)).includes(remote))) {
    return serverMessages(db).gitTab.remoteGone(String(remote));
  }
  setFetchRemote(db, projectId, remote);
  revalidatePath(`/projects/${projectId}`);
  return null;
}

export async function cleanUpBranches(
  projectId: number,
  branches: string[],
): Promise<{ deleted: DeletedBranch[]; errors: string[] }> {
  const target = gitTarget(projectId);
  if ("error" in target) return { deleted: [], errors: [target.error] };
  const result = await deleteMergedBranches(target.path, branches, serverMessages(getDb()).gitTab);
  await afterGitAction(projectId);
  return result;
}

export async function pullProject(projectId: number): Promise<string | null> {
  const target = gitTarget(projectId);
  if ("error" in target) return target.error;
  const error = await pullFastForward(target.path);
  await afterGitAction(projectId);
  return error;
}

export async function createProjectBranch(projectId: number, name: string): Promise<string | null> {
  const target = gitTarget(projectId);
  if ("error" in target) return target.error;
  const error = await createBranch(target.path, name, serverMessages(getDb()).gitTab);
  await afterGitAction(projectId);
  return error;
}

export async function checkOutProjectRemoteBranch(projectId: number, remoteBranch: string): Promise<string | null> {
  const target = gitTarget(projectId);
  if ("error" in target) return target.error;
  const error = await checkOutRemoteBranch(target.path, remoteBranch, serverMessages(getDb()).gitTab);
  await afterGitAction(projectId);
  return error;
}

export async function checkOutAllProjectRemoteBranches(
  projectId: number,
): Promise<{ created: string[]; errors: string[] }> {
  const target = gitTarget(projectId);
  if ("error" in target) return { created: [], errors: [target.error] };
  const result = await checkOutAllRemoteBranches(target.path);
  await afterGitAction(projectId);
  return result;
}

export async function loadProjectCommits(projectId: number, from: string, skip: number): Promise<CommitPage> {
  const target = gitTarget(projectId);
  if ("error" in target) return { commits: [], hasMore: false };
  return readCommits(target.path, { from, skip });
}

export async function loadCommitView(projectId: number, hash: string): Promise<CommitView | null> {
  const target = gitTarget(projectId);
  return "error" in target ? null : readCommitView(target.path, hash);
}

export async function loadWorkingDiff(projectId: number): Promise<CommitFile[] | null> {
  const target = gitTarget(projectId);
  return "error" in target ? null : readWorkingDiff(target.path);
}

export async function loadStashView(projectId: number, ref: string): Promise<CommitFile[] | null> {
  const target = gitTarget(projectId);
  return "error" in target ? null : readStashView(target.path, ref);
}

const FETCH_CONCURRENCY = 4;
const ANALYZE_CONCURRENCY = 2;

/** Asked for by a button. Each project reads the remote chosen for it, as its own Fetch does. */
export async function fetchAllProjects(): Promise<boolean> {
  const db = getDb();
  const targets = getRegistry(db).rows.filter(
    ({ missing, abandoned, hasGit, remoteCount }) => !missing && !abandoned && hasGit && remoteCount !== 0,
  );
  const ids = targets.map(({ id }) => id);
  return startBulkJob(
    "fetch",
    targets,
    FETCH_CONCURRENCY,
    async ({ id }) => {
      const project = launchable(id);
      return project ? fetchRemotes(project.absolutePath, getFetchRemote(db, id), serverMessages(db).gitTab) : null;
    },
    // What is behind or not pushed can only be told after this.
    () => refreshProjects(db, ids),
  );
}

export async function analyzeAllProjects(): Promise<boolean> {
  const db = getDb();
  const targets = getRegistry(db).rows.filter(({ missing, abandoned }) => !missing && !abandoned);
  return startBulkJob("analyze", targets, ANALYZE_CONCURRENCY, async ({ id }) => {
    const project = launchable(id);
    if (!project) return null;
    const outcome = await analyzeDependencies(db, id, project.absolutePath);
    return "error" in outcome && outcome.error === "busy" ? serverMessages(db).dependencies.busy : null;
  });
}

/** Asked for by a button, after a confirmation: changed images replace running containers. */
export async function startCompose(projectId: number, action: unknown): Promise<string | null> {
  const db = getDb();
  const m = serverMessages(db).errors;
  if (action !== "build" && action !== "pull") return m.unknownAction;
  const project = launchable(projectId);
  if (!project) return m.projectGone;
  if (project.row.abandoned) return m.abandonedProject;
  const { hasCompose, containers } = project.compose;
  const directories = composeDirectories("up", project.absolutePath, hasCompose, containers);
  if (directories.length === 0) return m.noCompose;
  const started = startComposeJob(projectId, action, directories, async () => {
    await rescanProject(db, projectId);
  });
  revalidatePath(`/projects/${projectId}`);
  return started ? null : m.composeBusy;
}

export async function dismissCompose(projectId: number): Promise<void> {
  dismissComposeJob(projectId);
  revalidatePath(`/projects/${projectId}`);
}
