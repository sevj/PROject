"use client";

import { useState, useTransition } from "react";
import { addMultiProject, addProject, addSubProject } from "./actions";
import { BUTTON, DATA, FIELD, LABEL } from "./ui";

const MODE =
  "-ml-px min-h-10 flex-1 cursor-pointer border border-ink px-3 font-medium first:ml-0 aria-pressed:bg-ink aria-pressed:text-bg";

function TextField({
  label,
  name,
  placeholder,
  mono = false,
  autoFocus = false,
}: {
  label: string;
  name: string;
  placeholder?: string;
  mono?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label>
      <span className={`${LABEL} block pb-1`}>{label}</span>
      <input
        name={name}
        required
        maxLength={mono ? 1024 : 80}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={`${FIELD} ${mono ? DATA : ""} placeholder:text-mut`}
      />
    </label>
  );
}

function DescriptionField({ name }: { name: string }) {
  return (
    <label>
      <span className={`${LABEL} block pb-1`}>Description</span>
      <textarea
        name={name}
        rows={2}
        maxLength={500}
        placeholder="À quoi sert ce projet ?"
        className={`${FIELD} block resize-y py-2 placeholder:text-mut`}
      />
    </label>
  );
}

function SubProjectFields({ prefix, autoFocus = false }: { prefix: string; autoFocus?: boolean }) {
  return (
    <>
      <TextField label="Nom" name={`${prefix}name`} autoFocus={autoFocus} />
      <DescriptionField name={`${prefix}description`} />
      <TextField label="Sous-répertoire" name={`${prefix}subdirectory`} placeholder="front" mono />
    </>
  );
}

function readSubProject(data: FormData, prefix: string) {
  return {
    name: String(data.get(`${prefix}name`) ?? ""),
    description: String(data.get(`${prefix}description`) ?? ""),
    subdirectory: String(data.get(`${prefix}subdirectory`) ?? ""),
  };
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className={`${DATA} break-words text-alert`}>
      {message}
    </p>
  ) : null;
}

export function AddProjectForm({
  onCreated,
  onCancel,
}: {
  onCreated: (id: number) => void;
  onCancel?: () => void;
}) {
  const [multi, setMulti] = useState(false);
  const [repoKeys, setRepoKeys] = useState([0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (data: FormData) => {
    setError(null);
    const input = {
      name: String(data.get("name") ?? ""),
      description: String(data.get("description") ?? ""),
      directory: String(data.get("directory") ?? ""),
    };
    start(async () => {
      const result = multi
        ? await addMultiProject(input, repoKeys.map((key) => readSubProject(data, `repo-${key}-`)))
        : await addProject(input);
      if ("error" in result) setError(result.error);
      else onCreated(result.ids[0]);
    });
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit(new FormData(event.currentTarget));
      }}
    >
      <h2 className="text-[32px] leading-[1.05] font-bold tracking-tight">Ajouter un projet</h2>

      <div role="group" aria-label="Type de projet" className="flex">
        <button type="button" aria-pressed={!multi} onClick={() => setMulti(false)} className={MODE}>
          Projet
        </button>
        <button type="button" aria-pressed={multi} onClick={() => setMulti(true)} className={MODE}>
          Multi-projet
        </button>
      </div>

      <TextField label="Nom" name="name" autoFocus />
      <DescriptionField name="description" />
      <TextField
        label={multi ? "Répertoire racine" : "Répertoire"}
        name="directory"
        placeholder="~/Projects/mon-projet"
        mono
      />

      {multi ? (
        <>
          {repoKeys.map((key, index) => (
            <fieldset key={key} className="grid gap-3 border-t border-ink pt-3">
              <div className="flex items-center justify-between gap-3">
                <legend className="contents font-semibold">Dépôt {index + 1}</legend>
                {repoKeys.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setRepoKeys((keys) => keys.filter((item) => item !== key))}
                    aria-label={`Enlever le dépôt ${index + 1}`}
                    className="min-h-8 cursor-pointer text-mut underline hover:text-ink"
                  >
                    Enlever
                  </button>
                ) : null}
              </div>
              <SubProjectFields prefix={`repo-${key}-`} />
            </fieldset>
          ))}
          <button
            type="button"
            className={BUTTON}
            onClick={() => setRepoKeys((keys) => [...keys, Math.max(...keys) + 1])}
          >
            Ajouter un dépôt
          </button>
        </>
      ) : null}

      <FormError message={error} />

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className={`${BUTTON} bg-ink text-bg hover:bg-transparent hover:text-ink`}
        >
          {pending ? "Ajout…" : multi ? "Ajouter le multi-projet" : "Ajouter le projet"}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={BUTTON}>
            Annuler
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function AddSubProjectForm({
  groupId,
  onCreated,
  onCancel,
}: {
  groupId: number;
  onCreated: (id: number) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const input = readSubProject(new FormData(event.currentTarget), "");
        setError(null);
        start(async () => {
          const result = await addSubProject(groupId, input);
          if ("error" in result) setError(result.error);
          else onCreated(result.ids[0]);
        });
      }}
    >
      <SubProjectFields prefix="" autoFocus />
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Ajout…" : "Ajouter le dépôt"}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON}>
          Annuler
        </button>
      </div>
    </form>
  );
}
