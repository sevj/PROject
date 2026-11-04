"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import type { StateKind } from "@/lib/docker-state";
import { ENGINE_LABELS } from "@/lib/db-engines";
import { formatDuration, progressOf } from "@/lib/dumps";
import { formatSize } from "@/lib/registry";
import type { JobView } from "@/server/dumps/jobs";
import { cancelDumpJob, dismissDumpJob } from "./dump-actions";
import { StateGlyph } from "./projects/[id]/state-badge";
import { BUTTON, BUTTON_QUIET, CARD, DATA, SECTION_TITLE } from "./ui";

const GLYPH: Record<JobView["status"], StateKind> = {
  running: "restarting",
  done: "running",
  failed: "failed",
  cancelled: "stopped",
};

const BAR: Record<JobView["status"], string> = {
  running: "bg-accent",
  done: "bg-ok",
  failed: "bg-alert",
  cancelled: "bg-mut",
};

function Job({ job, now }: { job: JobView; now: number }) {
  const messages = useMessages();
  const m = messages.dumps.jobs;
  const { percent, rate, elapsedMs, remainingMs } = progressOf(job, now);
  const size = (bytes: number) => formatSize(bytes, messages.size);
  const label = `${job.kind === "dump" ? m.dump : m.load} · ${job.containerName} · ${job.database ?? messages.dumps.allDatabases}`;
  const [pending, setPending] = useState(false);

  return (
    <li className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold break-all">
            <StateGlyph kind={GLYPH[job.status]} />
            {label}
          </p>
          <p className={`${DATA} text-mut`}>
            {job.projectName} · {ENGINE_LABELS[job.engine]} · {m.statuses[job.status]}
          </p>
        </div>
        {job.status === "running" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPending(true);
              void cancelDumpJob(job.id).finally(() => setPending(false));
            }}
            className={BUTTON}
          >
            {m.cancel}
          </button>
        ) : (
          <button type="button" onClick={() => void dismissDumpJob(job.id)} className={BUTTON_QUIET}>
            {m.dismiss}
          </button>
        )}
      </div>

      <div
        role="progressbar"
        aria-label={m.progress(label)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="relative mt-3 h-2 overflow-hidden bg-rule"
      >
        {percent === null && job.status === "running" ? (
          <span className={`progress-indeterminate absolute inset-y-0 left-0 ${BAR.running}`} />
        ) : (
          <span
            className={`absolute inset-y-0 left-0 transition-[width] duration-300 ${BAR[job.status]}`}
            style={{ width: `${percent ?? 0}%` }}
          />
        )}
      </div>

      <p className={`${DATA} mt-2 flex flex-wrap gap-x-4 gap-y-1`}>
        {percent === null ? null : <span className="font-semibold">{percent}%</span>}
        <span>
          {job.totalBytes === null
            ? m.read(size(job.processedBytes))
            : m.of(size(job.processedBytes), size(job.totalBytes), job.estimated)}
        </span>
        {job.kind === "dump" && job.outputBytes > 0 ? <span className="text-mut">{m.written(size(job.outputBytes))}</span> : null}
        {job.status === "running" && rate > 0 ? <span className="text-mut">{m.speed(size(rate))}</span> : null}
        {remainingMs !== null ? <span className="text-mut">{m.remaining(formatDuration(remainingMs))}</span> : null}
        <span className="text-mut">{m.elapsed(formatDuration(elapsedMs))}</span>
      </p>

      {job.error ? (
        <p role="alert" className={`${DATA} mt-2 max-h-40 overflow-auto break-words whitespace-pre-wrap text-alert`}>
          {job.error}
        </p>
      ) : null}
      {job.status === "done" && job.warnings > 0 ? (
        <div className={`${DATA} mt-2 text-alert`}>
          <p>{m.warnings(job.warnings)}</p>
          {job.detail ? <p className="mt-1 max-h-32 overflow-auto break-words whitespace-pre-wrap text-mut">{job.detail}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Asks the server how far the dumps and loads have got, every second while one runs.
 * The lists of the page are refreshed the moment one ends, so that its result appears.
 */
export function DumpJobs({ initial, initialNow }: { initial: JobView[]; initialNow: number }) {
  const m = useMessages().dumps.jobs;
  const router = useRouter();
  const [state, setState] = useState({ jobs: initial, now: initialNow });
  const seen = useRef(new Map(initial.map((job) => [job.id, job.status])));
  const busy = useRef(initial.some((job) => job.status === "running"));

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const response = await fetch("/api/dump-jobs", { cache: "no-store" });
          if (response.ok && !stopped) {
            const data = (await response.json()) as { jobs: JobView[]; now: number };
            const ended = data.jobs.some((job) => seen.current.get(job.id) === "running" && job.status !== "running");
            seen.current = new Map(data.jobs.map((job) => [job.id, job.status]));
            busy.current = data.jobs.some((job) => job.status === "running");
            setState({ jobs: data.jobs, now: data.now });
            if (ended) router.refresh();
          }
        } catch {
          // The server restarting for a moment is not worth a message: the next poll will see.
        }
      }
      // Quick while something runs, and only a glance now and then when nothing does.
      if (!stopped) timer = setTimeout(poll, busy.current ? 1000 : 4000);
    };
    timer = setTimeout(poll, busy.current ? 1000 : 4000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [router]);

  if (state.jobs.length === 0) return null;
  return (
    <section aria-label={m.title} className="grid gap-3">
      <h2 className={SECTION_TITLE}>{m.title}</h2>
      <ul className="grid gap-3">
        {state.jobs.map((job) => (
          <Job key={job.id} job={job} now={state.now} />
        ))}
      </ul>
    </section>
  );
}
