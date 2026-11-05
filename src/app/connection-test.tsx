"use client";

import { type FormEvent, useState } from "react";
import { useMessages } from "@/i18n/provider";
import type { TestResult } from "@/lib/remote-servers";
import { useFlash } from "./flash";
import { Modal } from "./modal";
import { BUTTON, BUTTON_PRIMARY, BUTTON_SMALL, CHECKBOX, FIELD } from "./ui";

/** A connection takes a while, and the password must not go through a Server Action: see the route. */
async function askServer(body: { serverId: number; accessId?: number; password?: string; remember?: boolean }): Promise<TestResult> {
  const response = await fetch("/api/servers/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return { ok: false, failure: "unknown", detail: String(response.status) };
  return (await response.json()) as TestResult;
}

export function TestButton({ serverId, accessId, serverName }: { serverId: number; accessId?: number; serverName: string }) {
  const m = useMessages().servers;
  const flash = useFlash();
  const [testing, setTesting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);

  const close = () => {
    setAsking(false);
    setPassword("");
    setRemember(false);
  };

  const run = async (extra: { password?: string; remember?: boolean } = {}) => {
    setTesting(true);
    try {
      const result = await askServer({ serverId, accessId, ...extra });
      if (result.ok) {
        flash("success", m.testOk(serverName));
      } else if (result.failure === "passwordNeeded") {
        setAsking(true);
        return;
      } else {
        const reason = m.failures[result.failure];
        flash("error", result.detail ? `${reason} (${result.detail})` : reason, { seconds: 12 });
      }
    } catch {
      flash("error", m.failures.unknown);
    } finally {
      setTesting(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const extra = { password, remember };
    close();
    void run(extra);
  };

  return (
    <>
      <button type="button" disabled={testing} onClick={() => void run()} className={BUTTON_SMALL}>
        {testing ? m.testing : m.test}
      </button>
      {asking ? (
        <Modal title={m.passwordTitle(serverName)} onClose={close}>
          <form onSubmit={submit} className="grid gap-3">
            <label className="grid gap-1">
              <span>{m.password}</span>
              <input type="password" required autoFocus autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} className={FIELD} />
            </label>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" className={`${CHECKBOX} mt-0.5 shrink-0`} checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span>
                {m.remember}
                <span className="block text-[12px] text-mut">{m.rememberHint}</span>
              </span>
            </label>
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="submit" className={BUTTON_PRIMARY}>{m.test}</button>
              <button type="button" onClick={close} className={BUTTON}>{m.cancel}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
