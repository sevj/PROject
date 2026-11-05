/** App logo (same drawing as icon.svg) and wordmark: PRO in the accent colour, Ject in ink. */
export function Logo({ className = "size-6" }: { className?: string }) {
  // A P whose stem turns into a J, for the PROJ of the name, and the block of a project beside it.
  // Drawn in the page's background colour: dark on the light violet, white on the deep one.
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="4" className="fill-accent" />
      <g transform="translate(1.5 0)" className="stroke-bg">
        <path d="M14 7h5a5 5 0 0 1 0 10h-5M14 7v14a4.5 4.5 0 0 1-9 0" fill="none" strokeWidth="4" strokeLinejoin="miter" />
        <rect x="20.5" y="21" width="5" height="5" stroke="none" className="fill-bg" fillOpacity="0.6" />
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="font-bold tracking-tight">
      <span className="text-accent">PRO</span>
      <span className="text-ink">Ject</span>
    </span>
  );
}
