"use client";

import { useEffect, useState, useTransition } from "react";
import { listFolderSizes, listProjectTree } from "@/app/actions";
import { useMessages } from "@/i18n/provider";
import { formatSize } from "@/lib/registry";
import type { TreeEntry, TreeListing } from "@/server/project-files";
import { DATA } from "../../ui";

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
  const [open, setOpen] = useState(false);
  // Null is a folder that could not be read; undefined is one not asked for yet.
  const [content, setContent] = useState<TreeListing | null | undefined>(undefined);
  const [, start] = useTransition();
  const indent = { paddingLeft: depth * 18 + 8 };
  const weight = size ?? entry.sizeBytes;

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
