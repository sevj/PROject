"use client";

import { useTransition } from "react";
import { type Locale, LANGUAGES } from "@/i18n";
import { useMessages } from "@/i18n/provider";
import { useRouter } from "next/navigation";
import type { CommandAlias } from "@/lib/aliases";
import { deleteTagByName, renameTagByName, saveSettingsForm } from "../actions";
import { AliasEditor } from "../alias-editor";
import { useFlash } from "../flash";
import { useConfirm } from "../modal";
import { BUTTON, BUTTON_PRIMARY, CARD, DATA, FIELD, LABEL, SECTION_TITLE, PAGE_TITLE } from "../ui";

type Props = {
  locale: Locale;
  ideCommands: Record<string, string>;
  terminalCommand: string;
  aliases: CommandAlias[];
  stacks: string[];
  tags: { name: string; count: number }[];
};

export function SettingsForm({ locale, ideCommands, terminalCommand, aliases, stacks, tags }: Props) {
  const messages = useMessages();
  const m = messages.settings;
  const flash = useFlash();
  const router = useRouter();
  const [pending, start] = useTransition();
  const { confirm, confirmation } = useConfirm();

  return (
    <main className="mx-auto grid w-full max-w-[1240px] flex-1 content-start gap-6 px-5 pt-6 pb-10">
      <h1 className={PAGE_TITLE}>{m.title}</h1>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <form
          className={`${CARD} grid gap-4`}
          action={(data) => {
            start(async () => {
              const error = await saveSettingsForm(Object.fromEntries(data) as Record<string, string>);
              if (error) flash("error", error);
              else flash("success", m.saved);
            });
          }}
        >
          <h2 className={SECTION_TITLE}>{m.general}</h2>
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
          </div>
        </form>

        <section id="aliases" className={`${CARD} grid scroll-mt-4 gap-3`}>
          <h2 className={SECTION_TITLE}>{m.aliases}</h2>
          <p className="text-mut">{m.aliasesHint}</p>
          <AliasEditor
            aliases={aliases}
            onSaved={() => {
              flash("success", m.aliasesSaved);
              router.refresh();
            }}
          />
        </section>

        <section className={`${CARD} grid gap-2`}>
          <h2 className={SECTION_TITLE}>{m.tags}</h2>
          {tags.length === 0 ? <p className="text-mut">{m.noTags}</p> : null}
          {tags.map(({ name, count }) => (
            <div key={name} className="flex flex-wrap items-center gap-2 border-b border-rule py-2 last:border-b-0">
              <form
                className="min-w-[200px] flex-1"
                action={(data) => {
                  const next = String(data.get("name") ?? "");
                  start(async () => {
                    const error = await renameTagByName(name, next);
                    if (error) flash("error", error);
                  });
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
                onClick={() =>
                  confirm({
                    ...m.confirmDeleteTag(name, count),
                    action: m.deleteTag,
                    danger: true,
                    onConfirm: () => start(() => deleteTagByName(name)),
                  })
                }
              >
                {m.deleteTag}
              </button>
            </div>
          ))}
        </section>
      </div>
      {confirmation}
    </main>
  );
}
