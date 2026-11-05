"use client";

import { createContext, useContext, useState } from "react";
import { AliasEditor } from "@/app/alias-editor";
import { Modal } from "@/app/modal";
import { DATA } from "@/app/ui";
import { useMessages } from "@/i18n/provider";
import type { CommandAlias } from "@/lib/aliases";
import { KILL_LINE } from "./terminal-panel";

const FOLDED_KEY = "pm:console-aliases-folded";

/** Read by the console that shows the box, which also expands them when they are typed; `reload` after an edit. */
export const ConsoleAliases = createContext<{ aliases: CommandAlias[]; reload: () => void }>({ aliases: [], reload: () => undefined });

/** Over a local console, dark like it: a click runs the command in its shell. */
export function AliasBox({ type, connected }: { type: (text: string) => void; connected: boolean }) {
  const messages = useMessages();
  const m = messages.sheet.console;
  const { aliases, reload } = useContext(ConsoleAliases);
  const [editing, setEditing] = useState(false);
  // Opened on a click, never rendered by the server: storage can be read right away.
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(FOLDED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const fold = (next: boolean) => {
    setFolded(next);
    try {
      localStorage.setItem(FOLDED_KEY, next ? "1" : "0");
    } catch {
      // Kept for this console only.
    }
  };

  return (
    <div className={`${DATA} border border-white/15 bg-[#15151a]/90 text-[12px] text-[#e9e9ec] shadow-lg backdrop-blur-sm`}>
      <button
        type="button"
        aria-expanded={!folded}
        title={folded ? m.showAliases : m.hideAliases}
        onClick={() => fold(!folded)}
        className="flex w-full items-center justify-between gap-3 px-2 py-1 text-[#a594f9] hover:bg-white/5"
      >
        {m.aliases}
        <span aria-hidden>{folded ? "▸" : "▾"}</span>
      </button>
      {folded || aliases.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1 border-t border-white/10 p-1.5">
          {aliases.map(({ name, command }) => (
            <li key={name}>
              <button
                type="button"
                disabled={!connected}
                title={m.runAlias(command)}
                onClick={() => type(`${KILL_LINE}${command}\r`)}
                className="border border-white/15 px-1.5 py-0.5 hover:border-[#a594f9] hover:text-[#bfb2fb] disabled:opacity-40"
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {folded ? null : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="block w-full border-t border-white/10 px-2 py-1 text-left text-[#6d6d78] hover:text-[#bfb2fb]"
        >
          {m.editAliases}
        </button>
      )}
      {editing ? (
        <Modal title={messages.settings.aliases} wide onClose={() => setEditing(false)}>
          <p className="text-mut">{messages.settings.aliasesHint}</p>
          <AliasEditor
            aliases={aliases}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              reload();
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}
