"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { refreshProject } from "@/app/actions";
import { BUTTON } from "@/app/ui";
import { useMessages } from "@/i18n/provider";

export function RefreshButton({ projectId, sizing }: { projectId: number; sizing: boolean }) {
  const m = useMessages().sheet;
  const router = useRouter();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!sizing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [sizing, router]);

  return (
    <div className="flex items-center gap-3">
      {sizing && !pending ? (
        <span role="status" className="font-mono text-[12.5px] text-mut">
          {m.sizing}
        </span>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => refreshProject(projectId))}
        className={BUTTON}
      >
        {pending ? m.refreshing : m.refresh}
      </button>
    </div>
  );
}
