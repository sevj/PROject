"use client";

import { useState } from "react";

/** The project's own icon, or an empty slot of the same size so the names stay aligned. */
export function ProjectFavicon({ projectId, version }: { projectId: number; version: number | null }) {
  const [failed, setFailed] = useState(false);
  if (version === null || failed) return <span aria-hidden="true" className="size-4 shrink-0" />;
  return (
    // An icon of a few hundred bytes from this machine: Next's image optimizer would only add a round trip.
    <img
      src={`/api/projects/${projectId}/favicon?v=${version}`}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-4 shrink-0 object-contain"
    />
  );
}
