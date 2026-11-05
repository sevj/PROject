"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import type { SshAuth } from "@/lib/remote-servers";
import type { ServerInput, ServerKind, ServerView, Suggestions } from "@/server/remote-servers";
import type { VpnView } from "@/server/vpn";
import { submitServer } from "./environment-actions";
import { useFlash } from "./flash";
import { Modal } from "./modal";
import { BUTTON, BUTTON_PRIMARY, FIELD, SEGMENT_SMALL } from "./ui";

export function FormField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-[12px] text-mut">{hint}</span> : null}
    </label>
  );
}

function Choices({ id, values }: { id: string; values: string[] }) {
  return (
    <datalist id={id}>
      {values.map((value) => (
        <option key={value} value={value} />
      ))}
    </datalist>
  );
}

const AUTHS: SshAuth[] = ["agent", "alias", "key", "password"];

/** Adding or changing a server, from the catalogue or in the middle of declaring an access. */
export function ServerFormModal({
  server,
  suggestions,
  onClose,
  onSaved,
  vpns,
}: {
  server: ServerView | null;
  suggestions: Suggestions;
  vpns: VpnView[];
  onClose: () => void;
  onSaved?: (id: number) => void;
}) {
  const messages = useMessages();
  const m = messages.servers;
  const [kind, setKind] = useState<ServerKind>(server?.kind ?? "ssh");
  const [name, setName] = useState(server?.name ?? "");
  const [host, setHost] = useState(server?.host ?? "");
  const [port, setPort] = useState(server?.port === null || server?.port === undefined ? "" : String(server.port));
  const [username, setUsername] = useState(server?.username ?? "");
  const [auth, setAuth] = useState<SshAuth>(server?.auth ?? "agent");
  const [keyPath, setKeyPath] = useState(server?.keyPath ?? "");
  const [jumpHost, setJumpHost] = useState(server?.jumpHost ?? "");
  const [context, setContext] = useState(server?.context ?? "");
  const [password, setPassword] = useState("");
  const [vpnId, setVpnId] = useState(server?.vpnId ?? null);
  const flash = useFlash();
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input: ServerInput = {
      name,
      kind,
      host,
      // Not a number is sent as is, for the server to refuse it rather than to save no port.
      port: port.trim() === "" ? null : Number(port),
      username,
      auth,
      keyPath,
      jumpHost,
      context,
      vpnId,
    };
    start(async () => {
      const saved = await submitServer(server?.id ?? null, input);
      if ("problem" in saved) {
        setProblem(m.problems[saved.problem]);
        return;
      }
      if (kind === "ssh" && auth === "password" && password !== "") {
        // Apart from the action: see the route. The server itself is saved by now, so this is only said.
        const kept = await fetch(`/api/servers/${saved.id}/password`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        }).then(({ ok }) => ok, () => false);
        if (!kept) flash("error", m.passwordNotKept);
        router.refresh();
      }
      onSaved?.(saved.id);
      onClose();
    });
  };

  return (
    <Modal title={server ? m.editTitle(server.name) : m.addTitle} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label={m.kind}>
          {(["ssh", "kubernetes"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(item)} className={SEGMENT_SMALL}>
              {m.kinds[item]}
            </button>
          ))}
        </div>
        <FormField label={m.name} hint={m.nameHint}>
          <input required value={name} onChange={(event) => setName(event.target.value)} className={FIELD} />
        </FormField>

        {kind === "kubernetes" ? (
          <FormField label={m.context} hint={suggestions.contexts.length === 0 ? m.noContexts : m.contextHint}>
            <input required list="server-contexts" value={context} onChange={(event) => setContext(event.target.value)} className={FIELD} />
            <Choices id="server-contexts" values={suggestions.contexts} />
          </FormField>
        ) : (
          <>
            <FormField label={m.auth}>
              <select value={auth} onChange={(event) => setAuth(event.target.value as SshAuth)} className={FIELD}>
                {AUTHS.map((item) => (
                  <option key={item} value={item}>{m.auths[item]}</option>
                ))}
              </select>
            </FormField>
            <FormField label={auth === "alias" ? m.alias : m.host} hint={auth === "alias" ? m.aliasHint : undefined}>
              <input
                required
                list={auth === "alias" ? "server-aliases" : undefined}
                value={host}
                onChange={(event) => setHost(event.target.value)}
                className={FIELD}
              />
              <Choices id="server-aliases" values={suggestions.aliases} />
            </FormField>
            {auth === "alias" ? null : (
              <>
                <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
                  <FormField label={m.username}>
                    <input value={username} onChange={(event) => setUsername(event.target.value)} className={FIELD} />
                  </FormField>
                  <FormField label={m.port}>
                    <input inputMode="numeric" placeholder="22" value={port} onChange={(event) => setPort(event.target.value)} className={FIELD} />
                  </FormField>
                </div>
                {auth === "key" ? (
                  <FormField label={m.keyPath} hint={m.keyHint}>
                    <input required list="server-keys" value={keyPath} onChange={(event) => setKeyPath(event.target.value)} className={FIELD} />
                    <Choices id="server-keys" values={suggestions.keys} />
                  </FormField>
                ) : null}
                {auth === "password" ? (
                  <FormField label={m.password} hint={m.passwordHint}>
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder={server?.hasPassword ? m.passwordKept : undefined}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className={FIELD}
                    />
                  </FormField>
                ) : null}
                <FormField label={m.jumpHost} hint={m.jumpHint}>
                  <input value={jumpHost} onChange={(event) => setJumpHost(event.target.value)} className={FIELD} />
                </FormField>
              </>
            )}
          </>
        )}

        {vpns.length > 0 ? (
          <FormField label={m.vpn}>
            <select value={vpnId ?? ""} onChange={(event) => setVpnId(event.target.value === "" ? null : Number(event.target.value))} className={FIELD}>
              <option value="">{m.noVpn}</option>
              {vpns.map(({ id, name }) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </FormField>
        ) : null}
        {problem ? <p role="alert" className="text-alert">{problem}</p> : null}
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
            {pending ? messages.common.saving : messages.common.save}
          </button>
          <button type="button" onClick={onClose} className={BUTTON}>{messages.common.cancel}</button>
        </div>
      </form>
    </Modal>
  );
}
