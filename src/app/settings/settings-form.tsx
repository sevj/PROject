"use client";

import { useState, useTransition } from "react";
import { type Locale, LANGUAGES } from "@/i18n";
import { useMessages } from "@/i18n/provider";
import { deleteTagByName, renameTagByName, saveSettingsForm } from "../actions";
import { BUTTON, BUTTON_PRIMARY, DATA, FIELD, LABEL } from "../ui";

const SECTION = "border-b border-rule px-5 pt-5 pb-6";

type Props = {
  locale: Locale;
  ideCommands: Record<string, string>;
  terminalCommand: string;
  stacks: string[];
  tags: { name: string; count: number }[];
};

export function SettingsForm({ locale, ideCommands, terminalCommand, stacks, tags }: Props) {
  const messages = useMessages();
  const m = messages.settings;
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tagMessage, setTagMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <main className="max-w-3xl flex-1 border-r border-rule">
      <h1 className="px-5 pt-7 pb-6 text-[32px] leading-none font-bold tracking-tight">{m.title}</h1>

      <form
        className={`${SECTION} grid gap-4 border-t border-t-ink`}
        action={(data) => {
          setMessage(null);
          setSaved(false);
          start(async () => {
            const error = await saveSettingsForm(Object.fromEntries(data) as Record<string, string>);
            setSaved(error === null);
            setMessage(error);
          });
        }}
      >
        <label>
          <span className={`${LABEL} block pb-1`}>{m.language}</span>
          <select name="locale" defaultValue={locale} className={FIELD}>
            {Object.entries(LANGUAGES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={`${LABEL} block pb-1`}>{m.terminal}</span>
          <input name="terminal" defaultValue={terminalCommand} required className={`${FIELD} ${DATA}`} />
        </label>
        <fieldset className="grid gap-2">
          <legend className={`${LABEL} pb-1`}>{m.ideByStack}</legend>
          {["default", ...stacks].map((stack) => (
            <label key={stack} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
              <span>{stack === "default" ? m.defaultIde : stack}</span>
              <input
                name={`ide:${stack}`}
                defaultValue={ideCommands[stack] ?? ""}
                placeholder={stack === "default" ? "code {path}" : m.defaultCommand}
                required={stack === "default"}
                className={`${FIELD} ${DATA} placeholder:text-mut`}
              />
            </label>
          ))}
        </fieldset>
        <p className="text-mut">
          <code className={DATA}>{"{path}"}</code> {m.pathHint}
        </p>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
            {pending ? messages.common.saving : messages.common.save}
          </button>
          {message || saved ? (
            <span role="status" className={DATA}>
              {message ?? m.saved}
            </span>
          ) : null}
        </div>
      </form>

      <section className={SECTION}>
        <h2 className={`${LABEL} pb-3`}>{m.tags}</h2>
        {tagMessage ? (
          <p role="alert" className={`${DATA} pb-2 text-alert`}>
            {tagMessage}
          </p>
        ) : null}
        {tags.length === 0 ? <p className="text-mut">{m.noTags}</p> : null}
        {tags.map(({ name, count }) => (
          <div key={name} className="flex flex-wrap items-center gap-2 border-b border-rule py-2 last:border-b-0">
            <form
              className="min-w-[200px] flex-1"
              action={(data) => {
                const next = String(data.get("name") ?? "");
                start(async () => setTagMessage(await renameTagByName(name, next)));
              }}
            >
              <label>
                <span className="sr-only">{m.renameTag(name)}</span>
                <input name="name" defaultValue={name} maxLength={80} className={FIELD} />
              </label>
            </form>
            <span className={`${DATA} text-mut`}>
              {m.projectCount(count)}
            </span>
            <button
              type="button"
              disabled={pending}
              className={BUTTON}
              onClick={() => {
                if (window.confirm(m.confirmDeleteTag(name, count))) {
                  start(() => deleteTagByName(name));
                }
              }}
            >
              {m.deleteTag}
            </button>
          </div>
        ))}
      </section>
    </main>
  );
}
