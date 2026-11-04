"use client";

import { useState, useTransition } from "react";
import { revealEnvFile } from "@/app/actions";
import type { EnvEntry } from "@/server/project-files";

const DATA = "font-mono text-[12.5px] tabular-nums";

function EnvFile({ projectId, file }: { projectId: number; file: string }) {
  // Values stay in memory only while revealed, and are dropped when masked again.
  const [entries, setEntries] = useState<EnvEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const toggle = () => {
    if (entries) {
      setEntries(null);
      return;
    }
    start(async () => {
      const result = await revealEnvFile(projectId, file);
      setFailed(result === null);
      setEntries(result);
    });
  };

  return (
    <div className="border-b border-rule py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className={DATA}>{file}</span>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-expanded={entries !== null}
          className="min-h-9 cursor-pointer border border-rule px-3 hover:border-ink disabled:cursor-default disabled:opacity-50"
        >
          {entries ? "Masquer" : "Afficher"}
        </button>
      </div>
      {failed ? <p className="pt-2 text-alert">Ce fichier n&apos;a pas pu être lu.</p> : null}
      {entries ? (
        entries.length === 0 ? (
          <p className="pt-2 text-mut">Aucune variable.</p>
        ) : (
          <dl className="mt-2 overflow-x-auto">
            {entries.map(({ key, value }, index) => (
              <div key={`${key}-${index}`} className={`${DATA} flex gap-3 py-1 whitespace-nowrap`}>
                <dt className="text-mut">{key}</dt>
                <dd>{value || "(vide)"}</dd>
              </div>
            ))}
          </dl>
        )
      ) : null}
    </div>
  );
}

export function EnvFiles({ projectId, files }: { projectId: number; files: string[] }) {
  return (
    <>
      {files.map((file) => (
        <EnvFile key={file} projectId={projectId} file={file} />
      ))}
    </>
  );
}
