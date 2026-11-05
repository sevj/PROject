"use client";

import { useState, useTransition } from "react";
import {
  checkOutAllProjectRemoteBranches,
  checkOutProjectRemoteBranch,
  chooseFetchRemote,
  cleanUpBranches,
  createProjectBranch,
  fetchProject,
  pullProject,
  switchProjectBranch,
} from "@/app/actions";
import { Modal, useConfirm } from "@/app/modal";
import { BUTTON, BUTTON_PRIMARY, BUTTON_PRIMARY_DANGER, BUTTON_SMALL, CHECKBOX, DATA, FIELD, LABEL } from "@/app/ui";
import { useFlash } from "@/app/flash";
import { useMessages } from "@/i18n/provider";
import type { DeletedBranch } from "@/server/git-actions";

const ERROR = `${DATA} basis-full max-h-40 overflow-auto break-words whitespace-pre-wrap text-alert`;

/** Runs a git action, then tells how it went. */
function useGitAction() {
  const flash = useFlash();
  const [pending, start] = useTransition();
  const run = (action: () => Promise<string | null>, success: string) =>
    start(async () => {
      const error = await action();
      if (error) flash("error", error);
      else flash("success", success);
    });
  return { pending, run };
}

export function SwitchBranch({ projectId, branch, running }: { projectId: number; branch: string; running: number }) {
  const m = useMessages().gitTab;
  const { pending, run } = useGitAction();
  const { confirm, confirmation } = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-label={`${m.switchBranch} ${branch}`}
        onClick={() =>
          confirm({
            ...m.confirmSwitch(branch, running),
            action: m.switchBranch,
            onConfirm: () => run(() => switchProjectBranch(projectId, branch), m.switched(branch)),
          })
        }
        className={`${BUTTON_SMALL} ml-auto`}
      >
        {pending ? m.working : m.switchBranch}
      </button>
      {confirmation}
    </>
  );
}

export function CheckOutRemote({
  projectId,
  remoteBranch,
  running,
}: {
  projectId: number;
  remoteBranch: string;
  running: number;
}) {
  const m = useMessages().gitTab;
  const { pending, run } = useGitAction();
  const { confirm, confirmation } = useConfirm();
  const local = remoteBranch.slice(remoteBranch.indexOf("/") + 1);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-label={`${m.checkOut} ${remoteBranch}`}
        onClick={() =>
          confirm({
            ...m.confirmCheckOut(remoteBranch, local, running),
            action: m.checkOut,
            onConfirm: () => run(() => checkOutProjectRemoteBranch(projectId, remoteBranch), m.checkedOut(local)),
          })
        }
        className={`${BUTTON_SMALL} ml-auto`}
      >
        {pending ? m.working : m.checkOut}
      </button>
      {confirmation}
    </>
  );
}

export function CheckOutAllRemotes({ projectId, count, branch }: { projectId: number; count: number; branch: string }) {
  const m = useMessages().gitTab;
  const flash = useFlash();
  const [pending, start] = useTransition();
  const { confirm, confirmation } = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          confirm({
            ...m.confirmCheckOutAll(count, branch),
            action: m.checkOutAll(count),
            onConfirm: () =>
              start(async () => {
                const { created, errors } = await checkOutAllProjectRemoteBranches(projectId);
                if (created.length > 0) flash("success", m.checkedOutAll(created.length));
                if (errors.length > 0) flash("error", errors.join("\n"));
              }),
          })
        }
        className={BUTTON}
      >
        {pending ? m.working : m.checkOutAll(count)}
      </button>
      {confirmation}
    </>
  );
}

export function PullButton({ projectId, branch, behind }: { projectId: number; branch: string; behind: number }) {
  const m = useMessages().gitTab;
  const { pending, run } = useGitAction();
  const { confirm, confirmation } = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          confirm({
            ...m.confirmPull(branch, behind),
            action: m.pull(behind),
            onConfirm: () => run(() => pullProject(projectId), m.pulled),
          })
        }
        className={BUTTON}
      >
        {pending ? m.working : m.pull(behind)}
      </button>
      {confirmation}
    </>
  );
}

export function NewBranch({ projectId, from }: { projectId: number; from: string }) {
  const messages = useMessages();
  const m = messages.gitTab;
  const flash = useFlash();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON}>
        {m.newBranch}
      </button>
      {open ? (
        <Modal
          title={m.newBranchTitle}
          onClose={() => {
            setOpen(false);
            setError(null);
          }}
        >
          <p className="text-mut">{m.newBranchIntro(from)}</p>
          <form
            className="grid gap-3"
            action={(form) =>
              start(async () => {
                setError(null);
                const name = String(form.get("name") ?? "").trim();
                const failure = await createProjectBranch(projectId, name);
                if (failure) setError(failure);
                else {
                  flash("success", m.branchCreated(name));
                  setOpen(false);
                }
              })
            }
          >
            <label className="grid gap-1">
              <span className={LABEL}>{m.newBranchName}</span>
              <input name="name" required autoComplete="off" spellCheck={false} className={`${FIELD} font-mono`} />
            </label>
            {error ? (
              <p role="alert" className={ERROR}>
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
                {pending ? m.working : m.newBranchCreate}
              </button>
              <button type="button" disabled={pending} onClick={() => setOpen(false)} className={BUTTON}>
                {messages.common.cancel}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/** With several remotes, each project says which one it reads: one may be out of reach. */
export function FetchControl({
  projectId,
  remotes,
  chosen,
}: {
  projectId: number;
  remotes: string[];
  chosen: string | null;
}) {
  const m = useMessages().gitTab;
  const { pending, run } = useGitAction();
  const gone = chosen !== null && !remotes.includes(chosen);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => fetchProject(projectId), chosen ? m.fetchedRemote(chosen) : m.fetched)}
        className={BUTTON}
      >
        {pending ? m.working : m.fetch}
      </button>
      {remotes.length > 1 || gone ? (
        <select
          aria-label={m.fetchRemote}
          title={m.fetchRemote}
          disabled={pending}
          value={chosen ?? ""}
          onChange={(event) => {
            const remote = event.target.value || null;
            run(() => chooseFetchRemote(projectId, remote), m.fetchRemoteChosen(remote));
          }}
          className={`${FIELD} !w-auto`}
        >
          <option value="">{m.allRemotes}</option>
          {remotes.map((remote) => (
            <option key={remote} value={remote}>
              {remote}
            </option>
          ))}
          {gone ? <option value={chosen}>{m.missingRemote(chosen)}</option> : null}
        </select>
      ) : null}
    </div>
  );
}

type Removable = { name: string; onRemote: boolean };

function CleanUpDialog({
  projectId,
  into,
  branches,
  onClose,
  onDone,
}: {
  projectId: number;
  into: string;
  branches: Removable[];
  onClose: () => void;
  onDone: (result: { deleted: DeletedBranch[]; errors: string[] }) => void;
}) {
  const messages = useMessages();
  const m = messages.gitTab;
  // What the remote still has may well be in use: it takes a deliberate choice.
  const [selected, setSelected] = useState(() => new Set(branches.filter((b) => !b.onRemote).map((b) => b.name)));
  const [pending, start] = useTransition();

  function toggle(name: string) {
    const next = new Set(selected);
    if (!next.delete(name)) next.add(name);
    setSelected(next);
  }

  return (
    <Modal title={m.cleanUpTitle} onClose={onClose}>
      <p className="text-mut">{m.cleanUpIntro(into)}</p>
      <div className="max-h-[min(360px,50vh)] overflow-y-auto border border-rule">
        {branches.map(({ name, onRemote }) => (
          <label key={name} className="flex min-h-10 cursor-pointer items-center gap-2.5 border-b border-rule px-2.5 py-1.5 last:border-b-0 hover:bg-sel">
            <input type="checkbox" checked={selected.has(name)} onChange={() => toggle(name)} className={CHECKBOX} />
            <span className={`${DATA} min-w-0 break-words`}>{name}</span>
            {onRemote ? <span className={`${DATA} ml-auto shrink-0 text-mut`}>{m.cleanUpOnRemote}</span> : null}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || selected.size === 0}
          onClick={() =>
            start(async () => {
              onDone(await cleanUpBranches(projectId, [...selected]));
              onClose();
            })
          }
          className={BUTTON_PRIMARY_DANGER}
        >
          {pending ? m.working : m.cleanUpConfirm(selected.size)}
        </button>
        <button type="button" disabled={pending} onClick={onClose} className={BUTTON}>
          {messages.common.cancel}
        </button>
      </div>
    </Modal>
  );
}

export function CleanUpBranches({
  projectId,
  into,
  branches,
}: {
  projectId: number;
  into: string;
  branches: Removable[];
}) {
  const m = useMessages().gitTab;
  const flash = useFlash();
  const [open, setOpen] = useState(false);
  return (
    <>
      {branches.length > 0 ? (
        <button type="button" onClick={() => setOpen(true)} className={BUTTON}>
          {m.cleanUp(branches.length)}
        </button>
      ) : null}
      {open ? (
        <CleanUpDialog
          projectId={projectId}
          into={into}
          branches={branches}
          onClose={() => setOpen(false)}
          onDone={({ deleted, errors }) => {
            if (deleted.length > 0) flash("success", m.cleanedUp(deleted));
            if (errors.length > 0) flash("error", errors.join("\n"));
          }}
        />
      ) : null}
    </>
  );
}
