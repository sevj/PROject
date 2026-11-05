"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { controlContainers, dismissCompose, startCompose } from "@/app/actions";
import { DumpModal, LoadModal } from "@/app/dump-modals";
import type { DumpRow } from "@/lib/dumps";
import type { DatabaseTarget } from "@/server/dumps/containers";
import { ConsolePanel } from "./console-panel";
import { LogsPanel } from "./logs-panel";
import { BUTTON, BUTTON_PRIMARY, BUTTON_SMALL, DATA } from "@/app/ui";
import { useFlash } from "@/app/flash";
import { useConfirm } from "@/app/modal";
import type { ComposeAction, ComposeJob } from "@/server/compose-jobs";
import { useMessages } from "@/i18n/provider";
import type { ContainerAction } from "@/server/project-actions";

function useControl(projectId: number) {
  const m = useMessages().sheet.dockerTab;
  const flash = useFlash();
  const [pending, start] = useTransition();
  const run = (action: ContainerAction, containerId?: string) => {
    start(async () => {
      const error = await controlContainers(projectId, action, containerId);
      if (error) flash("error", error);
      else flash("success", m.done[action]);
    });
  };
  return { pending, run };
}

function Feedback({ pending }: { pending: boolean }) {
  const m = useMessages().sheet.dockerTab;
  return pending ? (
    <span role="status" className={`${DATA} text-mut`}>
      {m.working}
    </span>
  ) : null;
}

export function ContainerControls({
  projectId,
  containerId,
  containerName,
  running,
  canOpenConsole,
  database,
}: {
  projectId: number;
  containerId: string;
  containerName: string;
  running: boolean;
  /** Running, and not paused: a paused container cannot start a shell. */
  canOpenConsole: boolean;
  /** Set when this container is a database: it can be dumped, and loaded into. */
  database?: { target: DatabaseTarget; dumps: DumpRow[] };
}) {
  const messages = useMessages().sheet;
  const m = messages.dockerTab;
  const { pending, run } = useControl(projectId);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [dialog, setDialog] = useState<"dump" | "load" | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setLogsOpen(true)} className={BUTTON}>
        {messages.logs.open}
      </button>
      {logsOpen ? (
        <LogsPanel
          projectId={projectId}
          containerId={containerId}
          containerName={containerName}
          onClose={() => setLogsOpen(false)}
        />
      ) : null}
      {canOpenConsole ? (
        <button type="button" onClick={() => setConsoleOpen(true)} className={BUTTON}>
          {messages.console.open}
        </button>
      ) : null}
      {database && running ? (
        <>
          <button type="button" onClick={() => setDialog("dump")} className={BUTTON}>
            {m.dump}
          </button>
          <button type="button" onClick={() => setDialog("load")} className={BUTTON}>
            {m.loadDump}
          </button>
        </>
      ) : null}
      {database && dialog === "dump" ? <DumpModal target={database.target} onClose={() => setDialog(null)} /> : null}
      {database && dialog === "load" ? (
        <LoadModal dumps={database.dumps} targets={[database.target]} targetId={database.target.id} onClose={() => setDialog(null)} />
      ) : null}
      {consoleOpen ? (
        <ConsolePanel
          projectId={projectId}
          containerId={containerId}
          containerName={containerName}
          onClose={() => setConsoleOpen(false)}
        />
      ) : null}
      {running ? (
        <>
          <button type="button" disabled={pending} onClick={() => run("stop", containerId)} className={BUTTON}>
            {m.stop}
          </button>
          <button type="button" disabled={pending} onClick={() => run("restart", containerId)} className={BUTTON}>
            {m.restart}
          </button>
        </>
      ) : (
        <button type="button" disabled={pending} onClick={() => run("start", containerId)} className={BUTTON_PRIMARY}>
          {m.start}
        </button>
      )}
      <Feedback pending={pending} />
    </div>
  );
}

export function ProjectControls({
  projectId,
  running,
  total,
  canCreate,
  hasCompose,
  composeJob,
}: {
  projectId: number;
  running: number;
  total: number;
  /** A Compose file exists to create the containers from. */
  canCreate: boolean;
  /** One is here in the project, which is what building and pulling read. */
  hasCompose: boolean;
  composeJob: ComposeJob | null;
}) {
  const m = useMessages().sheet.dockerTab;
  const router = useRouter();
  const flash = useFlash();
  const { pending, run } = useControl(projectId);
  const [asking, startAsking] = useTransition();
  const { confirm, confirmation } = useConfirm();
  const composing = composeJob?.running === true;
  const [logsOpen, setLogsOpen] = useState(false);
  const sheet = useMessages().sheet;

  const ask = (action: ComposeAction) =>
    confirm({
      ...m.confirmCompose[action],
      action: m.compose[action],
      onConfirm: () =>
        startAsking(async () => {
          const error = await startCompose(projectId, action);
          if (error) flash("error", error);
          router.refresh();
        }),
    });

  const followed = useRef<number | null>(null);
  useEffect(() => {
    if (!composeJob) return;
    if (composeJob.running) {
      followed.current = composeJob.id;
      const timer = setInterval(() => router.refresh(), 2000);
      return () => clearInterval(timer);
    }
    if (followed.current !== composeJob.id) return;
    followed.current = null;
    if (!composeJob.error) flash("success", m.composeDone[composeJob.action]);
  }, [composeJob, router, flash, m]);

  return (
    <div className="grid w-full justify-items-end gap-2">
    <div className="flex flex-wrap items-center justify-end gap-2">
      {total > 1 ? (
        <button type="button" onClick={() => setLogsOpen(true)} className={BUTTON}>
          {sheet.logs.openAll}
        </button>
      ) : null}
      {logsOpen ? <LogsPanel projectId={projectId} containerName={sheet.logs.allContainers} onClose={() => setLogsOpen(false)} /> : null}
      {hasCompose ? (
        <>
          <button type="button" disabled={pending || asking || composing} onClick={() => ask("build")} title={m.composeHint.build} className={BUTTON}>
            {m.compose.build}
          </button>
          <button type="button" disabled={pending || asking || composing} onClick={() => ask("pull")} title={m.composeHint.pull} className={BUTTON}>
            {m.compose.pull}
          </button>
        </>
      ) : null}
      {total === 0 ? (
        canCreate ? (
          <button type="button" disabled={pending} onClick={() => run("start")} className={BUTTON_PRIMARY}>
            {m.createStart}
          </button>
        ) : null
      ) : (
        <>
          {running < total ? (
            <button type="button" disabled={pending} onClick={() => run("start")} className={BUTTON_PRIMARY}>
              {m.startAll}
            </button>
          ) : null}
          {running > 0 ? (
            <>
              <button type="button" disabled={pending} onClick={() => run("stop")} className={BUTTON}>
                {m.stopAll}
              </button>
              <button type="button" disabled={pending} onClick={() => run("restart")} className={BUTTON}>
                {m.restartAll}
              </button>
            </>
          ) : null}
        </>
      )}
      <button type="button" disabled={pending} onClick={() => router.refresh()} className={BUTTON}>
        {m.refresh}
      </button>
      <Feedback pending={pending} />
    </div>
    {composeJob && (composeJob.running || composeJob.error) ? (
      <div className="grid w-full gap-2 border border-rule p-2.5 text-left">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span role="status" className={`${DATA} ${composeJob.error ? "text-alert" : ""}`}>
            {composeJob.error ? m.composeFailed[composeJob.action] : m.composeRunning[composeJob.action]}
          </span>
          {composeJob.error ? (
            <button type="button" onClick={() => void dismissCompose(projectId)} className={BUTTON_SMALL}>
              {m.composeDismiss}
            </button>
          ) : null}
        </div>
        <pre className={`${DATA} max-h-[240px] overflow-auto bg-field p-2.5 break-words whitespace-pre-wrap`}>
          {composeJob.output.slice(-40).join("\n") || composeJob.error}
        </pre>
      </div>
    ) : null}
    {confirmation}
    </div>
  );
}
