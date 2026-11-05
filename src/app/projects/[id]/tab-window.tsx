"use client";

import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { usePageLock } from "@/app/use-page-lock";
import type { StateKind } from "@/lib/docker-state";
import { StateGlyph } from "./state-badge";

export type WindowTabHead = { key: number; label: string; status: StateKind };

/**
 * A window over the page holding terminals or logs as tabs, with a menu behind "+" to open
 * more. Every tab stays mounted, hidden while another is shown, so that each keeps running.
 */
export function TabWindow({
  label,
  addLabel,
  closeLabel,
  frame,
  tabs,
  active,
  onActivate,
  onCloseTab,
  menu,
  children,
}: {
  label: string;
  addLabel: string;
  closeLabel: (tab: string) => string;
  frame: RefObject<HTMLElement | null>;
  tabs: WindowTabHead[];
  active: number;
  onActivate: (key: number) => void;
  onCloseTab: (key: number) => void;
  /** What "+" offers; `done` closes the menu. */
  menu: (done: () => void) => ReactNode;
  /** One panel per tab, in the same order, each wrapped by `TabPanel`. */
  children: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  usePageLock();

  useEffect(() => {
    if (!adding) return;
    const away = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setAdding(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [adding]);

  return (
    <section
      ref={frame}
      role="dialog"
      aria-label={label}
      className="fixed inset-3 z-50 flex flex-col overscroll-contain border border-rule-strong bg-bg font-sans text-[14px] font-normal text-ink max-sm:inset-0"
    >
      <div className="flex items-stretch border-b border-rule-strong">
        <div role="tablist" aria-label={label} className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((tab) => {
            const selected = tab.key === active;
            return (
              <div key={tab.key} className={`flex shrink-0 items-center border-r border-rule ${selected ? "bg-panel shadow-[inset_0_-2px_0_var(--accent)]" : ""}`}>
                <button
                  type="button"
                  role="tab"
                  id={`window-tab-${tab.key}`}
                  aria-selected={selected}
                  aria-controls={`window-panel-${tab.key}`}
                  onClick={() => onActivate(tab.key)}
                  className={`inline-flex min-h-10 items-center gap-2 pr-1 pl-3 hover:text-ink ${selected ? "text-ink" : "text-mut"}`}
                >
                  <StateGlyph kind={tab.status} />
                  <span className="max-w-[260px] truncate">{tab.label}</span>
                </button>
                <button
                  type="button"
                  aria-label={closeLabel(tab.label)}
                  title={closeLabel(tab.label)}
                  onClick={() => onCloseTab(tab.key)}
                  className="inline-flex size-8 items-center justify-center text-mut hover:text-ink"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <div ref={holder} className="relative flex shrink-0">
          <button
            type="button"
            aria-label={addLabel}
            title={addLabel}
            aria-expanded={adding}
            onClick={() => setAdding((value) => !value)}
            className="inline-flex min-h-10 min-w-10 items-center justify-center border-l border-rule text-accent hover:bg-accent-soft"
          >
            +
          </button>
          {adding ? (
            <div className="absolute top-full right-0 z-10 grid max-h-[60vh] w-[min(340px,calc(100vw-32px))] overflow-y-auto border border-rule-strong bg-panel py-1 shadow-lg">
              {menu(() => setAdding(false))}
            </div>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function TabPanel({ tabKey, active, children }: { tabKey: number; active: boolean; children: ReactNode }) {
  return (
    <div id={`window-panel-${tabKey}`} role="tabpanel" aria-labelledby={`window-tab-${tabKey}`} className={active ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
      {children}
    </div>
  );
}

export const MENU_HEADING = "px-3 pt-2 pb-0.5 font-mono text-[11px] tracking-[.06em] text-mut uppercase first:pt-1";
export const MENU_ITEM = "px-3 py-1.5 text-left break-all hover:bg-accent-soft";

/** Tabs to add, close and choose, the next one after a closed one being shown. */
export function useWindowTabs<T extends { key: number; status: StateKind }>(first: Omit<T, "key">, onEmpty: () => void) {
  const next = useRef(1);
  const [tabs, setTabs] = useState<T[]>(() => [{ ...first, key: 0 } as T]);
  const [active, setActive] = useState(0);

  const add = (tab: Omit<T, "key">) => {
    const key = next.current++;
    setTabs((current) => [...current, { ...tab, key } as T]);
    setActive(key);
  };

  const close = (key: number) => {
    const rest = tabs.filter((tab) => tab.key !== key);
    if (rest.length === 0) {
      if (document.fullscreenElement) void document.exitFullscreen();
      onEmpty();
      return;
    }
    setTabs(rest);
    if (key === active) {
      const index = tabs.findIndex((tab) => tab.key === key);
      setActive(rest[Math.min(index, rest.length - 1)].key);
    }
  };

  // Stable: the panels report through it from their effects.
  const setStatus = useCallback(
    (key: number, status: StateKind) => setTabs((current) => current.map((tab) => (tab.key === key && tab.status !== status ? { ...tab, status } : tab))),
    [],
  );

  return { tabs, active, setActive, add, close, setStatus };
}
