"use client";

import { useMessages } from "@/i18n/provider";
import { Logo } from "./brand";

const BLOCK = "pm-shimmer bg-sel";

/**
 * While a page reads what it shows: a bar sliding along the top, the logo breathing, and the
 * outline of a page. It shows up only after a moment, so that a quick page does not flash it.
 */
export function LoadingFallback() {
  const m = useMessages().common;
  return (
    <main aria-busy="true" className="pm-loading relative flex-1">
      <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden="true">
        <div className="pm-loading-bar h-full w-1/3 bg-accent" />
      </div>
      <div className="mx-auto grid w-full max-w-[1240px] gap-6 px-5 pt-8 pb-10">
        <div role="status" className="flex items-center gap-3">
          <Logo className="pm-breathe size-8" />
          <span className="font-mono text-[12.5px] text-mut">{m.loading}</span>
        </div>
        <div className="grid gap-3" aria-hidden="true">
          <div className={`${BLOCK} h-8 w-64`} />
          <div className={`${BLOCK} h-4 w-[min(520px,80%)]`} />
        </div>
        <div className="grid gap-4 md:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="grid gap-3 border border-rule bg-panel p-4">
              <div className={`${BLOCK} h-3 w-24`} />
              <div className={`${BLOCK} h-5 w-3/4`} />
              <div className={`${BLOCK} h-3 w-full`} />
              <div className={`${BLOCK} h-3 w-5/6`} />
            </div>
          ))}
        </div>
        <div className="grid gap-2 border border-rule bg-panel p-4" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className={`${BLOCK} h-4`} style={{ width: `${92 - index * 9}%` }} />
          ))}
        </div>
      </div>
    </main>
  );
}
