"use client";

import { useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { formatAge } from "@/lib/registry";
import { removeApmConnectionForm, saveApmConnectionForm } from "../actions";
import { useFlash } from "../flash";
import { useConfirm } from "../modal";
import { BUTTON, BUTTON_PRIMARY, CARD, DATA, FIELD, LABEL, LINK, SECTION_TITLE } from "../ui";

export type ApmAccountView = { url: string; user: string; savedAt: number };

/** The APM instance and its personal token: one for the whole app, as tickets are read with it for every project. */
export function ApmSettings({ account, defaultUrl, now }: { account: ApmAccountView | null; defaultUrl: string; now: number }) {
  const messages = useMessages();
  const m = messages.settings;
  const flash = useFlash();
  const [pending, start] = useTransition();
  const { confirm, confirmation } = useConfirm();
  const [url, setUrl] = useState(account?.url ?? defaultUrl);
  const [token, setToken] = useState("");
  // Only an address that looks like one gets a link: the field is free text.
  const tokenPage = /^https:\/\/[^/\s]+\.[^/\s]+\/?$/.test(url.trim()) ? `${url.trim().replace(/\/$/, "")}/my-account/api-tokens` : null;

  return (
    <section id="apm" className={`${CARD} grid scroll-mt-4 gap-3`}>
      <h2 className={SECTION_TITLE}>{m.apm}</h2>
      <p className="text-mut">{m.apmHint}</p>
      {account ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule py-2">
          <div className={`${DATA} min-w-0 break-words`}>{m.apmAccount(account.user, account.url, formatAge(account.savedAt, now, messages.age))}</div>
          <button
            type="button"
            disabled={pending}
            className={BUTTON}
            onClick={() =>
              confirm({
                ...m.confirmApmRemove,
                action: m.gitlabRemove,
                danger: true,
                onConfirm: () => start(() => removeApmConnectionForm()),
              })
            }
          >
            {m.gitlabRemove}
          </button>
        </div>
      ) : (
        <p className="text-mut">{m.apmNone}</p>
      )}
      <form
        className="grid gap-3"
        action={() =>
          start(async () => {
            const saved = await saveApmConnectionForm(url, token);
            if ("problem" in saved) return flash("error", m.apmProblems[saved.problem]);
            setToken("");
            setUrl(saved.url);
            flash("success", m.apmSaved(saved.user));
          })
        }
      >
        <label>
          <span className={`${LABEL} block pb-1`}>{m.apmUrl}</span>
          <input value={url} onChange={(event) => setUrl(event.target.value)} required className={`${FIELD} ${DATA}`} />
        </label>
        <label>
          <span className={`${LABEL} flex flex-wrap justify-between gap-2 pb-1`}>
            {m.gitlabToken}
            {tokenPage ? (
              <a href={tokenPage} target="_blank" rel="noreferrer" className={`${LINK} normal-case tracking-normal`}>
                {m.apmTokenPage}
              </a>
            ) : null}
          </span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
            autoComplete="off"
            placeholder="apm_pat_…"
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
