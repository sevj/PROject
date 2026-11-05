"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { type AssignProblem, assignSshKey, closeSshKey } from "@/server/ssh-keys";

/** `keyPath` null takes the key back from the server. */
export async function giveSshKey(serverId: number, keyPath: string | null): Promise<AssignProblem | null> {
  if (!Number.isInteger(serverId) || (keyPath !== null && typeof keyPath !== "string")) return "serverMissing";
  const problem = await assignSshKey(getDb(), serverId, keyPath);
  revalidatePath("/ssh-keys");
  revalidatePath("/servers");
  return problem;
}

export async function fixSshKeyMode(name: string): Promise<boolean> {
  const done = typeof name === "string" && (await closeSshKey(name));
  revalidatePath("/ssh-keys");
  return done;
}
