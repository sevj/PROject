"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useMessages } from "@/i18n/provider";
import { layoutMap } from "@/lib/project-map";
import type { ProjectMap } from "@/server/project-map";
import { FIELD, LABEL } from "../ui";
import { STATE_COLORS } from "./map-canvas";

// The canvas measures the screen: it is drawn in the browser only.
const MapCanvas = dynamic(() => import("./map-canvas").then((module) => module.MapCanvas), { ssr: false });

export function MapView({ map }: { map: ProjectMap }) {
  const m = useMessages().map;
  const [only, setOnly] = useState<number | null>(null);
  const layout = useMemo(() => layoutMap(map.projects.filter((project) => only === null || project.id === only)), [map.projects, only]);

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-[32px] leading-none font-bold tracking-tight">{m.title}</h1>
        <p className="mt-2 max-w-2xl text-mut">{m.intro}</p>
        <p className="mt-1 max-w-2xl text-[12px] text-mut">{m.note}</p>
      </header>
      {map.error ? <p className="text-alert">{m.dockerUnavailable(map.error)}</p> : null}
      {map.projects.length === 0 ? (
        <p className="text-mut">{m.none}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="min-w-60">
              <span className={`${LABEL} block pb-1`}>{m.project}</span>
              <select value={only ?? ""} onChange={(event) => setOnly(event.target.value === "" ? null : Number(event.target.value))} className={FIELD}>
                <option value="">{m.all}</option>
                {map.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-3 pb-2 text-[12px] text-mut" aria-label={m.legend}>
              {(["running", "stopped", "absent", "other"] as const).map((state) => (
                <span key={state} className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-full" style={{ background: STATE_COLORS[state] }} />
                  {m.states[state]}
                </span>
              ))}
            </div>
          </div>
          <div className="h-[calc(100vh-300px)] min-h-[480px] border border-rule bg-panel">
            <MapCanvas key={only ?? "all"} layout={layout} />
          </div>
        </>
      )}
    </div>
  );
}
