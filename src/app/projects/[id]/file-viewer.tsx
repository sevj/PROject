"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { loadBlame, readSourceFile } from "@/app/actions";
import { useMessages } from "@/i18n/provider";
import { formatAge, formatSize } from "@/lib/registry";
import type { SourceFile } from "@/server/project-files";
import type { Blame } from "@/server/scan/git";
import { BUTTON_TOGGLE_SMALL, DATA } from "../../ui";
import { CommitModal } from "./commit-list";

/** Lines changed this recently stand out in the blame column. */
const RECENT_MS = 14 * 24 * 3600 * 1000;

function useLoaded<T>(load: () => Promise<T>, keys: unknown[]): T | undefined {
  const [state, setState] = useState<{ keys: string; value: T } | undefined>(undefined);
  const key = JSON.stringify(keys);
  useEffect(() => {
    let current = true;
    load().then((value) => {
      // Another file was opened in the meantime: this answer is for nothing anymore.
      if (current) setState({ keys: key, value });
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.keys === key ? state.value : undefined;
}

function BlameCell({
  blame,
  index,
  now,
  onOpen,
}: {
  blame: Blame;
  index: number;
  now: number;
  onOpen: (hash: string) => void;
}) {
  const messages = useMessages();
  const m = messages.sheet.explorer;
  const hash = blame.lines[index];
  const commit = hash ? blame.commits[hash] : undefined;
  const starts = index === 0 || blame.lines[index - 1] !== hash;
  const recent = commit !== undefined && commit.committed && now - commit.at < RECENT_MS;
  return (
    <span className={`flex w-56 shrink-0 items-center pr-2 ${recent ? "bg-accent-soft" : ""}`}>
      {!starts || !commit ? null : commit.committed ? (
        <button
          type="button"
          onClick={() => onOpen(hash)}
          title={m.openCommit(commit.hash, commit.subject)}
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-mut hover:text-ink"
        >
          {formatAge(commit.at, now, messages.age)} · {commit.author}
        </button>
      ) : (
        <span className="truncate text-accent">{m.notCommitted}</span>
      )}
    </span>
  );
}

export function FileViewer({ projectId, path, now, hasGit }: { projectId: number; path: string; now: number; hasGit: boolean }) {
  const messages = useMessages();
  const m = messages.sheet.explorer;
  const [showBlame, setShowBlame] = useState(false);
  const [commit, setCommit] = useState<{ hash: string; subject: string } | null>(null);
  const file: SourceFile | undefined = useLoaded(() => readSourceFile(projectId, path), [projectId, path]);
  const blame = useLoaded(() => (showBlame ? loadBlame(projectId, path) : Promise.resolve(undefined)), [projectId, path, showBlame]);

  const lines = file?.kind === "text" ? file.content.replace(/\n$/, "").split("\n") : [];
  const width = String(lines.length).length;
  const tokens = file?.kind === "text" ? file.tokens : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2">
        <div className={`${DATA} min-w-0 break-all`}>
          <span className="font-medium">{path}</span>
          {file?.kind === "text" ? (
            <span className="text-mut">
              {" "}
              · {m.lines(lines.length)} · {formatSize(file.sizeBytes, messages.size)}
            </span>
          ) : null}
        </div>
        {hasGit && file?.kind === "text" ? (
          <button type="button" aria-pressed={showBlame} onClick={() => setShowBlame((on) => !on)} className={BUTTON_TOGGLE_SMALL}>
            {showBlame && blame === undefined ? m.blameLoading : m.blame}
          </button>
        ) : null}
      </div>

      {file === undefined ? <p className="pt-3 text-mut">{m.loading}</p> : null}
      {file?.kind === "binary" ? <p className="pt-3 text-mut">{m.binary}</p> : null}
      {file?.kind === "tooLarge" ? <p className="pt-3 text-mut">{m.tooLarge(formatSize(file.sizeBytes, messages.size))}</p> : null}
      {file?.kind === "env" ? <p className="pt-3 text-mut">{m.env}</p> : null}
      {file?.kind === "unreadable" ? <p className="pt-3 text-alert">{m.unreadable}</p> : null}
      {showBlame && blame === null ? <p className={`${DATA} pt-2 text-mut`}>{m.blameUnavailable}</p> : null}

      {file?.kind === "text" ? (
        <div className={`${DATA} mt-2 max-h-[75vh] overflow-auto bg-field leading-[1.55]`} style={{ tabSize: 4 }}>
          <div className="min-w-max">
            {lines.map((line, index) => {
              const chunk = showBlame && blame && index > 0 && blame.lines[index - 1] !== blame.lines[index];
              return (
                <div key={index} className={`flex ${chunk ? "border-t border-rule" : ""}`}>
                  <span className="sticky left-0 flex shrink-0 bg-field">
                    {showBlame && blame ? <BlameCell blame={blame} index={index} now={now} onOpen={(hash) => setCommit({ hash, subject: blame.commits[hash].subject })} /> : null}
                    <span className="border-r border-rule px-2 text-right text-mut select-none" style={{ minWidth: `${width + 2}ch` }}>
                      {index + 1}
                    </span>
                  </span>
                  <span className="pr-4 pl-3 whitespace-pre">
                    {tokens?.[index]
                      ? tokens[index].map(([text, light, dark], at) => (
                          <span key={at} className="code-token" style={{ "--light": light, "--dark": dark } as CSSProperties}>
                            {text}
                          </span>
                        ))
                      : line || " "}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {commit ? (
        <CommitModal hash={commit.hash} subject={commit.subject} projectId={projectId} now={now} onClose={() => setCommit(null)} />
      ) : null}
    </div>
  );
}
