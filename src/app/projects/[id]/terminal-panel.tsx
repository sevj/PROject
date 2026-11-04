"use client";

import "@xterm/xterm/css/xterm.css";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { BUTTON, BUTTON_PRIMARY, DATA } from "@/app/ui";
import { useMessages } from "@/i18n/provider";
import type { StateKind } from "@/lib/docker-state";
import { StateGlyph } from "./state-badge";

type Status = "connecting" | "connected" | "closed" | "exited" | "failed";

export type TerminalGrant = { port: number; token: string } | { error: string };

const GLYPH: Record<Status, StateKind> = {
  connecting: "starting",
  connected: "running",
  closed: "stopped",
  exited: "stopped",
  failed: "failed",
};

/** A terminal stays dark, whatever the theme: its colors are the programs', not the app's. */
const THEME = {
  background: "#0c0c0f",
  foreground: "#e9e9ec",
  cursor: "#a594f9",
  cursorAccent: "#0c0c0f",
  selectionBackground: "rgba(165, 148, 249, 0.35)",
  black: "#15151a",
  red: "#e0707a",
  green: "#5fd38d",
  yellow: "#e3c070",
  blue: "#7aa2f7",
  magenta: "#a594f9",
  cyan: "#5cc8d7",
  white: "#c9c9d2",
  brightBlack: "#6d6d78",
  brightRed: "#f28b94",
  brightGreen: "#7fe3a6",
  brightYellow: "#f0d38a",
  brightBlue: "#9bb9fa",
  brightMagenta: "#bfb2fb",
  brightCyan: "#82dbe6",
  brightWhite: "#ececf0",
};

type KeyboardLock = { lock?: (keys: string[]) => Promise<void>; unlock?: () => void };
const keyboard = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

const encoder = new TextEncoder();

/**
 * A terminal in the browser, whatever runs behind it: `open` asks the server for the right
 * to connect, each time it connects. Changing `connectKey` connects again.
 */
export function TerminalPanel({
  title,
  open,
  connectKey = 0,
  reconnectLabel,
  controls,
  below,
  info,
  onClose,
}: {
  title: string;
  open: () => Promise<TerminalGrant>;
  connectKey?: number;
  reconnectLabel: string;
  controls?: ReactNode;
  below?: ReactNode;
  info?: ReactNode;
  onClose: () => void;
}) {
  const m = useMessages().sheet.console;
  const panel = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitter = useRef<FitAddon | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const opener = useRef(open);
  const connectedKey = useRef(connectKey);
  const [status, setStatus] = useState<Status>("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    opener.current = open;
  }, [open]);

  const connect = useCallback(async () => {
    const term = terminal.current;
    if (!term) return;
    socket.current?.close();
    socket.current = null;
    setStatus("connecting");
    setDetail(null);
    setExitCode(null);
    term.reset();

    const grant = await opener.current();
    if ("error" in grant) {
      setStatus("failed");
      setDetail(grant.error);
      return;
    }
    const ws = new WebSocket(`ws://127.0.0.1:${grant.port}/?token=${grant.token}`);
    ws.binaryType = "arraybuffer";
    socket.current = ws;
    // A session that was replaced must not speak for the new one.
    const current = () => socket.current === ws;

    ws.onopen = () => {
      if (!current()) return;
      setStatus("connected");
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      term.focus();
    };
    ws.onmessage = (event) => {
      if (!current()) return;
      if (typeof event.data !== "string") {
        term.write(new Uint8Array(event.data as ArrayBuffer));
        return;
      }
      const message = JSON.parse(event.data) as { type: string; code?: number | null; message?: string };
      if (message.type === "exit") {
        setExitCode(message.code ?? null);
        setStatus("exited");
      } else if (message.type === "error") {
        setDetail(message.message ?? null);
        setStatus("failed");
      }
    };
    ws.onerror = () => {
      if (!current()) return;
      setDetail(m.unreachable);
      setStatus("failed");
    };
    ws.onclose = () => {
      if (current()) setStatus((status) => (status === "connected" || status === "connecting" ? "closed" : status));
    };
  }, [m.unreachable]);

  useEffect(() => {
    let disposed = false;
    let teardown = () => {};

    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }, { Unicode11Addon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
        import("@xterm/addon-unicode11"),
      ]);
      if (disposed || !host.current) return;

      const family = getComputedStyle(document.documentElement).getPropertyValue("--font-dm-mono").trim();
      const term = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        fontFamily: `${family ? `${family}, ` : ""}ui-monospace, Menlo, Consolas, monospace`,
        fontSize: 13,
        lineHeight: 1.25,
        scrollback: 10_000,
        // Alt+key sends Escape+key on a Mac, as in the terminal of the system.
        macOptionIsMeta: true,
        rightClickSelectsWord: true,
        theme: THEME,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, "_blank", "noopener,noreferrer")));
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = "11";
      term.open(host.current);
      const refit = () => {
        try {
          fit.fit();
        } catch {
          // Hidden for a moment, such as while entering full screen: the next resize fits it.
        }
      };
      refit();
      terminal.current = term;
      fitter.current = fit;

      const send = (data: Uint8Array) => {
        const ws = socket.current;
        if (ws?.readyState === WebSocket.OPEN) ws.send(data);
      };
      term.onData((data) => send(encoder.encode(data)));
      // Mouse reports for programs such as htop or vim are bytes, not text.
      term.onBinary((data) => send(Uint8Array.from(data, (char) => char.charCodeAt(0))));
      term.onResize(({ cols, rows }) => {
        const ws = socket.current;
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
      });

      const copy = () => {
        const text = term.getSelection();
        if (text) void navigator.clipboard.writeText(text);
      };
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        const key = event.key.toLowerCase();
        // Ctrl+C interrupts, except when there is a selection: then it copies, as in a terminal window.
        if (event.ctrlKey && key === "c" && (event.shiftKey || term.hasSelection())) {
          copy();
          if (!event.shiftKey) term.clearSelection();
          return false;
        }
        // Pasting is the browser's: it fires a paste event, which the terminal turns into input.
        if ((event.ctrlKey && key === "v") || (event.shiftKey && key === "insert")) return false;
        return true;
      });

      const observer = new ResizeObserver(refit);
      observer.observe(host.current);
      teardown = () => {
        observer.disconnect();
        socket.current?.close();
        socket.current = null;
        term.dispose();
        terminal.current = null;
        fitter.current = null;
      };
      void connect();
    })();

    return () => {
      disposed = true;
      teardown();
    };
  }, [connect]);

  useEffect(() => {
    if (connectKey === connectedKey.current) return;
    connectedKey.current = connectKey;
    void connect();
  }, [connectKey, connect]);

  // The page behind stays where it is: only the terminal scrolls while the console is open.
  useEffect(() => {
    const root = document.documentElement;
    const previous = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    // Without its scrollbar the page would grow wider and the content behind would jump.
    const scrollbar = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
    return () => {
      root.style.overflow = previous.overflow;
      root.style.paddingRight = previous.paddingRight;
    };
  }, []);

  useEffect(() => {
    const onChange = () => {
      const on = document.fullscreenElement === panel.current;
      setFullscreen(on);
      if (!on) keyboard()?.unlock?.();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      keyboard()?.unlock?.();
    };
  }, []);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await panel.current?.requestFullscreen();
    // In full screen the browser lets go of its own shortcuts, which a shell uses a lot.
    await keyboard()?.lock?.(["Escape", "KeyW", "KeyT", "KeyN", "Tab"]).catch(() => undefined);
    terminal.current?.focus();
  };

  const label =
    status === "connecting"
      ? m.connecting
      : status === "connected"
        ? m.connected
        : status === "exited"
          ? m.exited(exitCode)
          : status === "failed"
            ? m.failed
            : m.closed;

  return (
    <section
      ref={panel}
      role="dialog"
      aria-label={title}
      className="fixed inset-3 z-50 flex flex-col overscroll-contain border border-rule-strong bg-bg max-sm:inset-0"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule-strong px-3 py-2">
        <h2 className="min-w-0 flex-1 font-semibold break-all">{title}</h2>
        {info}
        <span role="status" className={`${DATA} inline-flex items-center gap-2`}>
          <StateGlyph kind={GLYPH[status]} />
          {label}
        </span>
        <div className="flex flex-wrap gap-2">
          {controls}
          {status === "closed" || status === "exited" || status === "failed" ? (
            <button type="button" onClick={() => void connect()} className={BUTTON_PRIMARY}>
              {reconnectLabel}
            </button>
          ) : null}
          <button type="button" onClick={() => void toggleFullscreen()} className={BUTTON}>
            {fullscreen ? m.exitFullscreen : m.fullscreen}
          </button>
          <button type="button" onClick={onClose} className={BUTTON}>
            {m.close}
          </button>
        </div>
      </header>

      {below}

      {detail ? (
        <p role="alert" className={`${DATA} border-b border-alert px-3 py-2 break-words whitespace-pre-wrap text-alert`}>
          {detail}
        </p>
      ) : null}

      <div ref={host} onClick={() => terminal.current?.focus()} className="min-h-0 flex-1 bg-[#0c0c0f] p-2" />

      <p className={`${DATA} border-t border-rule px-3 py-1.5 text-mut`}>{m.shortcuts}</p>
    </section>
  );
}
