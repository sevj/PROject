"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import type { ServerView, Suggestions } from "@/server/remote-servers";
import { TestButton } from "../connection-test";
import { forgetServerPassword, removeServer } from "../environment-actions";
import { useFlash } from "../flash";
import { PlusIcon } from "../icons";
import { useConfirm } from "../modal";
import { ServerFormModal } from "../server-form";
import { BADGE, BUTTON_PRIMARY, BUTTON_SMALL, BUTTON_SMALL_DANGER, CARD, DATA, LINK, SECTION_TITLE } from "../ui";

export function serverSummary(server: ServerView): string {
  if (server.kind === "kubernetes") return server.context ?? "";
  if (server.auth === "alias") return server.host ?? "";
  return `${server.username ? `${server.username}@` : ""}${server.host}${server.port ? `:${server.port}` : ""}${server.jumpHost ? ` via ${server.jumpHost}` : ""}`;
}

function ServerRow({ server, suggestions }: { server: ServerView; suggestions: Suggestions }) {
  const m = useMessages().servers;
  const flash = useFlash();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const { confirm, confirmation } = useConfirm();

  const ask = () =>
    confirm({
      title: m.deleteTitle(server.name),
      action: m.delete,
      danger: true,
      onConfirm: () =>
        start(async () => {
          const problem = await removeServer(server.id);
          if (problem) flash("error", m.problems[problem]);
        }),
    });

  return (
    <li className="grid gap-2 border-b border-rule py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h3 className="inline font-semibold break-words">{server.name}</h3> <span className={BADGE}>{m.kinds[server.kind]}</span>
          <p className={`${DATA} break-all text-mut`}>
            {serverSummary(server)}
            {server.auth ? ` · ${m.auths[server.auth]}` : ""}
            {server.keyPath ? ` · ${server.keyPath}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TestButton serverId={server.id} serverName={server.name} />
          {server.hasPassword ? (
            <button type="button" disabled={pending} onClick={() => start(() => forgetServerPassword(server.id))} className={BUTTON_SMALL}>
              {m.forget}
            </button>
          ) : null}
          <button type="button" onClick={() => setEditing(true)} className={BUTTON_SMALL}>{m.edit}</button>
          <button
            type="button"
            disabled={pending || server.usedBy.length > 0}
            title={server.usedBy.length > 0 ? m.problems.serverInUse : undefined}
            onClick={ask}
            className={BUTTON_SMALL_DANGER}
          >
            {m.delete}
          </button>
        </div>
      </div>
      {server.usedBy.length > 0 ? (
        <p className="text-[12px] text-mut">
          {m.usedBy}{" "}
          {server.usedBy.map(({ projectId, projectName, environment }, index) => (
            <span key={`${projectId}/${environment}`}>
              {index > 0 ? ", " : ""}
              <Link href={`/projects/${projectId}?tab=environments`} className={LINK}>{projectName}</Link> ({environment})
            </span>
          ))}
        </p>
      ) : null}
      {editing ? <ServerFormModal server={server} suggestions={suggestions} onClose={() => setEditing(false)} /> : null}
      {confirmation}
    </li>
  );
}

export function ServersView({ servers, suggestions }: { servers: ServerView[]; suggestions: Suggestions }) {
  const m = useMessages().servers;
  const [adding, setAdding] = useState(false);
  return (
    <section className={CARD}>
      <div className={`${SECTION_TITLE} mb-1`}>
        <h1>{m.title}</h1>
      </div>
      <p className="pt-1 pb-3 text-[12px] text-mut">{m.hint}</p>
      <button type="button" onClick={() => setAdding(true)} className={BUTTON_PRIMARY}>
        <PlusIcon />
        {m.add}
      </button>
      {servers.length === 0 ? <p className="pt-3 text-mut">{m.none}</p> : null}
      <ul className="mt-2">
        {servers.map((server) => (
          <ServerRow key={server.id} server={server} suggestions={suggestions} />
        ))}
      </ul>
      {adding ? <ServerFormModal server={null} suggestions={suggestions} onClose={() => setAdding(false)} /> : null}
    </section>
  );
}
