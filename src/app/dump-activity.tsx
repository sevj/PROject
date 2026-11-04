"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import { endedSince, formatDuration } from "@/lib/dumps";
import { formatSize } from "@/lib/registry";
import type { JobView } from "@/server/dumps/jobs";
import { useFlash } from "./flash";

export type DumpActivity = { jobs: JobView[]; now: number };

const DumpActivityContext = createContext<DumpActivity | null>(null);

/** What the server last said about the dumps and loads. Null until it has been asked. */
export function useDumpActivity(): DumpActivity | null {
  return useContext(DumpActivityContext);
}

/**
 * Follows the dumps and loads from every page, so that one that ends is announced wherever
 * the user is, and so that the menu can show that something is running.
 */
export function DumpActivityProvider({ children }: { children: ReactNode }) {
  const messages = useMessages();
  const flash = useFlash();
  const router = useRouter();
  const [activity, setActivity] = useState<DumpActivity | null>(null);
  const seen = useRef<Map<string, string> | null>(null);
  // The latest of each, read by the loop without restarting it.
  const latest = useRef({ messages, flash, router });
  useEffect(() => {
    latest.current = { messages, flash, router };
  });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;

    const announce = (job: JobView) => {
      const { messages: current, flash: tell } = latest.current;
      const m = current.dumps.jobs;
      const target = `${job.containerName} · ${job.database ?? current.dumps.allDatabases}`;
      const kind = job.kind === "dump" ? m.dump : m.load;
      const time = formatDuration((job.finishedAt ?? Date.now()) - job.startedAt);
      if (job.status === "done") {
        if (job.kind === "dump") tell("success", m.notice.dumpDone(target, formatSize(job.outputBytes, current.size), time));
        else if (job.warnings > 0) tell("error", m.notice.loadWarnings(target, job.warnings, time));
        else tell("success", m.notice.loadDone(target, time));
      } else if (job.status === "failed") {
        const reason = (job.error ?? "").split("\n")[0].slice(0, 200);
        tell("error", m.notice.failed(kind, target, reason));
      } else {
        tell("success", m.notice.cancelled(kind, target));
      }
    };

    const poll = async () => {
      if (!document.hidden) {
        try {
          const response = await fetch("/api/dump-jobs", { cache: "no-store" });
          if (response.ok && !stopped) {
            const data = (await response.json()) as DumpActivity;
            // The first look only sets the baseline: what ended before it is not news.
            const ended = seen.current ? endedSince(seen.current, data.jobs) : [];
            seen.current = new Map(data.jobs.map((job) => [job.id, job.status]));
            busy = data.jobs.some((job) => job.status === "running");
            setActivity(data);
            for (const job of ended) announce(job);
            // The lists of the page show the new dump, or the data that was just loaded.
            if (ended.length > 0) latest.current.router.refresh();
          }
        } catch {
          // The server restarting for a moment is not worth a message: the next look will see.
        }
      }
      if (!stopped) timer = setTimeout(poll, busy ? 1000 : 4000);
    };

    const wake = () => {
      // Back on the tab: look now rather than wait, to announce what ended meanwhile.
      if (!document.hidden && !stopped) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", wake);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  return <DumpActivityContext.Provider value={activity}>{children}</DumpActivityContext.Provider>;
}
