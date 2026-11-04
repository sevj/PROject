"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { refreshProject } from "@/app/actions";

export function RefreshButton({ projectId, sizing }: { projectId: number; sizing: boolean }) {
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
          Calcul des tailles…
        </span>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => refreshProject(projectId))}
        className="min-h-11 cursor-pointer border border-ink px-4 font-medium hover:bg-ink hover:text-bg disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
      >
        {pending ? "Rafraîchissement…" : "Rafraîchir"}
      </button>
    </div>
  );
}
