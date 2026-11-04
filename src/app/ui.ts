export const LABEL = "font-mono text-[11px] uppercase tracking-[.06em] text-mut";
export const DATA = "font-mono text-[12.5px] tabular-nums";
export const FIELD =
  "min-h-10 w-full border border-rule-strong bg-field px-2.5 focus:border-accent focus:outline-none";
/** A line under a section's title, with the start of it in the accent color. */
export const SECTION_TITLE = `${LABEL} relative border-b border-rule-strong pb-1 after:absolute after:-bottom-px after:left-0 after:h-px after:w-8 after:bg-accent`;
export const CHECKBOX =
  "size-4 cursor-pointer appearance-none border border-mut checked:border-accent checked:bg-accent indeterminate:bg-mut";

const CONTROL =
  "inline-flex cursor-pointer items-center gap-2 disabled:cursor-default disabled:opacity-50";

/** The usual action. */
export const BUTTON = `${CONTROL} min-h-10 justify-center border border-rule-strong px-3.5 font-medium text-mut hover:border-mut hover:text-ink disabled:hover:border-rule-strong disabled:hover:text-mut`;
/** The one action a screen or a form is there for. */
export const BUTTON_PRIMARY = `${CONTROL} min-h-10 justify-center border border-accent bg-accent px-3.5 font-medium text-bg hover:brightness-110 disabled:hover:brightness-100`;
/** A secondary action inside text or a list: no box until it is pointed at. */
export const BUTTON_QUIET = `${CONTROL} -mx-2 min-h-9 px-2 text-mut hover:bg-sel hover:text-ink`;
/** Same, for an action that loses data. */
export const BUTTON_DANGER = `${CONTROL} -mx-2 min-h-9 px-2 text-mut hover:bg-sel hover:text-alert`;
/** An icon alone, which always needs an aria-label. */
export const BUTTON_ICON = `${CONTROL} size-8 shrink-0 justify-center text-mut hover:bg-sel hover:text-ink`;
/** One choice among a few, side by side. */
export const SEGMENT =
  "group -ml-px inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 border border-rule-strong px-3 font-medium text-mut first:ml-0 hover:text-ink aria-pressed:relative aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink";
