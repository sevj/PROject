"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { controlContainers } from "@/app/actions";
import { ConsolePanel } from "./console-panel";
import { BUTTON, BUTTON_PRIMARY, DATA } from "@/app/ui";
import { useMessages } from "@/i18n/provider";
import type { ContainerAction } from "@/server/project-actions";

function useControl(projectId: number) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (action: ContainerAction, containerId?: string) => {
    setError(null);
    start(async () => setError(await controlContainers(projectId, action, containerId)));
  };
  return { error, pending, run };
}

function Feedback({ pending, error }: { pending: boolean; error: string | null }) {
  const m = useMessages().sheet.dockerTab;
  return (
    <>
      {pending ? (
        <span role="status" className={`${DATA} text-mut`}>
          {m.working}
        </span>
      ) : null}
      {error ? (
        <p role="alert" className={`${DATA} basis-full max-h-40 overflow-auto break-words whitespace-pre-wrap text-alert`}>
          {error}
        </p>
      ) : null}
    </>
  );
}

export function ContainerControls({
  projectId,
  containerId,
  containerName,
  running,
  canOpenConsole,
}: {
  projectId: number;
  containerId: string;
  containerName: string;
  running: boolean;
  /** Running, and not paused: a paused container cannot start a shell. */
  canOpenConsole: boolean;
}) {
  const messages = useMessages().sheet;
  const m = messages.dockerTab;
  const { error, pending, run } = useControl(projectId);
  const [consoleOpen, setConsoleOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canOpenConsole ? (
        <button type="button" onClick={() => setConsoleOpen(true)} className={BUTTON}>
          {messages.console.open}
        </button>
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
      <Feedback pending={pending} error={error} />
    </div>
  );
}

export function ProjectControls({
  projectId,
  running,
  total,
  canCreate,
}: {
  projectId: number;
  running: number;
  total: number;
  /** A Compose file exists to create the containers from. */
  canCreate: boolean;
}) {
  const m = useMessages().sheet.dockerTab;
  const router = useRouter();
  const { error, pending, run } = useControl(projectId);
  return (
    <div className="flex flex-wrap items-center gap-2">
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
      <Feedback pending={pending} error={error} />
    </div>
  );
}
