"use client";

import { useEffect, useState } from "react";
import type { ContainerStat } from "@/lib/resources";
import { DATA } from "../ui";

const POLL_MS = 2000;

export type Live = { stats: ContainerStat[]; error: string | null } | null;

/** One sample every 2 seconds while the page is open and visible. Never overlaps itself. */
export function useLiveStats(): Live {
  const [live, setLive] = useState<Live>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const response = await fetch("/api/resources/stats", { cache: "no-store" });
          if (response.ok && !stopped) setLive((await response.json()) as Live);
        } catch {
          // The server restarting for a moment: the next sample will do.
        }
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return live;
}

export function Bar({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-24 shrink-0 bg-sel" aria-hidden="true">
        <span className="block h-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </span>
      <span className={`${DATA} w-28`}>{label}</span>
    </span>
  );
}

