"use client";

import { useState, useTransition } from "react";
import { listProjectTree } from "@/app/actions";
import { useMessages } from "@/i18n/provider";
import { formatSize } from "@/lib/registry";
import type { TreeEntry, TreeListing } from "@/server/project-files";
import { DATA } from "../../ui";

const ROW = "flex min-h-8 w-full items-center gap-2 border-b border-rule pr-2 text-left";

function Listing({ projectId, listing, depth }: { projectId: number; listing: TreeListing; depth: number }) {
  const m = useMessages().sheet;
  return (
    <ul>
      {listing.entries.map((entry) => (
        <TreeRow key={entry.path} projectId={projectId} entry={entry} depth={depth} />
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

function TreeRow({ projectId, entry, depth }: { projectId: number; entry: TreeEntry; depth: number }) {
  const messages = useMessages();
  const m = messages.sheet;
  const [open, setOpen] = useState(false);
  // Null is a folder that could not be read; undefined is one not asked for yet.
  const [content, setContent] = useState<TreeListing | null | undefined>(undefined);
  const [, start] = useTransition();
  const indent = { paddingLeft: depth * 18 + 8 };

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
        {entry.sizeBytes === null ? null : <span className="shrink-0 text-mut">{formatSize(entry.sizeBytes, messages.size)}</span>}
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
        <span className="min-w-0 truncate">{entry.name}/</span>
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
        <Listing projectId={projectId} listing={content} depth={depth + 1} />
      )}
    </li>
  );
}

export function ProjectTree({ projectId, listing }: { projectId: number; listing: TreeListing }) {
  return (
    <div className="border-t border-rule">
      <Listing projectId={projectId} listing={listing} depth={0} />
    </div>
  );
}
