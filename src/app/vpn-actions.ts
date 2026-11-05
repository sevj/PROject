"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ensureConsoleServer } from "@/server/console/server";
import { issueGrant } from "@/server/console/grants";
import { getDb } from "@/server/db/client";
import { serverMessages } from "@/server/i18n";
import { nordLoginArguments } from "@/lib/vpn";
import { eq } from "drizzle-orm";
import { vpns } from "@/server/db/schema";
import { deleteVpn, disconnectVpn, type VpnFailure } from "@/server/vpn";

const refresh = () => revalidatePath("/", "layout");

export async function stopVpn(id: number): Promise<VpnFailure | null> {
  const failure = await disconnectVpn(getDb(), id);
  refresh();
  return failure;
}

export async function removeVpn(id: number): Promise<VpnFailure | null> {
  const failure = await deleteVpn(getDb(), id);
  refresh();
  return failure;
}

/** `nordlayer login` has its own questions, or a link to open: a terminal fits all of them. */
export async function openNordLogin(id: number): Promise<{ port: number; token: string } | { error: string }> {
  const db = getDb();
  const messages = serverMessages(db);
  // From the database, never from the browser: it ends up on a command line.
  const organization = db.select({ organization: vpns.organization }).from(vpns).where(eq(vpns.id, id)).get()?.organization ?? null;
  const appHost = (await headers()).get("host");
  if (!appHost) return { error: messages.errors.consoleUnavailable("no host") };
  try {
    const port = await ensureConsoleServer();
    const notes = { refused: "", unknownHostKey: "" };
    return { port, token: issueGrant({ kind: "remote", command: { program: "nordlayer", args: nordLoginArguments(organization) }, notes, appHost }) };
  } catch (error) {
    return { error: messages.errors.consoleUnavailable(error instanceof Error ? error.message : String(error)) };
  }
}
