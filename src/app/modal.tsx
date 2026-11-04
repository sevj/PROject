"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import { BUTTON, BUTTON_PRIMARY, BUTTON_PRIMARY_DANGER } from "./ui";

/** Escape closes it, like a click beside it. Focus stays inside until then. */
export function Modal({
  title,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      aria-label={title}
      // It may be declared inside a smaller or monospaced text, which it must not inherit.
      className={`m-auto ${wide ? "w-[min(1000px,calc(100vw-32px))]" : "w-[min(520px,calc(100vw-32px))]"} border border-rule-strong bg-panel font-sans text-[14px] font-normal text-ink backdrop:bg-black/60`}
    >
      <div className="grid gap-3 p-5">
        <h2 className="text-[22px] leading-tight font-bold tracking-tight break-words">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

export type Confirmation = {
  title: string;
  body?: string;
  action: string;
  /** For what cannot be undone: the safe answer then has the focus. */
  danger?: boolean;
  onConfirm: () => void;
};

function ConfirmModal({ title, body, action, danger, onConfirm, onClose }: Confirmation & { onClose: () => void }) {
  const { cancel } = useMessages().common;
  const safe = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (danger ? safe : main).current?.focus();
  }, [danger]);

  return (
    <Modal title={title} onClose={onClose}>
      {body ? <p className="text-mut">{body}</p> : null}
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          ref={main}
          type="button"
          onClick={() => {
            onClose();
            onConfirm();
          }}
          className={danger ? BUTTON_PRIMARY_DANGER : BUTTON_PRIMARY}
        >
          {action}
        </button>
        <button ref={safe} type="button" onClick={onClose} className={BUTTON}>
          {cancel}
        </button>
      </div>
    </Modal>
  );
}

/** `confirm` opens the question; `confirmation` is what to render for it, anywhere in the component. */
export function useConfirm() {
  const [request, setRequest] = useState<Confirmation | null>(null);
  return {
    confirm: setRequest,
    confirmation: request ? <ConfirmModal {...request} onClose={() => setRequest(null)} /> : null,
  };
}
