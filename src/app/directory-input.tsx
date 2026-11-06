"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import type { DirectoryListing } from "@/server/directory-browser";
import { browseDirectories, browseFiles } from "./actions";
import { BUTTON, BUTTON_PRIMARY, DATA, FIELD } from "./ui";

// Projects tend to sit side by side: the next pick starts where the last one ended.
let lastLocation = "";

function DirectoryPicker({
  start,
  root,
  extensions,
  onPick,
  onClose,
}: {
  start: string;
  root: string | undefined;
  /** Set to pick a file instead of a folder: only these are shown. */
  extensions?: string[];
  onPick: (value: string, path: string) => void;
  onClose: () => void;
}) {
  const m = useMessages();
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState(start);
  const [listing, setListing] = useState<(DirectoryListing & { target: string }) | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    let current = true;
    (extensions ? browseFiles(target, extensions) : browseDirectories(target, root)).then((result) => {
      // A slow answer must not replace the folder opened after it.
      if (current) setListing({ ...result, target });
    });
    return () => {
      current = false;
    };
    // The extensions are fixed for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, root]);

  const row = "flex min-h-10 w-full cursor-pointer items-center gap-2 border-b border-rule px-2 text-left hover:bg-sel";
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label={extensions ? m.picker.fileTitle : m.picker.title}
      className="m-auto w-[min(600px,calc(100vw-32px))] border border-rule-strong bg-panel text-ink backdrop:bg-black/60"
    >
      <div className="grid gap-3 p-5">
        <h2 className="text-[22px] font-bold tracking-tight">{extensions ? m.picker.fileTitle : m.picker.title}</h2>
        <div className={`${DATA} min-h-5 break-all text-mut`}>{listing?.path}</div>
        <div className="h-[min(360px,50vh)] overflow-y-auto border border-rule">
          {listing?.parent ? (
            <button type="button" onClick={() => setTarget(listing.parent ?? "")} className={`${row} text-mut`}>
              <span aria-hidden="true" className="font-mono">↑</span>
              {m.picker.parent}
            </button>
          ) : null}
          {/* What is looked for first: a full folder of downloads would hide it at the bottom. */}
          {listing?.files.map(({ name, path, value }) => (
            <button key={path} type="button" onClick={() => onPick(value, path)} className={`${row} font-medium text-accent`}>
              <span className="min-w-0 truncate">{name}</span>
            </button>
          ))}
          {listing?.entries.map(({ name, path }) => (
            <button key={path} type="button" onClick={() => setTarget(path)} className={row}>
              <span className="min-w-0 truncate">{name}</span>
            </button>
          ))}
          {listing && !listing.readable ? <p className="p-2 text-alert">{m.picker.unreadable}</p> : null}
          {listing?.readable && listing.entries.length === 0 && listing.files.length === 0 ? (
            <p className="p-2 text-mut">{extensions ? m.picker.noFiles(extensions.map((extension) => `.${extension}`).join(", ")) : m.picker.empty}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {extensions ? null : (
          <button
            type="button"
            // The root itself is not a sub-project.
            disabled={!listing || listing.target !== target || (root !== undefined && listing.value === "")}
            onClick={() => listing && onPick(listing.value, listing.path)}
            className={BUTTON_PRIMARY}
          >
            {m.picker.select}
          </button>
          )}
          <button type="button" onClick={onClose} className={BUTTON}>
            {m.common.cancel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * A path can be typed, or chosen by opening a folder. A browser never tells a page the
 * full path of a folder picked with its own dialog, so the server lists the folders.
 */
export function DirectoryInput({
  id,
  name,
  placeholder,
  defaultValue,
  autoFocus,
  root,
  rootField,
  onKeyDown,
}: {
  id: string;
  name: string;
  placeholder?: string;
  defaultValue?: string;
  autoFocus?: boolean;
  /** Set for a sub-project: the value is then relative to this folder. */
  root?: string;
  /** Same, when that folder is what another field of the form holds. */
  rootField?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const m = useMessages().picker;
  const input = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState<{ start: string; root: string | undefined } | null>(null);
  const [error, setError] = useState(false);

  const open = () => {
    const field = rootField ? input.current?.form?.elements.namedItem(rootField) : null;
    const currentRoot = field ? (field as HTMLInputElement).value.trim() : root;
    const relative = root !== undefined || rootField !== undefined;
    if (relative && !currentRoot) {
      setError(true);
      return;
    }
    setError(false);
    const typed = input.current?.value ?? "";
    setPicking({ start: typed || (relative ? "" : lastLocation), root: relative ? currentRoot : undefined });
  };

  return (
    <>
      <div className="flex gap-2">
        <input
          ref={input}
          id={id}
          name={name}
          required
          maxLength={1024}
          autoFocus={autoFocus}
          placeholder={placeholder}
          defaultValue={defaultValue}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={onKeyDown}
          className={`${FIELD} ${DATA} min-w-0 flex-1 placeholder:text-mut`}
        />
        <button type="button" onClick={open} className={`${BUTTON} shrink-0`}>
          {m.browse}
        </button>
      </div>
      {error ? (
        <p role="alert" className={`${DATA} pt-1 text-alert`}>
          {m.rootFirst}
        </p>
      ) : null}
      {picking ? (
        <DirectoryPicker
          start={picking.start}
          root={picking.root}
          onClose={() => setPicking(null)}
          onPick={(value, path) => {
            if (input.current) input.current.value = value;
            if (!picking.root) lastLocation = path.slice(0, path.lastIndexOf("/")) || "/";
            setPicking(null);
          }}
        />
      ) : null}
    </>
  );
}

/** A field for a file's path, filled by picking the file in a dialog. It can still be typed. */
export function FileInput({
  value,
  onChange,
  extensions,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  extensions: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const m = useMessages().picker;
  const [picking, setPicking] = useState(false);
  return (
    <>
      <div className="flex gap-2">
        <input
          required
          disabled={disabled}
          maxLength={1024}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className={`${FIELD} ${DATA} min-w-0 flex-1 placeholder:text-mut`}
        />
        {disabled ? null : (
          <button type="button" onClick={() => setPicking(true)} className={`${BUTTON_PRIMARY} shrink-0`}>
            {m.chooseFile}
          </button>
        )}
      </div>
      {picking ? (
        <DirectoryPicker
          start={value}
          root={undefined}
          extensions={extensions}
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            onChange(picked);
            setPicking(false);
          }}
        />
      ) : null}
    </>
  );
}
