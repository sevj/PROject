"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import type { KeyTarget, SshKeys, SshKeyView } from "@/server/ssh-keys";
import { copyText } from "../clipboard";
import { useFlash } from "../flash";
import { useConfirm } from "../modal";
import { BADGE, BADGE_ALERT, BUTTON_SMALL, CARD, DATA, FIELD } from "../ui";
import { fixSshKeyMode, giveSshKey } from "./actions";

export function SshKeysView({ keys, servers }: SshKeys) {
  const m = useMessages().sshKeys;
  return (
    <section className="grid gap-4">
      <div>
        <h1 className="text-[32px] leading-none font-bold tracking-tight">{m.title}</h1>
        <p className="max-w-[80ch] pt-2 text-mut">{m.intro}</p>
      </div>
      {keys.length === 0 ? <p className="text-mut">{m.none}</p> : null}
      <ul className="grid gap-3">
        {keys.map((key) => (
          <KeyCard key={key.name} sshKey={key} servers={servers} />
        ))}
      </ul>
    </section>
  );
}

function KeyCard({ sshKey, servers }: { sshKey: SshKeyView; servers: KeyTarget[] }) {
  const m = useMessages().sshKeys;
  const flash = useFlash();
  const router = useRouter();
  const [pending, start] = useTransition();
  const { confirm, confirmation } = useConfirm();
  const others = servers.filter((server) => !sshKey.usedBy.some(({ id }) => id === server.id));

  const give = (server: KeyTarget, keyPath: string | null) =>
    start(async () => {
      const problem = await giveSshKey(server.id, keyPath);
      if (problem) flash("error", m.problems[problem]);
      else flash("success", keyPath ? m.assigned(sshKey.name, server.name) : m.released(server.name));
      router.refresh();
    });

  const choose = (id: number) => {
    const server = servers.find((item) => item.id === id);
    if (!server) return;
    if (server.auth === "password") confirm({ ...m.passwordConfirm(server.name), action: m.assign.replace("…", ""), onConfirm: () => give(server, sshKey.path) });
    else give(server, sshKey.path);
  };

  const copy = async () => {
    if (await copyText(sshKey.publicKey)) flash("success", m.copied);
  };

  return (
    <li className={`${CARD} grid gap-2`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="inline font-semibold break-all">{sshKey.name}</h2>{" "}
          {sshKey.type ? <span className={BADGE}>{sshKey.type} {sshKey.bits}</span> : null}{" "}
          {sshKey.protected === null ? null : <span className={BADGE}>{sshKey.protected ? m.protected : m.unprotected}</span>}{" "}
          {sshKey.inAgent ? <span className={BADGE}>{m.inAgent}</span> : null}{" "}
          {sshKey.tooOpen ? <span className={BADGE_ALERT}>{m.tooOpen}</span> : null}
          <p className={`${DATA} break-all text-mut`}>
            {[sshKey.comment, sshKey.fingerprint].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sshKey.tooOpen ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (await fixSshKeyMode(sshKey.name)) flash("success", m.fixed(sshKey.name));
                  else flash("error", m.fixFailed);
                  router.refresh();
                })
              }
              className={BUTTON_SMALL}
            >
              {m.fix}
            </button>
          ) : null}
          {sshKey.publicKey ? (
            <button type="button" onClick={() => void copy()} className={BUTTON_SMALL}>
              {m.copy}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {sshKey.usedBy.length === 0 ? (
          <span className="text-mut">{m.unused}</span>
        ) : (
          <>
            <span className="text-mut">{m.usedBy}</span>
            {sshKey.usedBy.map((server) => (
              <span key={server.id} className={`${BADGE} inline-flex items-center gap-1`}>
                {server.name}
                <button
                  type="button"
                  disabled={pending}
                  aria-label={m.release(server.name)}
                  title={m.release(server.name)}
                  onClick={() => give({ ...server, auth: "key", keyPath: sshKey.path }, null)}
                  className="cursor-pointer px-0.5 hover:text-alert"
                >
                  ✕
                </button>
              </span>
            ))}
          </>
        )}
        {others.length > 0 ? (
          <select
            aria-label={m.assign}
            disabled={pending}
            value=""
            onChange={(event) => choose(Number(event.target.value))}
            className={`${FIELD} ml-auto !w-auto`}
          >
            <option value="">{m.assign}</option>
            {others.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
                {m.authOf(server.auth) ? ` (${m.authOf(server.auth)})` : ""}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {confirmation}
    </li>
  );
}
