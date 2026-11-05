"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
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

/** No password goes through here: see `api/servers/test`. */
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
