"use client";

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { listFolderSizes, listProjectTree } from "@/app/actions";
import { useMessages } from "@/i18n/provider";
import { formatSize } from "@/lib/registry";
import type { TreeEntry, TreeListing } from "@/server/project-files";
import { CARD, DATA, SECTION_TITLE } from "../../ui";
import { FileViewer } from "./file-viewer";

/** Set by the explorer: a file of the tree opens there. */
const Opener = createContext<{ selected: string | null; open: (path: string) => void } | null>(null);

const ROW = "flex min-h-8 w-full items-center gap-2 border-b border-rule pr-2 text-left";

function Listing({ projectId, listing, relative, depth }: { projectId: number; listing: TreeListing; relative: string; depth: number }) {
  const m = useMessages().sheet;
  // Weighing a folder can take seconds: the names do not wait for it.
  const [sizes, setSizes] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let current = true;
    void listFolderSizes(projectId, relative).then((result) => {
      if (current) setSizes(result);
    }, () => undefined);
    return () => {
      current = false;
    };
  }, [projectId, relative]);
  return (
    <ul>
      {listing.entries.map((entry) => (
        <TreeRow key={entry.path} projectId={projectId} entry={entry} depth={depth} size={sizes?.[entry.name] ?? null} />
      ))}
      {listing.entries.length === 0 ? (
        <li className={`${ROW} text-mut`} style={{ paddingLeft: depth * 18 + 8 }}>
          {m.emptyFolder}
        </li>
      ) : null}
      {listing.hiddenCount > 0 ? (
        <li className={`${ROW} text-mut`} style={{ paddingLeft: depth * 18 + 8 }}>
          {m.moreEntries(listing.hiddenCount)}
        </li>
      ) : null}
    </ul>
  );
}

function TreeRow({ projectId, entry, depth, size }: { projectId: number; entry: TreeEntry; depth: number; size: number | null }) {
  const messages = useMessages();
  const m = messages.sheet;
  const opener = useContext(Opener);
  // Unfolds down to the file opened from the address.
  const [open, setOpen] = useState(() => entry.kind === "directory" && (opener?.selected?.startsWith(`${entry.path}/`) ?? false));
  // Null is a folder that could not be read; undefined is one not asked for yet.
  const [content, setContent] = useState<TreeListing | null | undefined>(undefined);
  const [, start] = useTransition();
  useEffect(() => {
    if (!open || content !== undefined) return;
    let current = true;
    void listProjectTree(projectId, entry.path).then((listing) => {
      if (current) setContent(listing);
    });
    return () => {
      current = false;
    };
    // Only the first unfolding: a toggle asks for the content itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const indent = { paddingLeft: depth * 18 + 8 };
  const weight = size ?? entry.sizeBytes;

  if (entry.kind === "file" && opener) {
    return (
      <li>
        <button
          type="button"
          onClick={() => opener.open(entry.path)}
          aria-current={opener.selected === entry.path ? "true" : undefined}
          className={`${ROW} ${DATA} cursor-pointer hover:bg-sel aria-[current=true]:bg-sel aria-[current=true]:font-medium`}
          style={indent}
        >
          <span aria-hidden="true" className="w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          {weight === null ? null : <span className="shrink-0 text-mut">{formatSize(weight, messages.size)}</span>}
        </button>
      </li>
    );
  }

  if (entry.kind !== "directory" || entry.opaque) {
    const quiet = entry.opaque || entry.kind === "link";
    return (
      <li className={`${ROW} ${DATA} ${quiet ? "text-mut" : ""}`} style={indent}>
        {/* Lines names up with the folders, which have a chevron. */}
        <span aria-hidden="true" className="w-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={entry.opaque ? m.notOpened : undefined}>
          {entry.name}
          {entry.kind === "directory" ? "/" : entry.kind === "link" ? " →" : ""}
        </span>
        {weight === null ? null : <span className="shrink-0 text-mut">{formatSize(weight, messages.size)}</span>}
      </li>
    );
  }

  const toggle = () => {
    setOpen((current) => !current);
    if (content === undefined) start(async () => setContent(await listProjectTree(projectId, entry.path)));
  };

  return (
    <li>
      <button type="button" aria-expanded={open} onClick={toggle} className={`${ROW} ${DATA} cursor-pointer font-medium hover:bg-sel`} style={indent}>
        <span aria-hidden="true" className="w-3 shrink-0 text-mut">
          {open ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1 truncate">{entry.name}/</span>
        {weight === null ? null : <span className="shrink-0 font-normal text-mut">{formatSize(weight, messages.size)}</span>}
      </button>
      {!open ? null : content === undefined ? (
        <p className={`${ROW} text-mut`} style={{ paddingLeft: (depth + 1) * 18 + 8 }}>
          {messages.common.loading}
        </p>
      ) : content === null ? (
        <p className={`${ROW} text-alert`} style={{ paddingLeft: (depth + 1) * 18 + 8 }}>
          {m.unreadableFolder}
        </p>
      ) : (
        <Listing projectId={projectId} listing={content} relative={entry.path} depth={depth + 1} />
      )}
    </li>
  );
}

export function ProjectTree({ projectId, listing }: { projectId: number; listing: TreeListing }) {
  return (
    <div className="border-t border-rule">
      <Listing projectId={projectId} listing={listing} relative="." depth={0} />
    </div>
  );
}

/** The tree beside the file it opens, read-only. The open file is kept in the address, to come back to it. */
export function ProjectExplorer({
  projectId,
  listing,
  initialFile,
  now,
  hasGit,
}: {
  projectId: number;
  listing: TreeListing;
  initialFile: string | null;
  now: number;
  hasGit: boolean;
}) {
  const m = useMessages().sheet.explorer;
  const [selected, setSelected] = useState<string | null>(initialFile);
  const open = (path: string) => {
    setSelected(path);
    const url = new URL(window.location.href);
    url.searchParams.set("file", path);
    window.history.replaceState(null, "", url);
  };
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(260px,1fr)_minmax(0,2.6fr)]">
      <section className={`${CARD} lg:sticky lg:top-4`}>
        <h2 className={`${SECTION_TITLE} mb-2`}>{m.files}</h2>
        <div className="max-h-[75vh] overflow-y-auto">
          <Opener.Provider value={{ selected, open }}>
            <ProjectTree projectId={projectId} listing={listing} />
          </Opener.Provider>
        </div>
      </section>
      <section className={`${CARD} min-w-0`}>
        {selected ? <FileViewer key={selected} projectId={projectId} path={selected} now={now} hasGit={hasGit} /> : <p className="text-mut">{m.pick}</p>}
      </section>
    </div>
  );
}
