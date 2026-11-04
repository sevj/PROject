"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";

export type Flash = (kind: "success" | "error", text: string) => void;

type Toast = { id: number; kind: "success" | "error"; text: string; leaving: boolean };

const FlashContext = createContext<Flash>(() => {});

/** To tell how an action went. What the user must correct in a form stays next to the field. */
export function useFlash(): Flash {
  return useContext(FlashContext);
}

function ToastItem({ toast, onLeave, onGone }: { toast: Toast; onLeave: () => void; onGone: () => void }) {
  const { close } = useMessages().common;
  const success = toast.kind === "success";
  return (
    <div
      role={success ? "status" : "alert"}
      className={`toast toast--${toast.kind} ${toast.leaving ? "is-leaving" : ""}`}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && toast.leaving) onGone();
      }}
    >
      <span className="toast__icon" aria-hidden="true">
        {success ? "✓" : "!"}
      </span>
      <p className="toast__text">{toast.text}</p>
      <button type="button" className="toast__close" aria-label={close} onClick={onLeave}>
        ×
      </button>
      {/* The animation is the timer: it pauses when pointed at. An error stays until it is read. */}
      {success ? <span className="toast__timer" aria-hidden="true" onAnimationEnd={onLeave} /> : null}
    </div>
  );
}

export function FlashProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const host = useRef<HTMLDivElement>(null);

  const flash = useCallback<Flash>((kind, text) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current.filter((toast) => toast.text !== text), { id, kind, text, leaving: false }]);
  }, []);

  const lastId = toasts.at(-1)?.id;
  const visible = toasts.length > 0;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // Back to the top each time: a dialog opened since then must not cover what comes next.
    if (element.matches(":popover-open")) element.hidePopover();
    if (visible) element.showPopover();
  }, [lastId, visible]);

  return (
    <FlashContext.Provider value={flash}>
      {children}
      <div ref={host} popover="manual" className="toasts">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onLeave={() =>
              setToasts((current) => current.map((item) => (item.id === toast.id ? { ...item, leaving: true } : item)))
            }
            onGone={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
          />
        ))}
      </div>
    </FlashContext.Provider>
  );
}
