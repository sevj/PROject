/** App logo (same drawing as icon.svg) and wordmark: PRO in the accent colour, the rest in ink. */
export function Logo({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="7" className="fill-accent" />
      <path
        d="M10.5 25V7.5h7a4.75 4.75 0 0 1 0 9.5h-7"
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <rect x="19" y="19" width="6.5" height="6.5" rx="1.2" fill="#fff" fillOpacity="0.7" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="font-bold tracking-tight">
      <span className="text-accent">PRO</span>
      <span className="text-ink">ject</span>
    </span>
  );
}
