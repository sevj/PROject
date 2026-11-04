"use client";

import { useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { type RegistryRow, runningCount } from "@/lib/registry";
import { dockerAction, markAbandoned, openIde, openTerminal } from "./actions";
import { BUTTON, DATA } from "./ui";

export function ProjectButtons({ row }: { row: RegistryRow }) {
  const m = useMessages().buttons;
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const running = runningCount(row);
  const canStart = row.hasCompose || row.containers.length > 0;

  const act = (action: () => Promise<string | null>) => {
    setMessage(null);
    start(async () => setMessage(await action()));
  };

  const abandon = () => {
    // Abandoning does not stop anything, and these containers would then run unseen.
    if (running === 0 || window.confirm(m.confirmAbandon(running))) {
      act(() => markAbandoned([row.id], true));
    }
  };

  if (row.missing && !row.abandoned) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {row.missing ? null : (
          <>
            <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => openIde(row.id))}>
              {row.ideLabel}
            </button>
            <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => openTerminal(row.id))}>
              {m.terminal}
            </button>
          </>
        )}
        {row.abandoned ? (
          <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => markAbandoned([row.id], false))}>
            {pending ? m.restoring : m.restore}
          </button>
        ) : (
          <>
            {running > 0 ? (
              <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => dockerAction(row.id, "stop"))}>
                {pending ? m.docker : m.stop(running)}
              </button>
            ) : canStart ? (
              <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => dockerAction(row.id, "up"))}>
                {pending ? m.docker : m.start}
              </button>
            ) : null}
            <button type="button" disabled={pending} className={BUTTON} onClick={abandon}>
              {m.abandon}
            </button>
          </>
        )}
      </div>
      {message ? (
        <p role="alert" className={`${DATA} mt-2 max-h-40 overflow-auto break-words whitespace-pre-wrap text-alert`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
