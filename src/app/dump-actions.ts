"use server";

import { revalidatePath } from "next/cache";
import { isCompatible, isValidDatabaseName } from "@/lib/db-engines";
import { getDb } from "@/server/db/client";
import { type DatabaseTarget, listDatabaseContainers, publicTarget } from "@/server/dumps/containers";
import { runQuick } from "@/server/dumps/docker-run";
import { type CredentialOverride, listDatabasesCommand, parseDatabases, readCredentials } from "@/server/dumps/engines";
import { cancelJob, dismissJob, type JobError, listJobs, startDump, startRestore, startRestoreAfterDump } from "@/server/dumps/jobs";
import { getDump, removeDump, setDumpNote, stashDir } from "@/server/dumps/store";
import { serverMessages } from "@/server/i18n";

type Login = { user?: string; password?: string };

const cleanLogin = (login: Login | undefined): CredentialOverride => ({
  user: typeof login?.user === "string" ? login.user.trim().slice(0, 129) : undefined,
  password: typeof login?.password === "string" && login.password !== "" ? login.password.slice(0, 256) : undefined,
});

async function findContainer(containerId: string) {
  const { containers, error } = await listDatabaseContainers(getDb());
  return { error, container: containers.find(({ id }) => id === String(containerId)) };
}

const jobMessage = (error: JobError, m: ReturnType<typeof serverMessages>["errors"]) =>
  ({
    busy: m.jobBusy,
    limit: m.jobLimit,
    invalidDatabase: m.invalidDatabase,
    fileMissing: m.dumpFileMissing,
    notFinished: m.dumpNotFinished,
  })[error];

/** The running databases of every project, without a word of how to log in to them. */
export async function listTargets(): Promise<{ targets: DatabaseTarget[]; error: string | null }> {
  const { containers, error } = await listDatabaseContainers(getDb());
  return {
    error,
    targets: containers.map(publicTarget),
  };
}

export async function listContainerDatabases(
  containerId: string,
  login?: Login,
): Promise<{ databases: string[]; defaultDatabase: string | null } | { error: string }> {
  const m = serverMessages(getDb()).errors;
  const { container, error } = await findContainer(containerId);
  if (error) return { error: m.dockerUnavailable(error) };
  if (!container) return { error: m.containerGone };

  const credentials = readCredentials(container.engine, container.info.env, cleanLogin(login));
  try {
    const result = await runQuick(container.id, listDatabasesCommand(container.engine, credentials));
    if (result.code !== 0) return { error: result.stderr.trim().split("\n").slice(-4).join("\n") || m.databasesUnreadable };
    return {
      databases: parseDatabases(container.engine, result.stdout),
      defaultDatabase: credentials.database,
    };
  } catch (failure) {
    return { error: failure instanceof Error ? failure.message : String(failure) };
  }
}

export async function startDumpJob(input: {
  containerId: string;
  database: string | null;
  note?: string;
  login?: Login;
}): Promise<{ jobId: string } | { error: string }> {
  const db = getDb();
  const m = serverMessages(db).errors;
  const { container, error } = await findContainer(input.containerId);
  if (error) return { error: m.dockerUnavailable(error) };
  if (!container) return { error: m.containerGone };
  const database = input.database === null ? null : String(input.database);
  if (database !== null && !isValidDatabaseName(database)) return { error: m.invalidDatabase };

  const result = startDump(db, {
    target: { id: container.id, name: container.name, engine: container.engine, projectId: container.projectId, projectName: container.projectName, info: container.info },
    database,
    note: typeof input.note === "string" ? input.note : null,
    override: cleanLogin(input.login),
  });
  revalidatePath("/dumps");
  return "error" in result ? { error: jobMessage(result.error, m) } : result;
}

/** Loading replaces data, so the browser has to say it asked a person first. */
export async function startLoadJob(input: {
  dumpId: number;
  containerId: string;
  database: string | null;
  confirmed: boolean;
  /** Dump what is there first, and load only if that worked. */
  keepCopy?: boolean;
  login?: Login;
}): Promise<{ jobId: string } | { error: string }> {
  const db = getDb();
  const m = serverMessages(db).errors;
  if (input.confirmed !== true) return { error: m.loadNotConfirmed };
  const dump = getDump(db, Number(input.dumpId));
  if (!dump) return { error: m.dumpGone };
  const { container, error } = await findContainer(input.containerId);
  if (error) return { error: m.dockerUnavailable(error) };
  if (!container) return { error: m.containerGone };
  if (!isCompatible(dump.engine, container.engine)) return { error: m.dumpIncompatible(dump.engine, container.engine) };
  const database = input.database === null ? null : String(input.database);
  // A dump of every database can only be loaded as it is, and one database into one.
  if ((dump.database === null) !== (database === null)) return { error: m.invalidDatabase };

  const target = { id: container.id, name: container.name, engine: container.engine, projectId: container.projectId, projectName: container.projectName, info: container.info };
  const override = cleanLogin(input.login);
  const result =
    input.keepCopy === true
      ? startRestoreAfterDump(db, { dump, target, database, override, note: serverMessages(db).dumps.keptBeforeLoading(dump.fileName) })
      : startRestore({ dump, target, database, override });
  return "error" in result ? { error: jobMessage(result.error, m) } : result;
}

export async function cancelDumpJob(jobId: string): Promise<void> {
  cancelJob(String(jobId));
}

export async function dismissDumpJob(jobId: string): Promise<void> {
  dismissJob(String(jobId));
}

export async function deleteDump(dumpId: number): Promise<string | null> {
  const db = getDb();
  const m = serverMessages(db).errors;
  const id = Number(dumpId);
  if (listJobs().some((job) => job.dumpId === id && job.status === "running")) return m.dumpInUse;
  await removeDump(db, stashDir(), id);
  revalidatePath("/dumps");
  return null;
}

export async function saveDumpNote(dumpId: number, note: string): Promise<void> {
  setDumpNote(getDb(), Number(dumpId), String(note));
  revalidatePath("/dumps");
}
