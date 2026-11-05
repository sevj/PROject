"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { openConsole, readConsoleAliases } from "@/app/actions";
import { type CommandAlias, expandAlias } from "@/lib/aliases";
import { BUTTON, BUTTON_PRIMARY, DATA, FIELD, LABEL } from "@/app/ui";
import { useMessages } from "@/i18n/provider";
import { CONSOLE_SHELLS, type ConsoleOptions, DEFAULT_CONSOLE_OPTIONS } from "@/lib/console-options";
import { AliasBox, ConsoleAliases } from "./alias-box";
import { TerminalPanel } from "./terminal-panel";

export function ConsolePanel({
  projectId,
  containerId,
  containerName,
  onClose,
}: {
  projectId: number;
  containerId: string;
  containerName: string;
  onClose: () => void;
}) {
  const m = useMessages().sheet.console;
  const [options, setOptions] = useState<ConsoleOptions>(DEFAULT_CONSOLE_OPTIONS);
  const [showOptions, setShowOptions] = useState(false);
  const [connectKey, setConnectKey] = useState(0);
  const [aliases, setAliases] = useState<CommandAlias[]>([]);
  const set = (patch: Partial<ConsoleOptions>) => setOptions((current) => ({ ...current, ...patch }));
  const expand = useCallback((line: string) => expandAlias(aliases, line), [aliases]);

  const [reads, setReads] = useState(0);
  const reload = useCallback(() => setReads((count) => count + 1), []);
  const shared = useMemo(() => ({ aliases, reload }), [aliases, reload]);

  // Read as the console opens, after an edit, and when the window comes back, as after editing them in another tab.
  useEffect(() => {
    let live = true;
    const read = () =>
      void readConsoleAliases().then((list) => {
        if (live) setAliases(list);
      });
    read();
    window.addEventListener("focus", read);
    return () => {
      live = false;
      window.removeEventListener("focus", read);
    };
  }, [reads]);

  return (
    <ConsoleAliases value={shared}>
    <TerminalPanel
      title={m.title(containerName)}
      open={() => openConsole(projectId, containerId, options)}
      connectKey={connectKey}
      reconnectLabel={m.reconnect}
      onClose={onClose}
      overlay={AliasBox}
      expand={expand}
      controls={
        <button type="button" aria-expanded={showOptions} onClick={() => setShowOptions((open) => !open)} className={BUTTON}>
          {m.options}
        </button>
      }
      below={
        showOptions ? (
          <form
            className="grid gap-3 border-b border-rule-strong px-3 py-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              setConnectKey((key) => key + 1);
            }}
          >
            <label>
              <span className={`${LABEL} block pb-1`}>{m.shell}</span>
              <select
                value={options.shell}
                onChange={(event) => set({ shell: event.target.value as ConsoleOptions["shell"] })}
                className={FIELD}
              >
                {CONSOLE_SHELLS.map((shell) => (
                  <option key={shell} value={shell}>
                    {m.shells[shell]}
                  </option>
                ))}
              </select>
            </label>
            {options.shell === "command" ? (
              <label>
                <span className={`${LABEL} block pb-1`}>{m.command}</span>
                <input
                  value={options.command}
                  onChange={(event) => set({ command: event.target.value })}
                  placeholder={m.commandPlaceholder}
                  maxLength={1000}
                  spellCheck={false}
                  className={`${FIELD} ${DATA} placeholder:text-mut`}
                />
              </label>
            ) : null}
            <label>
              <span className={`${LABEL} block pb-1`}>{m.user}</span>
              <input
                value={options.user}
                onChange={(event) => set({ user: event.target.value })}
                placeholder={m.userPlaceholder}
                maxLength={129}
                spellCheck={false}
                className={`${FIELD} ${DATA} placeholder:text-mut`}
              />
            </label>
            <label>
              <span className={`${LABEL} block pb-1`}>{m.workingDir}</span>
              <input
                value={options.workingDir}
                onChange={(event) => set({ workingDir: event.target.value })}
                placeholder={m.workingDirPlaceholder}
                maxLength={512}
                spellCheck={false}
                className={`${FIELD} ${DATA} placeholder:text-mut`}
              />
            </label>
            <div className="flex items-end">
              <button type="submit" className={BUTTON_PRIMARY}>
                {m.apply}
              </button>
            </div>
          </form>
        ) : null
      }
    />
    </ConsoleAliases>
  );
}
