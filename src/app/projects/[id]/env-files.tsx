"use client";

import { useState, useTransition } from "react";
import { revealEnvFile } from "@/app/actions";
import { useMessages } from "@/i18n/provider";
import type { EnvEntry } from "@/server/project-files";
import { BUTTON_SMALL, DATA } from "../../ui";

function EnvFile({ projectId, file }: { projectId: number; file: string }) {
  const m = useMessages().env;
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
          className={BUTTON_SMALL}
        >
          {entries ? m.hide : m.show}
        </button>
      </div>
      {failed ? <p className="pt-2 text-alert">{m.unreadable}</p> : null}
      {entries ? (
        entries.length === 0 ? (
          <p className="pt-2 text-mut">{m.noVariables}</p>
        ) : (
          <dl className="mt-2 overflow-x-auto">
            {entries.map(({ key, value }, index) => (
              <div key={`${key}-${index}`} className={`${DATA} flex gap-3 py-1 whitespace-nowrap`}>
                <dt className="text-mut">{key}</dt>
                <dd>{value || m.empty}</dd>
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
