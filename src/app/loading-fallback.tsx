"use client";

import { useMessages } from "@/i18n/provider";

export function LoadingFallback() {
  return <main className="flex-1 p-4 font-mono text-[12.5px] text-mut">{useMessages().common.loading}</main>;
}
