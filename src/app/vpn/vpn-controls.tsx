"use client";

import { asksPassword } from "@/lib/vpn";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { Messages } from "@/i18n";
import { useMessages } from "@/i18n/provider";
import type { VpnFailure, VpnStatus, VpnView } from "@/server/vpn";
import { type Flash, useFlash } from "../flash";
import { Modal, useConfirm } from "../modal";
import { BADGE, BADGE_ALERT, BUTTON, BUTTON_PRIMARY, BUTTON_SMALL, FIELD } from "../ui";
import { stopVpn } from "../vpn-actions";
import { announceVpnChange } from "./vpn-events";

/**
 * Bringing a tunnel up changes the machine's network, and the browser then drops the requests it
 * was waiting on, the one that asked for it included. What NetworkManager did is read again instead.
 */
export async function stateAfterLostAnswer(id: number): Promise<VpnStatus["state"] | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const statuses = (await (await fetch("/api/vpns/status", { cache: "no-store" })).json()) as VpnStatus[];
      const state = statuses.find((status) => status.id === id)?.state ?? null;
      if (state !== "connecting") return state;
    } catch {
      // Still settling: the next attempt says.
    }
  }
  return null;
}

/** Said once the state is known, whatever the answer to the request became. */
export function sayLostAnswer(state: VpnStatus["state"] | null, name: string, flash: Flash, m: Messages["vpn"]) {
  if (state === "connected") flash("success", m.connected(name));
  else flash("error", m.problems.noAnswer);
}

/**
 * Cutting a tunnel changes the network too, and the browser drops the request on its way back:
 * an error would then reach the page. The state read again says whether it went down.
 */
export async function stopVpnSafely(id: number): Promise<VpnFailure | null> {
  try {
    return await stopVpn(id);
  } catch {
    const state = await stateAfterLostAnswer(id);
    return state === "off" || state === "lost" ? null : { problem: "disconnectFailed", detail: "" };
  }
}

/** Connects on a click, asking only for what is not known: a token is typed each time. */
export function VpnConnectButton({ vpn, vpns }: { vpn: VpnStatus; vpns: Pick<VpnStatus, "id" | "name" | "state">[] }) {
  const messages = useMessages();
  const m = messages.vpn;
  const flash = useFlash();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const { confirm, confirmation } = useConfirm();
  const asksHere = asksPassword(vpn.kind);
  const needsPassword = asksHere && !vpn.hasPassword;
  const needsToken = asksHere && vpn.tokenAppended;

  const say = ({ problem, detail }: VpnFailure) => flash("error", detail ? `${m.problems[problem]} (${detail})` : m.problems[problem], { seconds: 12 });

  const connect = async (typed: { password?: string; token?: string } = {}) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/vpns/${vpn.id}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(typed),
      });
      const result = (await response.json()) as { ok: true } | VpnFailure;
      if ("problem" in result) say(result);
      else flash("success", m.connected(vpn.name));
    } catch {
      sayLostAnswer(await stateAfterLostAnswer(vpn.id), vpn.name, flash, m);
    } finally {
      setBusy(false);
      router.refresh();
      announceVpnChange();
    }
  };

  const proceed = () => (needsPassword || needsToken ? setAsking(true) : void connect());

  const start = () => {
    const others = vpns.filter(({ id, state }) => id !== vpn.id && state === "connected");
    if (others.length === 0) return proceed();
    confirm({
      ...m.switchConfirm(others.map(({ name }) => name).join(", "), vpn.name),
      action: m.switchAction,
      onConfirm: async () => {
        for (const other of others) {
          const failure = await stopVpnSafely(other.id);
          if (failure) return say(failure);
        }
        announceVpnChange();
        proceed();
      },
    });
  };

  const close = () => {
    setAsking(false);
    setPassword("");
    setToken("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const typed = { password, token };
    close();
    void connect(typed);
  };

  return (
    <>
      <button type="button" disabled={busy || vpn.state === "connecting"} onClick={start} className={BUTTON_SMALL}>
        {busy ? m.connecting : vpn.state === "lost" ? m.reconnect : m.connect}
      </button>
      {asking ? (
        <Modal title={m.connectTitle(vpn.name)} onClose={close}>
          <form onSubmit={submit} className="grid gap-3">
            {needsPassword ? (
              <label className="grid gap-1">
                <span>{m.password}</span>
                <input type="password" required autoFocus autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} className={FIELD} />
              </label>
            ) : null}
            {needsToken ? (
              <label className="grid gap-1">
                <span>{m.token}</span>
                <input required autoFocus={!needsPassword} autoComplete="one-time-code" inputMode="numeric" value={token} onChange={(event) => setToken(event.target.value)} className={FIELD} />
              </label>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="submit" className={BUTTON_PRIMARY}>{m.connect}</button>
              <button type="button" onClick={close} className={BUTTON}>{messages.common.cancel}</button>
            </div>
          </form>
        </Modal>
      ) : null}
      {confirmation}
    </>
  );
}

/** Beside a server: which VPN it needs, and connecting it from there. */
export function VpnBadge({ vpnId, vpns }: { vpnId: number | null; vpns: VpnView[] }) {
  const m = useMessages().vpn;
  const vpn = vpnId === null ? null : vpns.find(({ id }) => id === vpnId);
  if (!vpn) return null;
  const up = vpn.state === "connected";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={up ? BADGE : BADGE_ALERT}>{m.required(vpn.name)} · {m.states[vpn.state]}</span>
      {up ? null : <VpnConnectButton vpn={vpn} vpns={vpns} />}
    </span>
  );
}
