"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import type { VpnState } from "@/lib/vpn";
import type { VpnStatus } from "@/server/vpn";
import { useFlash } from "../flash";
import { BUTTON_SMALL, DATA } from "../ui";
import { stopVpnSafely, VpnConnectButton } from "./vpn-controls";
import { VPN_CHANGED } from "./vpn-events";

export { announceVpnChange } from "./vpn-events";

const EVERY_MS = 10_000;

const isUp = (state: VpnState) => state === "connected" || state === "connecting";

function Dot({ state }: { state: VpnState }) {
  const color =
    state === "connected" ? "bg-ok" : state === "connecting" ? "animate-pulse bg-alert" : state === "lost" ? "bg-alert" : "border border-rule-strong";
  return <span aria-hidden className={`size-2 shrink-0 rounded-full ${color}`} />;
}

/** Every VPN, its state, and connecting or disconnecting it from any page. Nothing shows while none is declared. */
export function VpnTopbar() {
  const messages = useMessages();
  const m = messages.vpn;
  const flash = useFlash();
  const router = useRouter();
  const [vpns, setVpns] = useState<VpnStatus[]>([]);
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // What was last seen, to tell when a session ends while it is watched; null before the first look.
  const seen = useRef<Map<number, VpnState> | null>(null);

  const read = useCallback(async () => {
    try {
      const response = await fetch("/api/vpns/status");
      if (!response.ok) return;
      const next = (await response.json()) as VpnStatus[];
      const before = seen.current;
      seen.current = new Map(next.map(({ id, state }) => [id, state]));
      for (const vpn of next) {
        if (vpn.state === "lost" && before && before.get(vpn.id) !== "lost") flash("error", m.lostNotice(vpn.name));
      }
      setVpns(next);
    } catch {
      // The app is restarting: what was shown stays until the next look.
    }
  }, [flash, m]);

  useEffect(() => {
    const look = () => {
      if (document.visibilityState === "visible") void read();
    };
    look();
    const timer = setInterval(look, EVERY_MS);
    window.addEventListener(VPN_CHANGED, look);
    document.addEventListener("visibilitychange", look);
    return () => {
      clearInterval(timer);
      window.removeEventListener(VPN_CHANGED, look);
      document.removeEventListener("visibilitychange", look);
    };
  }, [read]);

  useEffect(() => {
    if (!open) return;
    // The password and token dialog lies inside the menu: a click in it keeps the menu open.
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape first closes that dialog, which then needs its menu.
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const stop = async ({ id, name }: VpnStatus, quietly = false) => {
    setStopping(id);
    try {
      const failure = await stopVpnSafely(id);
      if (failure) {
        const reason = m.problems[failure.problem];
        flash("error", failure.detail ? `${reason} (${failure.detail})` : reason);
      } else if (!quietly) {
        flash("success", m.disconnected(name));
      }
    } catch {
      flash("error", m.problems.disconnectFailed);
    } finally {
      setStopping(null);
      void read();
      router.refresh();
    }
  };

  if (vpns.length === 0) return null;

  const up = vpns.filter(({ state }) => isUp(state));
  const lost = vpns.filter(({ state }) => state === "lost");
  const summary: VpnState = up.some(({ state }) => state === "connected") ? "connected" : up.length > 0 ? "connecting" : lost.length > 0 ? "lost" : "off";
  const named = up.length > 0 ? up : lost;

  return (
    <div ref={root} className="relative ml-auto self-stretch">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="vpn-menu"
        onClick={() => setOpen((value) => !value)}
        className={`${DATA} inline-flex h-full cursor-pointer items-center gap-1.5 px-2 text-mut hover:text-ink aria-expanded:text-ink`}
      >
        <Dot state={summary} />
        <span>{m.title}</span>
        {named.length > 0 ? (
          <span className={`max-w-[220px] truncate ${up.length > 0 ? "text-ink" : "text-alert"}`}>
            {named.map(({ name }) => name).join(", ")}
            {up.length > 0 ? null : ` · ${m.states.lost}`}
          </span>
        ) : null}
        <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div
          id="vpn-menu"
          role="region"
          aria-label={m.topbar}
          className="absolute top-full right-0 z-20 grid w-[min(360px,calc(100vw-32px))] border border-rule-strong bg-panel text-[14px]"
        >
          <ul>
            {vpns.map((vpn) => (
              <li key={vpn.id} className="flex items-center gap-3 border-b border-rule px-3 py-2">
                <Dot state={vpn.state} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{vpn.name}</span>
                  <span className={`${DATA} block ${vpn.state === "unavailable" || vpn.state === "lost" ? "text-alert" : "text-mut"}`}>
                    {m.kinds[vpn.kind]} · {m.states[vpn.state]}
                    {vpn.loggedIn === false ? ` · ${m.notLoggedIn}` : null}
                  </span>
                </span>
                {isUp(vpn.state) ? (
                  <button
                    type="button"
                    disabled={stopping === vpn.id}
                    aria-label={m.disconnectOne(vpn.name)}
                    onClick={() => void stop(vpn)}
                    className={BUTTON_SMALL}
                  >
                    {m.disconnect}
                  </button>
                ) : vpn.loggedIn === false ? (
                  <Link href="/vpn" title={m.loginOnPage} onClick={() => setOpen(false)} className={BUTTON_SMALL}>
                    {m.login}
                  </Link>
                ) : vpn.state === "unavailable" ? null : (
                  <VpnConnectButton vpn={vpn} vpns={vpns} />
                )}
                {vpn.state === "lost" ? (
                  <button
                    type="button"
                    disabled={stopping === vpn.id}
                    aria-label={m.dismissOne(vpn.name)}
                    onClick={() => void stop(vpn, true)}
                    className={BUTTON_SMALL}
                  >
                    {m.dismiss}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <Link href="/vpn" onClick={() => setOpen(false)} className={`${DATA} px-3 py-2 text-mut hover:text-ink hover:underline`}>
            {m.manage} →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
