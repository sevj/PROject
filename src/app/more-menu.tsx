"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import { BUTTON_SMALL } from "./ui";

/** An entry of the menu: a plain line, orange when pointed at if it loses data. */
export const MENU_ITEM =
  "flex min-h-9 w-full cursor-pointer items-center px-3 text-left whitespace-nowrap text-ink hover:bg-sel disabled:cursor-default disabled:text-mut disabled:hover:bg-transparent";
export const MENU_ITEM_DANGER = `${MENU_ITEM} hover:text-alert disabled:hover:text-mut`;

/**
 * The rarer actions of a line, behind "…", so that only the usual ones stay in sight.
 * A click on an entry, beside the menu or Escape closes it.
 */
export function MoreMenu({ label, children }: { label?: string; children: ReactNode }) {
  const m = useMessages().common;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label ?? m.more}
        title={label ?? m.more}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
        className={`${BUTTON_SMALL} aria-expanded:bg-accent-soft`}
      >
        <span aria-hidden="true" className="leading-none tracking-[.1em]">
          ···
        </span>
      </button>
      {open ? (
        <div
          id={id}
          // A click on an entry runs it, then closes the menu.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button:not(:disabled), a")) setOpen(false);
          }}
          className="absolute top-full right-0 z-20 mt-1 grid min-w-48 border border-rule-strong bg-panel py-1 shadow-[0_12px_32px_rgb(0_0_0/45%)]"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
