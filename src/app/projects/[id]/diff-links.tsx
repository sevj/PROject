"use client";

import { useEffect, useState } from "react";
import { loadStashView, loadWorkingDiff } from "@/app/actions";
import { Modal } from "@/app/modal";
import { BUTTON, DATA } from "@/app/ui";
import { useMessages } from "@/i18n/provider";
import type { CommitFile } from "@/server/scan/git";
import { CommitFiles } from "./commit-list";

/** Read when it opens: what is on disk may have changed since the tab was. */
function DiffModal({
  title,
  first,
  load,
  onClose,
}: {
  title: string;
  first?: string;
  load: () => Promise<CommitFile[] | null>;
  onClose: () => void;
}) {
  const messages = useMessages();
  const m = messages.gitTab;
  const [files, setFiles] = useState<CommitFile[] | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    load().then((result) => {
      // Closed in the meantime: nothing is waiting for this anymore.
      if (current) setFiles(result);
    });
    return () => {
      current = false;
    };
    // Opened once: the modal is gone when another diff is asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title={title} onClose={onClose} wide>
      {files === undefined ? <p className="text-mut">{messages.common.loading}</p> : null}
      {files === null ? <p className="text-alert">{m.diffUnreadable}</p> : null}
      {files?.length === 0 ? <p className="text-mut">{m.diffEmpty}</p> : null}
      {files?.length ? (
        <>
          <p className={`${DATA} text-mut`}>{m.commitFiles(files.length)}</p>
          <CommitFiles files={files} first={first} />
        </>
      ) : null}
      <div>
        <button type="button" onClick={onClose} className={BUTTON}>
          {m.close}
        </button>
      </div>
    </Modal>
  );
}

export function WorkingDiffLink({ projectId, path, from }: { projectId: number; path: string; from?: string | null }) {
  const m = useMessages().gitTab;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={m.openDiff(path)}
        className={`${DATA} min-w-0 cursor-pointer text-left break-all hover:text-accent`}
      >
        {from ? `${from} → ` : ""}
        {path}
      </button>
      {open ? <DiffModal title={m.workingDiff} first={path} load={() => loadWorkingDiff(projectId)} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function StashDiffLink({ projectId, stashRef, message }: { projectId: number; stashRef: string; message: string }) {
  const m = useMessages().gitTab;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${m.openStash(stashRef)} : ${message}`}
        className="min-w-0 cursor-pointer text-left break-words hover:text-accent"
      >
        {message}
      </button>
      {open ? <DiffModal title={message} load={() => loadStashView(projectId, stashRef)} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
