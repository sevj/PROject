"use client";

import { useState, useTransition } from "react";
import { type RegistryRow, runningCount } from "@/lib/registry";
import { dockerAction, markAbandoned, openIde, openTerminal } from "./actions";
import { BUTTON, DATA } from "./ui";

export function ProjectButtons({ row }: { row: RegistryRow }) {
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
    const warning = `${running} conteneur${running > 1 ? "s tournent" : " tourne"} encore pour ce projet et ne ${running > 1 ? "seront" : "sera"} plus suivi${running > 1 ? "s" : ""}. Abandonner quand même ?`;
    if (running === 0 || window.confirm(warning)) {
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
              Terminal
            </button>
          </>
        )}
        {row.abandoned ? (
          <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => markAbandoned([row.id], false))}>
            {pending ? "Restauration…" : "Restaurer"}
          </button>
        ) : (
          <>
            {running > 0 ? (
              <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => dockerAction(row.id, "stop"))}>
                {pending ? "Docker…" : `Arrêter ${running} conteneur${running > 1 ? "s" : ""}`}
              </button>
            ) : canStart ? (
              <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => dockerAction(row.id, "up"))}>
                {pending ? "Docker…" : "Démarrer Docker"}
              </button>
            ) : null}
            <button type="button" disabled={pending} className={BUTTON} onClick={abandon}>
              Abandonner
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
