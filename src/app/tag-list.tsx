export function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1" aria-label={`Tags : ${tags.join(", ")}`}>
      {tags.map((tag) => (
        <span key={tag} className="max-w-full truncate border border-rule px-1 font-mono text-[11px] leading-4 font-normal text-mut">
          {tag}
        </span>
      ))}
    </span>
  );
}
