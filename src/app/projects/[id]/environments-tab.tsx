"use client";

import Link from "next/link";
import { type FormEvent, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { looksLikeProduction } from "@/lib/remote-servers";
import type { AccessView, EnvironmentView, ServerView, Suggestions } from "@/server/remote-servers";
import { TestButton } from "../../connection-test";
import { openRemoteConsole, removeAccess, removeEnvironment, submitAccess, submitEnvironment } from "../../environment-actions";
import { CloseIcon, OpenIcon, PlusIcon } from "../../icons";
import { Modal, useConfirm } from "../../modal";
import { VpnBadge } from "../../vpn/vpn-controls";
import type { VpnView } from "@/server/vpn";
import { TerminalPanel } from "./terminal-panel";
import { FormField, ServerFormModal } from "../../server-form";
import { BADGE, BADGE_ALERT, BUTTON, BUTTON_ICON, BUTTON_PRIMARY, BUTTON_SMALL, BUTTON_SMALL_DANGER, CARD, CHECKBOX, DATA, FIELD, LINK, SECTION_TITLE } from "../../ui";

function EnvironmentFormModal({ projectId, environment, onClose }: { projectId: number; environment: EnvironmentView | null; onClose: () => void }) {
  const messages = useMessages();
  const m = messages.environments;
  const [name, setName] = useState(environment?.name ?? "");
  const [isProtected, setProtected] = useState(environment?.protected ?? false);
  // Until the box is touched, it follows the name: production protects itself.
  const [touched, setTouched] = useState(environment !== null);
  const [urls, setUrls] = useState(environment?.urls.length ? environment.urls : [{ label: "", url: "" }]);
  const [notes, setNotes] = useState(environment?.notes ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const setUrl = (index: number, change: Partial<{ label: string; url: string }>) =>
    setUrls(urls.map((line, at) => (at === index ? { ...line, ...change } : line)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    start(async () => {
      const saved = await submitEnvironment(projectId, environment?.id ?? null, { name, protected: isProtected, urls, notes });
      if ("problem" in saved) setProblem(messages.servers.problems[saved.problem]);
      else onClose();
    });
  };

  return (
    <Modal title={environment ? m.editTitle(environment.name) : m.addTitle} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <FormField label={m.name}>
          <input
            required
            list="environment-names"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!touched) setProtected(looksLikeProduction(event.target.value));
            }}
            className={FIELD}
          />
          <datalist id="environment-names">
            {m.presets.map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
        </FormField>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className={`${CHECKBOX} mt-0.5 shrink-0`}
            checked={isProtected}
            onChange={(event) => {
              setTouched(true);
              setProtected(event.target.checked);
            }}
          />
          <span>
            {m.protected}
            <span className="block text-[12px] text-mut">{m.protectedHint}</span>
          </span>
        </label>
        <div className="grid gap-2">
          <span>{m.urls}</span>
          {urls.map(({ label, url }, index) => (
            <div key={index} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-2">
              <input aria-label={m.urlLabel} placeholder={m.urlLabel} value={label} onChange={(event) => setUrl(index, { label: event.target.value })} className={FIELD} />
              <input aria-label={m.urlAddress} placeholder="https://…" value={url} onChange={(event) => setUrl(index, { url: event.target.value })} className={FIELD} />
              <button type="button" aria-label={m.removeUrl} onClick={() => setUrls(urls.filter((_, at) => at !== index))} className={BUTTON_ICON}>
                <CloseIcon />
              </button>
            </div>
          ))}
          <div>
            <button type="button" onClick={() => setUrls([...urls, { label: "", url: "" }])} className={BUTTON_SMALL}>
              <PlusIcon />
              {m.addUrl}
            </button>
          </div>
        </div>
        <FormField label={m.notes} hint={m.notesHint}>
          <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className={`${FIELD} py-2`} />
        </FormField>
        {problem ? <p role="alert" className="text-alert">{problem}</p> : null}
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
            {pending ? messages.common.saving : messages.common.save}
          </button>
          <button type="button" onClick={onClose} className={BUTTON}>{messages.common.cancel}</button>
        </div>
      </form>
    </Modal>
  );
}

function AccessFormModal({
  projectId,
  environmentId,
  access,
  servers,
  suggestions,
  vpns,
  onClose,
}: {
  projectId: number;
  environmentId: number;
  access: AccessView | null;
  servers: ServerView[];
  suggestions: Suggestions;
  vpns: VpnView[];
  onClose: () => void;
}) {
  const messages = useMessages();
  const m = messages.environments;
  const [serverId, setServerId] = useState(access?.serverId ?? servers[0]?.id ?? null);
  const [label, setLabel] = useState(access?.label ?? "");
  const [path, setPath] = useState(access?.path ?? "");
  const [namespace, setNamespace] = useState(access?.namespace ?? "");
  const [target, setTarget] = useState(access?.target ?? "");
  const [container, setContainer] = useState(access?.container ?? "");
  const [addingServer, setAddingServer] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const server = servers.find(({ id }) => id === serverId) ?? null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (serverId === null) {
      setProblem(messages.servers.problems.serverMissing);
      return;
    }
    start(async () => {
      const saved = await submitAccess(projectId, environmentId, access?.id ?? null, { serverId, label, path, namespace, target, container });
      if ("problem" in saved) setProblem(messages.servers.problems[saved.problem]);
      else onClose();
    });
  };

  return (
    <Modal title={access ? m.editAccessTitle(access.label) : m.addAccessTitle} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <FormField label={m.server}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select value={serverId ?? ""} onChange={(event) => setServerId(Number(event.target.value))} className={FIELD}>
              {servers.length === 0 ? <option value="">{m.noServer}</option> : null}
              {servers.map(({ id, name, kind }) => (
                <option key={id} value={id}>{name} · {messages.servers.kinds[kind]}</option>
              ))}
            </select>
            <button type="button" onClick={() => setAddingServer(true)} className={BUTTON}>
              <PlusIcon />
              {m.newServer}
            </button>
          </div>
        </FormField>
        <FormField label={m.accessLabel} hint={m.accessLabelHint}>
          <input required value={label} onChange={(event) => setLabel(event.target.value)} className={FIELD} />
        </FormField>
        {server?.kind === "ssh" ? (
          <FormField label={m.path} hint={m.pathHint}>
            <input value={path} placeholder="/var/www/app" onChange={(event) => setPath(event.target.value)} className={FIELD} />
          </FormField>
        ) : null}
        {server?.kind === "kubernetes" ? (
          <>
            <FormField label={m.namespace}>
              <input value={namespace} onChange={(event) => setNamespace(event.target.value)} className={FIELD} />
            </FormField>
            <FormField label={m.target} hint={m.targetHint}>
              <input value={target} placeholder="deployment/api" onChange={(event) => setTarget(event.target.value)} className={FIELD} />
            </FormField>
            <FormField label={m.container} hint={m.containerHint}>
              <input value={container} onChange={(event) => setContainer(event.target.value)} className={FIELD} />
            </FormField>
          </>
        ) : null}
        {problem ? <p role="alert" className="text-alert">{problem}</p> : null}
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="submit" disabled={pending || serverId === null} className={BUTTON_PRIMARY}>
            {pending ? messages.common.saving : messages.common.save}
          </button>
          <button type="button" onClick={onClose} className={BUTTON}>{messages.common.cancel}</button>
        </div>
      </form>
      {addingServer ? <ServerFormModal server={null} suggestions={suggestions} vpns={vpns} onClose={() => setAddingServer(false)} onSaved={setServerId} /> : null}
    </Modal>
  );
}

function accessSummary({ serverKind, path, namespace, target, container }: AccessView): string {
  return (serverKind === "ssh" ? [path] : [namespace, target, container]).filter(Boolean).join(" / ");
}

function AccessRow({ projectId, environment, access, servers, suggestions, vpns, readOnly }: {
  projectId: number;
  environment: EnvironmentView;
  access: AccessView;
  servers: ServerView[];
  suggestions: Suggestions;
  vpns: VpnView[];
  readOnly: boolean;
}) {
  const messages = useMessages();
  const m = messages.environments;
  const environmentId = environment.id;
  const [editing, setEditing] = useState(false);
  // Null while closed. What was confirmed stays so for its reconnections.
  const [consoleOpen, setConsoleOpen] = useState<{ confirmed: boolean } | null>(null);
  const [pending, start] = useTransition();
  const { confirm, confirmation } = useConfirm();
  const detail = accessSummary(access);
  // `kubectl exec` needs something to enter.
  const canOpen = !readOnly && (access.serverKind === "ssh" || access.target !== null);

  const askConsole = () => {
    if (!environment.protected) {
      setConsoleOpen({ confirmed: false });
      return;
    }
    confirm({
      ...m.consoleConfirm(environment.name, access.label),
      action: m.console,
      danger: true,
      onConfirm: () => setConsoleOpen({ confirmed: true }),
    });
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule py-2 last:border-b-0">
      <div className="min-w-0">
        <span className="font-semibold break-words">{access.label}</span> <span className={BADGE}>{messages.servers.kinds[access.serverKind]}</span>
        <p className={`${DATA} break-all text-mut`}>
          {access.serverName}
          {detail ? ` · ${detail}` : ""}
          {access.serverAuth === "password" ? ` · ${access.serverHasPassword ? messages.servers.passwordKept : messages.servers.passwordAsked}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <VpnBadge vpnId={servers.find(({ id }) => id === access.serverId)?.vpnId ?? null} vpns={vpns} />
        {canOpen ? (
          <button type="button" onClick={askConsole} className={BUTTON_SMALL}>{m.console}</button>
        ) : null}
        <TestButton serverId={access.serverId} accessId={access.id} serverName={access.label} />
        {readOnly ? null : (
          <>
            <button type="button" onClick={() => setEditing(true)} className={BUTTON_SMALL}>{m.edit}</button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                confirm({
                  title: m.deleteAccessTitle(access.label),
                  action: m.delete,
                  danger: true,
                  onConfirm: () => start(() => removeAccess(projectId, environmentId, access.id)),
                })
              }
              className={BUTTON_SMALL_DANGER}
            >
              {m.delete}
            </button>
          </>
        )}
      </div>
      {consoleOpen ? (
        <TerminalPanel
          title={`${environment.name} · ${access.label}`}
          open={() => openRemoteConsole(projectId, access.id, consoleOpen.confirmed)}
          reconnectLabel={messages.sheet.console.reconnect}
          info={environment.protected ? <span className={BADGE_ALERT}>{m.protectedBadge}</span> : undefined}
          onClose={() => setConsoleOpen(null)}
        />
      ) : null}
      {editing ? (
        <AccessFormModal projectId={projectId} environmentId={environmentId} access={access} servers={servers} suggestions={suggestions} vpns={vpns} onClose={() => setEditing(false)} />
      ) : null}
      {confirmation}
    </li>
  );
}

function EnvironmentCard({ projectId, environment, servers, suggestions, vpns, readOnly }: {
  projectId: number;
  environment: EnvironmentView;
  servers: ServerView[];
  suggestions: Suggestions;
  vpns: VpnView[];
  readOnly: boolean;
}) {
  const m = useMessages().environments;
  const [editing, setEditing] = useState(false);
  const [addingAccess, setAddingAccess] = useState(false);
  const [pending, start] = useTransition();
  const { confirm, confirmation } = useConfirm();

  return (
    <section aria-label={environment.name} className={`${CARD} ${environment.protected ? "border-l-[3px] border-l-alert" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 className="text-[17px] font-bold break-words">
          {environment.name} {environment.protected ? <span className={BADGE_ALERT}>{m.protectedBadge}</span> : null}
        </h2>
        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setAddingAccess(true)} className={BUTTON_SMALL}>
              <PlusIcon />
              {m.addAccess}
            </button>
            <button type="button" onClick={() => setEditing(true)} className={BUTTON_SMALL}>{m.edit}</button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                confirm({
                  title: m.deleteTitle(environment.name),
                  body: m.deleteBody,
                  action: m.delete,
                  danger: true,
                  onConfirm: () => start(() => removeEnvironment(projectId, environment.id)),
                })
              }
              className={BUTTON_SMALL_DANGER}
            >
              {m.delete}
            </button>
          </div>
        )}
      </div>

      {environment.urls.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {environment.urls.map(({ label, url }) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" title={url} className={BUTTON_SMALL}>
              {label || url}
              <OpenIcon />
            </a>
          ))}
        </div>
      ) : null}
      {environment.accesses.length > 0 ? (
        <ul className="mt-2">
          {environment.accesses.map((access) => (
            <AccessRow key={access.id} projectId={projectId} environment={environment} access={access} servers={servers} suggestions={suggestions} vpns={vpns} readOnly={readOnly} />
          ))}
        </ul>
      ) : null}
      {environment.notes ? <p className="mt-2 whitespace-pre-wrap text-mut">{environment.notes}</p> : null}

      {editing ? <EnvironmentFormModal projectId={projectId} environment={environment} onClose={() => setEditing(false)} /> : null}
      {addingAccess ? (
        <AccessFormModal projectId={projectId} environmentId={environment.id} access={null} servers={servers} suggestions={suggestions} vpns={vpns} onClose={() => setAddingAccess(false)} />
      ) : null}
      {confirmation}
    </section>
  );
}

export function EnvironmentsTab({ projectId, environments, servers, suggestions, vpns, readOnly }: {
  projectId: number;
  environments: EnvironmentView[];
  servers: ServerView[];
  suggestions: Suggestions;
  vpns: VpnView[];
  readOnly: boolean;
}) {
  const m = useMessages().environments;
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-4">
      <div className={CARD}>
        <div className={`${SECTION_TITLE} mb-1`}>
          <h2>{m.title}</h2>
        </div>
        <p className="pt-1 pb-3 text-[12px] text-mut">
          {m.hint} <Link href="/servers" className={LINK}>{m.catalogue}</Link>
        </p>
        {readOnly ? null : (
          <button type="button" onClick={() => setAdding(true)} className={BUTTON_PRIMARY}>
            <PlusIcon />
            {m.add}
          </button>
        )}
        {environments.length === 0 ? <p className="pt-3 text-mut">{m.none}</p> : null}
      </div>
      {environments.map((environment) => (
        <EnvironmentCard key={environment.id} projectId={projectId} environment={environment} servers={servers} suggestions={suggestions} vpns={vpns} readOnly={readOnly} />
      ))}
      {adding ? <EnvironmentFormModal projectId={projectId} environment={null} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
