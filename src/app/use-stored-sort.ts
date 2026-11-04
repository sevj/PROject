"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { RegistrySort } from "@/lib/registry";

const KEY = "pm.registry.sort";
const EVENT = "pm:registry-sort";
const SORTS: readonly string[] = ["commit", "name", "dirty", "size"];

function read(): RegistrySort {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored !== null && SORTS.includes(stored) ? (stored as RegistrySort) : "commit";
  } catch {
    // Storage can be blocked: the default order does the job.
    return "commit";
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

/** The sort of the project list, kept in this browser. The server always renders the default. */
export function useStoredSort(): [RegistrySort, (sort: RegistrySort) => void] {
  const sort = useSyncExternalStore(subscribe, read, () => "commit" as RegistrySort);
  const setSort = useCallback((next: RegistrySort) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Not kept, but the change still applies below.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [sort, setSort];
}
