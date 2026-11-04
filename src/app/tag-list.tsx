"use client";

import { useMessages } from "@/i18n/provider";
import { BADGE } from "./ui";

export function TagList({ tags }: { tags: string[] }) {
  const m = useMessages().tags;
  if (tags.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1" aria-label={m.list(tags)}>
      {tags.map((tag) => (
        <span key={tag} className={`${BADGE} max-w-full truncate font-normal`}>
          {tag}
        </span>
      ))}
    </span>
  );
}
