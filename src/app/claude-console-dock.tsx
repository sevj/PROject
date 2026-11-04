"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";
import { useMessages } from "@/i18n/provider";
import { MAX_CLAUDE_CONSOLES } from "@/lib/claude-console";
import type { StateKind } from "@/lib/docker-state";
import type { OpenConsole } from "./claude-consoles";
import { ClaudeConsolePanel } from "./projects/[id]/claude-console-panel";
import { StateGlyph } from "./projects/[id]/state-badge";
import { BUTTON, BUTTON_PRIMARY, DATA } from "./ui";

function DockedConsole({
  item,
  active,
  shown,
  frame,
  onHide,
  onEnd,
  onSession,
  onStatus,
}: {
  item: OpenConsole;
  active: boolean;
  shown: boolean;
  frame: RefObject<HTMLElement | null>;
  onHide: () => void;
  onEnd: (key: number) => void;
  onSession: (key: number, sessionId: string) => void;
  onStatus: (key: number, kind: StateKind) => void;
}) {
  const m = useMessages().sheet.claudeConsole;
  const { key } = item;
  // Stable, since the terminal watches them.
  const session = useCallback((sessionId: string) => onSession(key, sessionId), [key, onSession]);
  const status = useCallback((kind: StateKind) => onStatus(key, kind), [key, onStatus]);

  return (
    <div
      id={`claude-console-${key}`}
      role="tabpanel"
      aria-labelledby={`claude-tab-${key}`}
      className={active ? "flex min-h-0 flex-1 flex-col" : "hidden"}
    >
      <ClaudeConsolePanel
        projectId={item.projectId}
        projectName={item.projectName}
        resumeId={item.resumeId}
        shown={shown}
        frame={frame}
        controls={
          <button type="button" onClick={onHide} className={BUTTON}>
            {m.minimize}
          </button>
        }
        onSession={session}
        onStatusChange={status}
        onClose={() => onEnd(key)}
      />
    </div>
  );
}

/**
 * The consoles of this browser tab, on top of the page or reduced to a button. Everything
 * stays mounted either way: unmounting a terminal would hang up on what runs in it.
 */
export function ClaudeConsoleDock({
  consoles,
  activeKey,
  visible,
  limitReached,
  onActivate,
  onShow,
  onHide,
  onNew,
  onEnd,
  onSession,
  onStatus,
}: {
  consoles: OpenConsole[];
  activeKey: number | null;
  visible: boolean;
  limitReached: boolean;
  onActivate: (key: number) => void;
  onShow: () => void;
  onHide: () => void;
  onNew: () => void;
  onEnd: (key: number) => void;
  onSession: (key: number, sessionId: string) => void;
  onStatus: (key: number, kind: StateKind) => void;
}) {
  const m = useMessages().sheet.claudeConsole;
  const frame = useRef<HTMLElement>(null);

  // The page behind stays where it is: only the terminal scrolls while the consoles are open.
  useEffect(() => {
    if (!visible) return;
    const root = document.documentElement;
    const previous = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    // Without its scrollbar the page would grow wider and the content behind would jump.
    const scrollbar = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
    return () => {
      root.style.overflow = previous.overflow;
      root.style.paddingRight = previous.paddingRight;
    };
  }, [visible]);

  const hide = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    onHide();
  };

  return (
    <>
      {visible ? null : (
        <button type="button" onClick={onShow} className={`${BUTTON_PRIMARY} fixed right-4 bottom-4 z-40 shadow-lg`}>
          {m.show(consoles.length)}
        </button>
      )}

      <section
        ref={frame}
        role="dialog"
        aria-label={m.consoles}
        className={`fixed inset-3 z-50 flex-col overscroll-contain border border-rule-strong bg-bg max-sm:inset-0 ${visible ? "flex" : "hidden"}`}
      >
        <div className="flex items-stretch gap-2 border-b border-rule-strong pr-2">
          <div role="tablist" aria-label={m.consoles} className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
            {consoles.map((item) => {
              const active = item.key === activeKey;
              return (
                <div
                  key={item.key}
                  className={`flex shrink-0 items-center border-r border-rule ${active ? "bg-panel shadow-[inset_0_-2px_0_var(--accent)]" : ""}`}
                >
                  <button
                    type="button"
                    role="tab"
                    id={`claude-tab-${item.key}`}
                    aria-selected={active}
                    aria-controls={`claude-console-${item.key}`}
                    onClick={() => onActivate(item.key)}
                    className={`inline-flex min-h-10 items-center gap-2 pr-1 pl-3 hover:text-ink ${active ? "text-ink" : "text-mut"}`}
                  >
                    <StateGlyph kind={item.status} />
                    <span className="max-w-[200px] truncate">{item.label}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={m.endSessionOf(item.label)}
                    title={m.endSession}
                    onClick={() => onEnd(item.key)}
                    className="inline-flex size-8 items-center justify-center text-mut hover:text-ink"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              aria-label={m.newSession}
              title={m.newSession}
              disabled={consoles.length >= MAX_CLAUDE_CONSOLES}
              onClick={onNew}
              className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:text-mut disabled:hover:bg-transparent"
            >
              +
            </button>
          </div>
          {limitReached ? <span className={`${DATA} self-center text-alert`}>{m.tooMany(MAX_CLAUDE_CONSOLES)}</span> : null}
        </div>

        {consoles.map((item) => (
          <DockedConsole
            key={item.key}
            item={item}
            active={item.key === activeKey}
            shown={visible && item.key === activeKey}
            frame={frame}
            onHide={hide}
            onEnd={onEnd}
            onSession={onSession}
            onStatus={onStatus}
          />
        ))}
      </section>
    </>
  );
}
