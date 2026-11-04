"use client";

import { useState, useTransition } from "react";
import {
  deleteCollectionById,
  renameCollectionById,
  saveSettingsForm,
  scanNow,
  showProject,
} from "../actions";
import { BUTTON, DATA, FIELD, LABEL } from "../ui";

const SECTION = "border-b border-rule px-5 pt-5 pb-6";

type Props = {
  root: string;
  ideCommands: Record<string, string>;
  terminalCommand: string;
  stacks: string[];
  hidden: { id: number; path: string }[];
  collections: { id: number; name: string; count: number }[];
};

export function SettingsForm({ root, ideCommands, terminalCommand, stacks, hidden, collections }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <main className="max-w-3xl flex-1 border-r border-rule">
      <h1 className="px-5 pt-7 pb-6 text-[44px] leading-none font-bold tracking-[-.03em]">Réglages</h1>

      <form
        className={`${SECTION} grid gap-4 border-t border-t-ink`}
        action={(data) => {
          setMessage(null);
          start(async () => {
            const error = await saveSettingsForm(Object.fromEntries(data) as Record<string, string>);
            if (error) {
              setMessage(error);
              return;
            }
            if (String(data.get("root")).trim() !== root) await scanNow();
            setMessage("Réglages enregistrés.");
          });
        }}
      >
        <label>
          <span className={`${LABEL} block pb-1`}>Dossier racine</span>
          <input name="root" defaultValue={root} required className={`${FIELD} ${DATA}`} />
        </label>
        <label>
          <span className={`${LABEL} block pb-1`}>Commande du terminal</span>
          <input name="terminal" defaultValue={terminalCommand} required className={`${FIELD} ${DATA}`} />
        </label>
        <fieldset className="grid gap-2">
          <legend className={`${LABEL} pb-1`}>IDE par stack</legend>
          {["default", ...stacks].map((stack) => (
            <label key={stack} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
              <span>{stack === "default" ? "Par défaut" : stack}</span>
              <input
                name={`ide:${stack}`}
                defaultValue={ideCommands[stack] ?? ""}
                placeholder={stack === "default" ? "code {path}" : "Commande par défaut"}
                required={stack === "default"}
                className={`${FIELD} ${DATA} placeholder:text-mut`}
              />
            </label>
          ))}
        </fieldset>
        <p className="text-mut">
          <code className={DATA}>{"{path}"}</code> est remplacé par le chemin du projet. Les commandes sont lancées sans
          shell.
        </p>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={BUTTON}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </button>
          {message ? (
            <span role="status" className={DATA}>
              {message}
            </span>
          ) : null}
        </div>
      </form>

      <section className={SECTION}>
        <h2 className={`${LABEL} pb-3`}>Collections</h2>
        {collections.length === 0 ? <p className="text-mut">Aucune collection pour l&apos;instant.</p> : null}
        {collections.map(({ id, name, count }) => (
          <div key={id} className="flex flex-wrap items-center gap-2 border-b border-rule py-2 last:border-b-0">
            <form
              className="min-w-[200px] flex-1"
              action={(data) => {
                const next = String(data.get("name") ?? "");
                start(async () => setMessage(await renameCollectionById(id, next)));
              }}
            >
              <label>
                <span className="sr-only">Renommer {name}</span>
                <input key={name} name="name" defaultValue={name} maxLength={80} className={FIELD} />
              </label>
            </form>
            <span className={`${DATA} text-mut`}>
              {count} projet{count > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              disabled={pending}
              className={BUTTON}
              onClick={() => {
                const detail = count > 0 ? ` Les ${count} projets restent, seul ce classement disparaît.` : "";
                if (window.confirm(`Supprimer la collection « ${name} » ?${detail}`)) {
                  start(() => deleteCollectionById(id));
                }
              }}
            >
              Supprimer
            </button>
          </div>
        ))}
      </section>

      <section className={SECTION}>
        <h2 className={`${LABEL} pb-3`}>Dossiers masqués</h2>
        {hidden.length === 0 ? <p className="text-mut">Aucun dossier masqué.</p> : null}
        {hidden.map(({ id, path }) => (
          <div key={id} className="flex items-center justify-between gap-3 border-b border-rule py-2 last:border-b-0">
            <span className={`${DATA} truncate`}>{path}</span>
            <button type="button" disabled={pending} className={BUTTON} onClick={() => start(() => showProject(id))}>
              Réafficher
            </button>
          </div>
        ))}
      </section>
    </main>
  );
}
