export const LABEL = "font-mono text-[11px] uppercase tracking-[.06em] text-mut";
export const DATA = "font-mono text-[12.5px] tabular-nums";
export const FIELD = "min-h-10 w-full border border-rule bg-panel px-2.5";
export const CHECKBOX =
  "size-4 cursor-pointer appearance-none border border-mut checked:border-ink checked:bg-ink indeterminate:bg-mut";

const CONTROL =
  "inline-flex cursor-pointer items-center gap-2 disabled:cursor-default disabled:opacity-50";

/** The usual action. */
export const BUTTON = `${CONTROL} min-h-10 justify-center border border-rule bg-sel px-3.5 font-medium hover:border-mut disabled:hover:border-rule`;
/** The one action a screen or a form is there for. */
export const BUTTON_PRIMARY = `${CONTROL} min-h-10 justify-center border border-ink bg-ink px-3.5 font-medium text-bg hover:border-mut hover:bg-mut disabled:hover:border-ink disabled:hover:bg-ink`;
/** A secondary action inside text or a list: no box until it is pointed at. */
export const BUTTON_QUIET = `${CONTROL} -mx-2 min-h-9 px-2 text-mut hover:bg-sel hover:text-ink`;
/** Same, for an action that loses data. */
export const BUTTON_DANGER = `${CONTROL} -mx-2 min-h-9 px-2 text-mut hover:bg-sel hover:text-alert`;
/** An icon alone, which always needs an aria-label. */
export const BUTTON_ICON = `${CONTROL} size-8 shrink-0 justify-center text-mut hover:bg-sel hover:text-ink`;
/** One choice among a few, side by side. */
export const SEGMENT =
  "group -ml-px inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 border border-rule px-3 font-medium text-mut first:ml-0 hover:text-ink aria-pressed:relative aria-pressed:border-mut aria-pressed:bg-sel aria-pressed:text-ink";
