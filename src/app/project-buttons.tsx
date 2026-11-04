"use client";

import { useState, useTransition } from "react";
import { type RegistryRow, runningCount } from "@/lib/registry";
import { dockerAction, hideProject, openIde, openTerminal } from "./actions";
import { BUTTON, DATA } from "./ui";

export function ProjectButtons({ row, canHide = false }: { row: RegistryRow; canHide?: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const running = runningCount(row);
  const canStart = row.hasCompose || row.containers.length > 0;

  const act = (action: () => Promise<string | null>) => {
    setMessage(null);
    start(async () => setMessage(await action()));
  };

  if (row.missing) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => openIde(row.id))}>
          {row.ideLabel}
        </button>
        <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => openTerminal(row.id))}>
          Terminal
        </button>
        {running > 0 ? (
          <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => dockerAction(row.id, "stop"))}>
            {pending ? "Docker…" : `Arrêter ${running} conteneur${running > 1 ? "s" : ""}`}
          </button>
        ) : canStart ? (
          <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => dockerAction(row.id, "up"))}>
            {pending ? "Docker…" : "Démarrer Docker"}
          </button>
        ) : null}
        {canHide ? (
          <button type="button" disabled={pending} className={BUTTON} onClick={() => act(() => hideProject(row.id))}>
            Masquer
          </button>
        ) : null}
      </div>
      {message ? (
        <p role="alert" className={`${DATA} mt-2 max-h-40 overflow-auto break-words whitespace-pre-wrap text-alert`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
