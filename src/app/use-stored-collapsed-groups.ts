"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { parseCollapsedGroups, toggleCollapsedGroup } from "@/lib/collapsed-groups";

const KEY = "pm.registry.collapsedGroups";
const EVENT = "pm:registry-collapsed-groups";

// Where it stays when storage is blocked: not kept, but the button still works until a reload.
let unsaved: string | null = null;

function read(): string {
  if (unsaved !== null) return unsaved;
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** The multi-projects folded in the list, kept in this browser. The server renders them all open. */
export function useStoredCollapsedGroups(): [ReadonlySet<number>, (parentId: number) => void] {
  const stored = useSyncExternalStore(subscribe, read, () => "");
  const collapsed = useMemo(() => new Set(parseCollapsedGroups(stored)), [stored]);
  const toggle = useCallback((parentId: number) => {
    const next = toggleCollapsedGroup(read(), parentId);
    try {
      window.localStorage.setItem(KEY, next);
      unsaved = null;
    } catch {
      unsaved = next;
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [collapsed, toggle];
}
