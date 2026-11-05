"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ensureConsoleServer } from "@/server/console/server";
import { issueGrant } from "@/server/console/grants";
import { getDb } from "@/server/db/client";
import { serverMessages } from "@/server/i18n";
import { prepareRemoteConsole } from "@/server/remote-console";
import {
  type AccessInput,
  deleteAccess,
  deleteEnvironment,
  deleteServer,
  type EnvironmentInput,
  forgetPassword,
  type Problem,
  saveAccess,
  saveEnvironment,
  saveServer,
  type Saved,
  type ServerInput,
} from "@/server/remote-servers";

/** No password comes through here: see `api/servers/test`. A console asks for its own in the terminal. */
const refresh = () => revalidatePath("/", "layout");

export async function submitServer(id: number | null, input: ServerInput): Promise<Saved> {
  const saved = saveServer(getDb(), id, input);
  refresh();
  return saved;
}

export async function removeServer(id: number): Promise<Problem | null> {
  const problem = deleteServer(getDb(), id);
  refresh();
  return problem;
}

export async function forgetServerPassword(id: number): Promise<void> {
  forgetPassword(getDb(), id);
  refresh();
}

export async function submitEnvironment(projectId: number, id: number | null, input: EnvironmentInput): Promise<Saved> {
  const saved = saveEnvironment(getDb(), projectId, id, input);
  refresh();
  return saved;
}

export async function removeEnvironment(projectId: number, id: number): Promise<void> {
  deleteEnvironment(getDb(), projectId, id);
  refresh();
}

export async function submitAccess(projectId: number, environmentId: number, id: number | null, input: AccessInput): Promise<Saved> {
  const saved = saveAccess(getDb(), projectId, environmentId, id, input);
  refresh();
  return saved;
}

export async function removeAccess(projectId: number, environmentId: number, id: number): Promise<void> {
  deleteAccess(getDb(), projectId, environmentId, id);
  refresh();
}

/** Opening on a protected environment is what the browser has to say a person confirmed. */
export async function openRemoteConsole(projectId: number, accessId: number, confirmed: boolean): Promise<{ port: number; token: string } | { error: string }> {
  const db = getDb();
  const messages = serverMessages(db);
  const m = messages.environments;
  const prepared = await prepareRemoteConsole(db, projectId, accessId, confirmed === true);
  if ("failure" in prepared) {
    const reason = prepared.failure === "notConfirmed" || prepared.failure === "noTarget" ? m.consoleFailures[prepared.failure] : messages.servers.failures[prepared.failure];
    return { error: prepared.detail ? `${reason} (${prepared.detail})` : reason };
  }
  const appHost = (await headers()).get("host");
  if (!appHost) return { error: messages.errors.consoleUnavailable("no host") };
  try {
    const port = await ensureConsoleServer();
    return { port, token: issueGrant({ kind: "remote", command: prepared, notes: { refused: m.consoleFailures.keptPasswordRefused, unknownHostKey: messages.servers.failures.unknownHostKey }, appHost }) };
  } catch (error) {
    return { error: messages.errors.consoleUnavailable(error instanceof Error ? error.message : String(error)) };
  }
}
