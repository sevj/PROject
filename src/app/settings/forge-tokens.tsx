"use client";

import { useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { formatAge } from "@/lib/registry";
import { removeGithubTokenForm, removeGitlabTokenForm, saveGithubTokenForm, saveGitlabTokenForm } from "../actions";
import { useFlash } from "../flash";
import { useConfirm } from "../modal";
import { BUTTON, BUTTON_PRIMARY, CARD, DATA, FIELD, LABEL, SECTION_TITLE } from "../ui";

/** `name` is a GitLab instance or a GitHub owner: what a token is saved under. */
export type ForgeAccount = { name: string; user: string; savedAt: number };

export function ForgeTokens({ forge, accounts, now }: { forge: "gitlab" | "github"; accounts: ForgeAccount[]; now: number }) {
  const messages = useMessages();
  const m = messages.settings;
  const flash = useFlash();
  const [pending, start] = useTransition();
  const { confirm, confirmation } = useConfirm();
  const [token, setToken] = useState("");
  const github = forge === "github";

  return (
    <section id={forge} className={`${CARD} grid scroll-mt-4 gap-3`}>
      <h2 className={SECTION_TITLE}>{github ? m.github : m.gitlab}</h2>
      <p className="text-mut">{github ? m.githubHint : m.gitlabHint}</p>
      {accounts.length === 0 ? <p className="text-mut">{m.gitlabNone}</p> : null}
      {accounts.map(({ name, user, savedAt }) => (
        <div key={name} className="flex flex-wrap items-center justify-between gap-2 border-b border-rule py-2">
          <div className="min-w-0">
            <div className={`${DATA} font-medium break-words`}>{name}</div>
            <div className={`${DATA} text-mut`}>{m.gitlabAccount(user, formatAge(savedAt, now, messages.age))}</div>
          </div>
          <button
            type="button"
            disabled={pending}
            className={BUTTON}
            onClick={() =>
              confirm({
                ...(github ? m.confirmGithubRemove(name) : m.confirmGitlabRemove(name)),
                action: m.gitlabRemove,
                danger: true,
                onConfirm: () => start(() => (github ? removeGithubTokenForm(name) : removeGitlabTokenForm(name))),
              })
            }
          >
            {m.gitlabRemove}
          </button>
        </div>
      ))}
      <form
        className="grid gap-3"
        action={(data) => {
          const name = String(data.get("name") ?? "");
          start(async () => {
            if (github) {
              const saved = await saveGithubTokenForm(name, token);
              if ("problem" in saved) return flash("error", m.githubProblems[saved.problem]);
              setToken("");
              flash("success", m.githubSaved(saved.owner, saved.user));
            } else {
              const saved = await saveGitlabTokenForm(name, token);
              if ("problem" in saved) return flash("error", m.gitlabProblems[saved.problem]);
              setToken("");
              flash("success", m.gitlabSaved(saved.host, saved.user));
            }
          });
        }}
      >
        <label>
          <span className={`${LABEL} block pb-1`}>{github ? m.githubOwner : m.gitlabHost}</span>
          <input name="name" defaultValue={github ? "" : "gitlab.com"} placeholder={github ? "sevj" : undefined} required className={`${FIELD} ${DATA} placeholder:text-mut`} />
        </label>
        <label>
          <span className={`${LABEL} block pb-1`}>{m.gitlabToken}</span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
            autoComplete="off"
            placeholder={github ? "github_pat_…" : "glpat-…"}
            className={`${FIELD} ${DATA} placeholder:text-mut`}
          />
        </label>
        <div>
          <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
            {pending ? m.gitlabChecking : m.gitlabSave}
          </button>
        </div>
      </form>
      {confirmation}
    </section>
  );
}
