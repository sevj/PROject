"use client";

import { useEffect, useState, useTransition } from "react";
import { loadCommitView, loadProjectCommits } from "@/app/actions";
import { Modal } from "@/app/modal";
import { BUTTON, DATA } from "@/app/ui";
import { useMessages } from "@/i18n/provider";
import { formatAge } from "@/lib/registry";
import type { CommitDetail, CommitFile, CommitView } from "@/server/scan/git";

const TAG = "border border-rule-strong px-1.5 text-mut";

function lineColor(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-mut";
  if (line.startsWith("+")) return "text-ok";
  if (line.startsWith("-")) return "text-alert";
  if (line.startsWith("@@")) return "text-accent";
  return line.startsWith(" ") ? "" : "text-mut";
}

/** The header repeats the name shown in the list: only what is not a change is worth keeping. */
function changesOf(patch: string): string {
  const firstHunk = patch.indexOf("\n@@ ");
  return firstHunk === -1 ? patch.slice(patch.indexOf("\n") + 1) : patch.slice(firstHunk + 1);
}

function CommitFiles({ files }: { files: CommitFile[] }) {
  const m = useMessages().gitTab;
  const [selected, setSelected] = useState(0);
  const file = files[selected];
  return (
    <div className="grid items-start gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label={m.commitFilesLabel} className="max-h-[200px] overflow-y-auto border border-rule md:max-h-[60vh]">
        {files.map((item, index) => (
          <button
            key={item.path}
            type="button"
            aria-current={index === selected ? "true" : undefined}
            onClick={() => setSelected(index)}
            className="block w-full cursor-pointer border-b border-rule px-2.5 py-1.5 text-left last:border-b-0 hover:bg-sel aria-[current=true]:bg-accent-soft"
          >
            <span className={`${DATA} block break-all`}>{item.path}</span>
            <span className={`${DATA} block text-mut`}>
              {item.insertions === null ? m.binary : `+${item.insertions} −${item.deletions}`}
            </span>
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        {file.patch === null ? (
          <p className="border border-rule p-2.5 text-mut">{m.patchUnavailable}</p>
        ) : (
          // A new key: another file starts from its top, not from where the last one was scrolled.
          <pre key={file.path} className={`${DATA} max-h-[60vh] overflow-auto border border-rule bg-field p-2.5`}>
            {changesOf(file.patch)
              .split("\n")
              .map((line, index) => (
                <span key={index} className={`block min-h-[1em] ${lineColor(line)}`}>
                  {line}
                </span>
              ))}
          </pre>
        )}
        {file.truncated ? <p className={`${DATA} pt-2 text-alert`}>{m.patchTruncated}</p> : null}
      </div>
    </div>
  );
}

function CommitModal({
  hash,
  projectId,
  subject,
  now,
  onClose,
}: {
  hash: string;
  projectId: number;
  subject: string;
  now: number;
  onClose: () => void;
}) {
  const messages = useMessages();
  const m = messages.gitTab;
  const [view, setView] = useState<CommitView | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    loadCommitView(projectId, hash).then((result) => {
      // Closed in the meantime: nothing is waiting for this anymore.
      if (current) setView(result);
    });
    return () => {
      current = false;
    };
  }, [projectId, hash]);

  return (
    <Modal title={subject} onClose={onClose} wide>
      {view === undefined ? <p className="text-mut">{messages.common.loading}</p> : null}
      {view === null ? <p className="text-alert">{m.commitUnreadable}</p> : null}
      {view ? (
        <>
          <p className={`${DATA} text-mut`}>
            {view.hash} · {view.author} · {formatAge(view.at, now, messages.age)} · {m.commitFiles(view.files.length)}
          </p>
          {view.body ? <p className="break-words whitespace-pre-wrap">{view.body}</p> : null}
          {view.isMerge ? <p className={`${DATA} text-mut`}>{m.mergeNote}</p> : null}
          {view.files.length > 0 ? <CommitFiles key={view.hash} files={view.files} /> : null}
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

export function CommitList({
  projectId,
  first,
  hasMore,
  total,
  web,
  now,
}: {
  projectId: number;
  first: CommitDetail[];
  hasMore: boolean;
  total: number | null;
  web: string | null;
  now: number;
}) {
  const messages = useMessages();
  const m = messages.gitTab;
  const [commits, setCommits] = useState(first);
  const [more, setMore] = useState(hasMore);
  const [open, setOpen] = useState<CommitDetail | null>(null);
  const [pending, start] = useTransition();

  if (commits.length === 0) return <p className="text-mut">{messages.sheet.noActivity}</p>;

  return (
    <>
      {commits.map((commit) => (
        <div
          key={commit.hash}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-rule py-[7px] last:border-b-0"
        >
          {web ? (
            <a href={`${web}/commit/${commit.hash}`} target="_blank" rel="noreferrer" className={`${DATA} text-mut hover:text-accent`}>
              {commit.hash}
            </a>
          ) : (
            <span className={`${DATA} text-mut`}>{commit.hash}</span>
          )}
          <button
            type="button"
            onClick={() => setOpen(commit)}
            aria-label={`${m.openCommit(commit.hash)} : ${commit.subject}`}
            className="cursor-pointer text-left break-words hover:text-accent"
          >
            {commit.subject}
          </button>
          <span className={`${DATA} text-right text-mut`}>{formatAge(commit.at, now, messages.age)}</span>
          <span className={`${DATA} col-start-2 flex flex-wrap items-baseline gap-x-3 text-mut`}>
            <span>{commit.author}</span>
            {commit.insertions + commit.deletions > 0 ? (
              <span>
                +{commit.insertions} −{commit.deletions}
              </span>
            ) : null}
            {commit.tags.map((tag) => (
              <span key={tag} className={TAG}>
                {tag}
              </span>
            ))}
          </span>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 pt-3">
        {more ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const page = await loadProjectCommits(projectId, first[0].hash, commits.length);
                setCommits((known) => [...known, ...page.commits]);
                setMore(page.hasMore);
              })
            }
            className={BUTTON}
          >
            {pending ? m.working : m.previousCommits}
          </button>
        ) : null}
        {total !== null ? <span className={`${DATA} text-mut`}>{m.commitsShown(commits.length, total)}</span> : null}
      </div>
      {open ? (
        <CommitModal
          key={open.hash}
          hash={open.hash}
          projectId={projectId}
          subject={open.subject}
          now={now}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
