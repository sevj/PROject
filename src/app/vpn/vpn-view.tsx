"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import type { VpnFailure, VpnInput, VpnKind, VpnView as Vpn } from "@/server/vpn";
import { useFlash } from "../flash";
import { PlusIcon } from "../icons";
import { Modal, useConfirm } from "../modal";
import { MENU_ITEM_DANGER, MoreMenu } from "../more-menu";
import { TerminalPanel } from "../projects/[id]/terminal-panel";
import { FormField } from "../server-form";
import { BADGE, BADGE_ALERT, BUTTON, BUTTON_PRIMARY, BUTTON_SMALL, CARD, CHECKBOX, DATA, FIELD, PAGE_TITLE, SEGMENT_SMALL } from "../ui";
import { openNordLogin, removeVpn, stopVpn } from "../vpn-actions";
import { VpnConnectButton } from "./vpn-controls";
import { announceVpnChange } from "./vpn-topbar";

function VpnFormModal({ vpn, files, onClose }: { vpn: Vpn | null; files: string[]; onClose: () => void }) {
  const messages = useMessages();
  const m = messages.vpn;
  const router = useRouter();
  const [kind, setKind] = useState<VpnKind>(vpn?.kind ?? "sudo_openvpn");
  const [name, setName] = useState(vpn?.name ?? "");
  const [configPath, setConfigPath] = useState(vpn?.configPath ?? "");
  const [username, setUsername] = useState(vpn?.username ?? "");
  const [password, setPassword] = useState("");
  const [tokenAppended, setTokenAppended] = useState(vpn?.tokenAppended ?? false);
  const [gateway, setGateway] = useState(vpn?.gateway ?? "");
  const [organization, setOrganization] = useState(vpn?.organization ?? "");
  const [routes, setRoutes] = useState(vpn?.routes ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input: VpnInput = { name, kind, configPath, username, password, tokenAppended, gateway, organization, routes };
    setPending(true);
    try {
      const response = await fetch(vpn ? `/api/vpns/${vpn.id}` : "/api/vpns", {
        method: vpn ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      // A crash of the app answers with a page: it must not read as a refusal from NetworkManager.
      if (!response.ok) {
        setProblem(m.problems.saveFailed(response.status));
        return;
      }
      const saved = (await response.json()) as { id: number } | VpnFailure;
      if ("problem" in saved) {
        setProblem(saved.detail ? `${m.problems[saved.problem]} (${saved.detail})` : m.problems[saved.problem]);
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setProblem(m.problems.saveFailed(null));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal title={vpn ? m.editTitle(vpn.name) : m.addTitle} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="grid gap-3">
        {vpn ? null : (
          <div className="flex flex-wrap gap-1" role="group">
            {(["sudo_openvpn", "openvpn", "globalprotect", "nordlayer"] as const).map((item) => (
              <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(item)} className={SEGMENT_SMALL}>
                {m.kinds[item]}
              </button>
            ))}
          </div>
        )}
        <FormField label={m.name}>
          <input required value={name} onChange={(event) => setName(event.target.value)} className={FIELD} />
        </FormField>
        {kind === "globalprotect" ? (
          <>
            <p className="text-[12px] text-mut">{m.gpHint}</p>
            <FormField label={m.portal} hint={m.portalHint}>
              <input required placeholder="vpn.example.com" value={gateway} onChange={(event) => setGateway(event.target.value)} className={FIELD} />
            </FormField>
            <FormField label={m.routes} hint={m.routesHint}>
              <input placeholder="192.168.200.0/24" value={routes} onChange={(event) => setRoutes(event.target.value)} className={FIELD} />
            </FormField>
          </>
        ) : kind !== "nordlayer" ? (
          <>
            {kind === "sudo_openvpn" ? <p className="text-[12px] text-mut">{m.sudoHint}</p> : null}
            <FormField label={m.configPath} hint={kind === "sudo_openvpn" ? m.sudoConfigHint : m.configHint}>
              <input required disabled={vpn !== null} list="vpn-files" placeholder="~/Projects/villette.ovpn" value={configPath} onChange={(event) => setConfigPath(event.target.value)} className={FIELD} />
              <datalist id="vpn-files">
                {files.map((file) => (
                  <option key={file} value={file} />
                ))}
              </datalist>
            </FormField>
            <FormField label={m.username}>
              <input autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} className={FIELD} />
            </FormField>
            <FormField label={m.password} hint={m.passwordHint}>
              <input type="password" autoComplete="new-password" placeholder={vpn?.hasPassword ? m.passwordKept : undefined} value={password} onChange={(event) => setPassword(event.target.value)} className={FIELD} />
            </FormField>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" className={`${CHECKBOX} mt-0.5 shrink-0`} checked={tokenAppended} onChange={(event) => setTokenAppended(event.target.checked)} />
              <span>
                {m.tokenAppended}
                <span className="block text-[12px] text-mut">{m.tokenAppendedHint}</span>
              </span>
            </label>
          </>
        ) : (
          <>
          <FormField label={m.gateway} hint={m.gatewayHint}>
            <input required value={gateway} onChange={(event) => setGateway(event.target.value)} className={FIELD} />
          </FormField>
            <FormField label={m.organization} hint={m.organizationHint}>
              <input value={organization} placeholder="adimeo_fr" onChange={(event) => setOrganization(event.target.value)} className={FIELD} />
            </FormField>
          </>
        )}
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

function VpnRow({ vpn, vpns, files }: { vpn: Vpn; vpns: Vpn[]; files: string[] }) {
  const messages = useMessages();
  const m = messages.vpn;
  const flash = useFlash();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [login, setLogin] = useState(false);
  const [pending, start] = useTransition();
  const { confirm, confirmation } = useConfirm();
  const up = vpn.state === "connected" || vpn.state === "connecting";
  const say = (failure: VpnFailure | null) => {
    if (failure) flash("error", failure.detail ? `${m.problems[failure.problem]} (${failure.detail})` : m.problems[failure.problem]);
  };

  return (
    <li className="grid gap-1 border-b border-rule py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 className="inline font-semibold break-words">{vpn.name}</h2> <span className={BADGE}>{m.kinds[vpn.kind]}</span>{" "}
          <span className={vpn.state === "unavailable" || vpn.state === "lost" ? BADGE_ALERT : BADGE}>{m.states[vpn.state]}</span>
          {vpn.loggedIn === false ? <> <span className={BADGE_ALERT}>{m.notLoggedIn}</span></> : null}
          <p className={`${DATA} break-all text-mut`}>
            {[vpn.configPath, vpn.username, vpn.organization, vpn.gateway, vpn.routes, vpn.hasPassword ? m.passwordKept : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vpn.loggedIn === false ? <button type="button" onClick={() => setLogin(true)} className={BUTTON_SMALL}>{m.login}</button> : null}
          {up ? (
            <button type="button" disabled={pending} onClick={() =>
                start(async () => {
                  say(await stopVpn(vpn.id));
                  announceVpnChange();
                })
              } className={BUTTON_SMALL}>{m.disconnect}</button>
          ) : (
            <VpnConnectButton vpn={vpn} vpns={vpns} />
          )}
          {vpn.state === "lost" ? (
            <button type="button" disabled={pending} aria-label={m.dismissOne(vpn.name)} onClick={() =>
                start(async () => {
                  say(await stopVpn(vpn.id));
                  announceVpnChange();
                })
              } className={BUTTON_SMALL}>{m.dismiss}</button>
          ) : null}
          <button type="button" onClick={() => setEditing(true)} className={BUTTON_SMALL}>{m.edit}</button>
          <MoreMenu>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              confirm({
                title: m.deleteTitle(vpn.name),
                body: !vpn.setup ? m.deleteBody : vpn.kind === "globalprotect" ? m.deleteRuleBody(vpn.setup.removal) : m.deleteSudoBody(vpn.setup.removal),
                action: m.delete,
                danger: true,
                onConfirm: () => start(async () => say(await removeVpn(vpn.id))),
              })
            }
            className={MENU_ITEM_DANGER}
          >
            {m.delete}
          </button>
          </MoreMenu>
        </div>
      </div>
      {vpn.setup ? (
        <details open={!vpn.setup.ready} className="mt-1">
          <summary className={`cursor-pointer text-[12px] ${vpn.setup.ready ? "text-mut" : "text-alert"}`}>
            {vpn.setup.ready ? m.setupReady : m.setupNeeded}
          </summary>
          <p className="pt-1 text-[12px] text-mut">{m.setupHint}</p>
          <pre className={`${DATA} mt-1 overflow-auto border border-rule bg-field p-2 whitespace-pre-wrap break-all`}>{vpn.setup.commands.join("\n")}</pre>
        </details>
      ) : null}
      {vpn.usedBy.length > 0 ? <p className="text-[12px] text-mut">{m.usedBy} {vpn.usedBy.join(", ")}</p> : null}
      {editing ? <VpnFormModal vpn={vpn} files={files} onClose={() => setEditing(false)} /> : null}
      {login ? (
        <TerminalPanel
          title={m.loginTitle}
          open={() => openNordLogin(vpn.id)}
          reconnectLabel={messages.sheet.console.reconnect}
          onClose={() => {
            setLogin(false);
            router.refresh();
          }}
        />
      ) : null}
      {confirmation}
    </li>
  );
}

export function VpnView({ vpns, files }: { vpns: Vpn[]; files: string[] }) {
  const m = useMessages().vpn;
  const [adding, setAdding] = useState(false);
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className={PAGE_TITLE}>{m.title}</h1>
        <button type="button" onClick={() => setAdding(true)} className={BUTTON_PRIMARY}>
          <PlusIcon />
          {m.add}
        </button>
      </div>
      <div className={CARD}>
        {vpns.length === 0 ? <p className="text-mut">{m.none}</p> : null}
        <ul>
          {vpns.map((vpn) => (
            <VpnRow key={vpn.id} vpn={vpn} vpns={vpns} files={files} />
          ))}
        </ul>
      </div>
      {adding ? <VpnFormModal vpn={null} files={files} onClose={() => setAdding(false)} /> : null}
    </section>
  );
}
