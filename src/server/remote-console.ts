import { homedir } from "node:os";
import { and, eq } from "drizzle-orm";
import { kubeExecArguments, sshConsoleArguments, type TestFailure } from "@/lib/remote-servers";
import type { Db } from "./db/client";
import { environmentAccesses, projectEnvironments, projects, remoteServers } from "./db/schema";
import { type CommandRunner, resolveKubePod, runCommand } from "./remote-servers";
import { decryptSecret } from "./secrets";
import { downVpnName } from "./vpn";

export type RemoteCommand = { program: "ssh" | "kubectl" | "nordlayer"; args: string[]; password?: string };

export type ConsoleFailure = TestFailure | "notConfirmed" | "noTarget";

const failed = (failure: ConsoleFailure, detail = "") => ({ failure, detail });

/**
 * What to run for an access of this project, read from the database and never from the browser.
 * A password that is not kept, or no longer readable, is not a failure: ssh asks in the terminal.
 */
export async function prepareRemoteConsole(
  db: Db,
  projectId: number,
  accessId: number,
  confirmed: boolean,
  run: CommandRunner = runCommand,
  home = homedir(),
): Promise<RemoteCommand | { failure: ConsoleFailure; detail: string }> {
  const found = Number.isInteger(accessId)
    ? db
        .select({ access: environmentAccesses, environment: projectEnvironments, server: remoteServers, abandoned: projects.abandoned })
        .from(environmentAccesses)
        .innerJoin(projectEnvironments, eq(environmentAccesses.environmentId, projectEnvironments.id))
        .innerJoin(projects, eq(projectEnvironments.projectId, projects.id))
        .innerJoin(remoteServers, eq(environmentAccesses.serverId, remoteServers.id))
        .where(and(eq(environmentAccesses.id, accessId), eq(projectEnvironments.projectId, projectId)))
        .get()
    : undefined;
  if (!found || found.abandoned) return failed("gone");
  const { access, environment, server } = found;
  if (environment.protected && !confirmed) return failed("notConfirmed");
  const down = await downVpnName(db, server.vpnId, run);
  if (down) return failed("vpnDown", down);

  if (server.kind === "kubernetes") {
    if (!access.target) return failed("noTarget");
    const context = server.context ?? "";
    const resolved = await resolveKubePod(run, context, access.namespace, access.target);
    if ("failure" in resolved) return resolved;
    return { program: "kubectl", args: kubeExecArguments(context, access.namespace, resolved.pod.name, access.container) };
  }

  if ((await run("ssh", ["-V"])).notInstalled) return failed("sshMissing");
  const auth = server.auth ?? "agent";
  const target = { host: server.host ?? "", port: server.port, username: server.username, auth, keyPath: server.keyPath, jumpHost: server.jumpHost };
  const kept = auth === "password" && server.passwordSecret ? decryptSecret(server.passwordSecret) : null;
  // Without sshpass, a kept password is only typed by hand: that still opens.
  const password = kept && !(await run("sshpass", ["-V"])).notInstalled ? kept : undefined;
  return { program: "ssh", args: sshConsoleArguments(target, access.path, password !== undefined, home), ...(password === undefined ? {} : { password }) };
}
