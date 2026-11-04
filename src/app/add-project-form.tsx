"use client";

import { useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { addMultiProject, addProject, addSubProject } from "./actions";
import { DirectoryInput } from "./directory-input";
import { CloseIcon, PlusIcon } from "./icons";
import { BUTTON, BUTTON_ICON, BUTTON_PRIMARY, BUTTON_SMALL, DATA, FIELD, LABEL, SEGMENT } from "./ui";

function TextField({
  label,
  name,
  autoFocus = false,
}: {
  label: string;
  name: string;
  autoFocus?: boolean;
}) {
  return (
    <label>
      <span className={`${LABEL} block pb-1`}>{label}</span>
      <input
        name={name}
        required
        maxLength={80}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        className={`${FIELD} placeholder:text-mut`}
      />
    </label>
  );
}

/** Plain checkboxes: their state belongs to the form, which reads it when submitted. */
function TagsField({ name, knownTags }: { name: string; knownTags: string[] }) {
  const m = useMessages().tags;
  if (knownTags.length === 0) return null;
  return (
    <fieldset>
      <legend className={`${LABEL} pb-1`}>{m.label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {knownTags.map((tag) => (
          <label key={tag} className="max-w-full cursor-pointer">
            <input type="checkbox" name={name} value={tag} className="peer sr-only" />
            <span className={`${BUTTON_SMALL} max-w-full peer-checked:border-accent peer-checked:bg-accent peer-checked:text-bg peer-focus-visible:outline`}>
              {tag}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
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

function SubProjectFields({
  prefix,
  autoFocus = false,
  root,
  rootField,
  knownTags,
}: {
  prefix: string;
  autoFocus?: boolean;
  root?: string;
  rootField?: string;
  knownTags: string[];
}) {
  const m = useMessages().form;
  return (
    <>
      <TextField label={m.name} name={`${prefix}name`} autoFocus={autoFocus} />
      <DescriptionField name={`${prefix}description`} />
      <div>
        <label htmlFor={`${prefix}subdirectory-field`} className={`${LABEL} block pb-1`}>
          {m.subdirectory}
        </label>
        <DirectoryInput
          id={`${prefix}subdirectory-field`}
          name={`${prefix}subdirectory`}
          placeholder="front"
          root={root}
          rootField={rootField}
        />
      </div>
      <TagsField name={`${prefix}tags`} knownTags={knownTags} />
    </>
  );
}

function readSubProject(data: FormData, prefix: string) {
  return {
    name: String(data.get(`${prefix}name`) ?? ""),
    description: String(data.get(`${prefix}description`) ?? ""),
    subdirectory: String(data.get(`${prefix}subdirectory`) ?? ""),
    tags: data.getAll(`${prefix}tags`).map(String),
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
  knownTags,
  onCreated,
  onCancel,
}: {
  knownTags: string[];
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
      tags: data.getAll("tags").map(String),
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
      <h2 className="text-[26px] leading-[1.1] font-bold tracking-tight">{m.title}</h2>

      <div role="group" aria-label={m.type} className="flex">
        <button type="button" aria-pressed={!multi} onClick={() => setMulti(false)} className={`${SEGMENT} flex-1`}>
          {m.project}
        </button>
        <button type="button" aria-pressed={multi} onClick={() => setMulti(true)} className={`${SEGMENT} flex-1`}>
          {m.multiProject}
        </button>
      </div>

      <TextField label={m.name} name="name" autoFocus />
      <DescriptionField name="description" />
      <div>
        <label htmlFor="project-directory-field" className={`${LABEL} block pb-1`}>
          {multi ? m.rootDirectory : m.directory}
        </label>
        <DirectoryInput id="project-directory-field" name="directory" placeholder={m.directoryPlaceholder} />
      </div>
      {/* A multi-project is only a heading: tags go on each of its repositories. */}
      {multi ? null : <TagsField name="tags" knownTags={knownTags} />}

      {multi ? (
        <>
          {repoKeys.map((key, index) => (
            <fieldset key={key} className="grid gap-3 border-t border-rule-strong pt-3">
              <div className="flex items-center justify-between gap-3">
                <legend className="contents font-semibold">{m.repository(index + 1)}</legend>
                {repoKeys.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setRepoKeys((keys) => keys.filter((item) => item !== key))}
                    aria-label={m.removeRepositoryLabel(index + 1)}
                    title={m.removeRepositoryLabel(index + 1)}
                    className={BUTTON_ICON}
                  >
                    <CloseIcon />
                  </button>
                ) : null}
              </div>
              <SubProjectFields prefix={`repo-${key}-`} rootField="directory" knownTags={knownTags} />
            </fieldset>
          ))}
          <button
            type="button"
            className={BUTTON}
            onClick={() => setRepoKeys((keys) => [...keys, Math.max(...keys) + 1])}
          >
            <PlusIcon />
            {messages.panel.addRepository}
          </button>
        </>
      ) : null}

      <FormError message={error} />

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className={BUTTON_PRIMARY}
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
  root,
  knownTags,
  onCreated,
  onCancel,
}: {
  groupId: number;
  root: string;
  knownTags: string[];
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
      <SubProjectFields prefix="" autoFocus root={root} knownTags={knownTags} />
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          {pending ? m.common.adding : m.panel.addRepository}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON}>
          {m.common.cancel}
        </button>
      </div>
    </form>
  );
}
