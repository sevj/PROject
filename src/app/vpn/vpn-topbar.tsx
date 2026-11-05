"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMessages } from "@/i18n/provider";
import type { ActiveVpn } from "@/server/vpn";
import { useFlash } from "../flash";
import { BUTTON_SMALL, DATA } from "../ui";
import { stopVpn } from "../vpn-actions";

const EVERY_MS = 10_000;
const CHANGED = "pm-vpn-changed";

/** A VPN can also stop or start outside the app: the top bar looks by itself, and at once after a click. */
export const announceVpnChange = () => window.dispatchEvent(new Event(CHANGED));

/** Nothing shows while no VPN is up. */
export function VpnTopbar() {
  const messages = useMessages();
  const m = messages.vpn;
  const flash = useFlash();
  const router = useRouter();
  const [active, setActive] = useState<ActiveVpn[]>([]);
  const [stopping, setStopping] = useState<number | null>(null);

  const read = useCallback(async () => {
    try {
      const response = await fetch("/api/vpns/active");
      if (response.ok) setActive((await response.json()) as ActiveVpn[]);
    } catch {
      // The app is restarting: what was shown stays until the next look.
    }
  }, []);

  useEffect(() => {
    const look = () => {
      if (document.visibilityState === "visible") void read();
    };
    look();
    const timer = setInterval(look, EVERY_MS);
    window.addEventListener(CHANGED, look);
    document.addEventListener("visibilitychange", look);
    return () => {
      clearInterval(timer);
      window.removeEventListener(CHANGED, look);
      document.removeEventListener("visibilitychange", look);
    };
  }, [read]);

  const stop = async ({ id, name }: ActiveVpn) => {
    setStopping(id);
    try {
      const failure = await stopVpn(id);
      if (failure) {
        const reason = m.problems[failure.problem];
        flash("error", failure.detail ? `${reason} (${failure.detail})` : reason);
      } else {
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

  if (active.length === 0) return null;

  return (
    <ul aria-label={m.topbar} className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
      {active.map((vpn) => (
        <li key={vpn.id} className="flex items-center gap-2">
          <Link href="/vpn" className={`${DATA} inline-flex items-center gap-1.5 hover:underline`}>
            <span aria-hidden className={`size-2 rounded-full ${vpn.state === "connected" ? "bg-ok" : "animate-pulse bg-alert"}`} />
            <span>{vpn.name}</span>
            {vpn.state === "connected" ? null : <span className="text-mut">{m.states.connecting}</span>}
          </Link>
          <button type="button" disabled={stopping === vpn.id} title={m.disconnectOne(vpn.name)} aria-label={m.disconnectOne(vpn.name)} onClick={() => void stop(vpn)} className={BUTTON_SMALL}>
            {m.disconnect}
          </button>
        </li>
      ))}
    </ul>
  );
}
