"use client";

import { useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
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
  const m = useMessages().form;
  return (
    <label>
      <span className={`${LABEL} block pb-1`}>{m.description}</span>
      <textarea
        name={name}
        rows={2}
        maxLength={500}
        placeholder={m.descriptionPlaceholder}
        className={`${FIELD} block resize-y py-2 placeholder:text-mut`}
      />
    </label>
  );
}

function SubProjectFields({ prefix, autoFocus = false }: { prefix: string; autoFocus?: boolean }) {
  const m = useMessages().form;
  return (
    <>
      <TextField label={m.name} name={`${prefix}name`} autoFocus={autoFocus} />
      <DescriptionField name={`${prefix}description`} />
      <TextField label={m.subdirectory} name={`${prefix}subdirectory`} placeholder="front" mono />
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
  const messages = useMessages();
  const m = messages.form;
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
      <h2 className="text-[32px] leading-[1.05] font-bold tracking-tight">{m.title}</h2>

      <div role="group" aria-label={m.type} className="flex">
        <button type="button" aria-pressed={!multi} onClick={() => setMulti(false)} className={MODE}>
          {m.project}
        </button>
        <button type="button" aria-pressed={multi} onClick={() => setMulti(true)} className={MODE}>
          {m.multiProject}
        </button>
      </div>

      <TextField label={m.name} name="name" autoFocus />
      <DescriptionField name="description" />
      <TextField
        label={multi ? m.rootDirectory : m.directory}
        name="directory"
        placeholder={m.directoryPlaceholder}
        mono
      />

      {multi ? (
        <>
          {repoKeys.map((key, index) => (
            <fieldset key={key} className="grid gap-3 border-t border-ink pt-3">
              <div className="flex items-center justify-between gap-3">
                <legend className="contents font-semibold">{m.repository(index + 1)}</legend>
                {repoKeys.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setRepoKeys((keys) => keys.filter((item) => item !== key))}
                    aria-label={m.removeRepositoryLabel(index + 1)}
                    className="min-h-8 cursor-pointer text-mut underline hover:text-ink"
                  >
                    {m.removeRepository}
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
            {messages.panel.addRepository}
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
          {pending ? messages.common.adding : multi ? m.addMultiProject : m.addProject}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={BUTTON}>
            {messages.common.cancel}
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
  const m = useMessages();
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
          {pending ? m.common.adding : m.panel.addRepository}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON}>
          {m.common.cancel}
        </button>
      </div>
    </form>
  );
}
