export const LABEL = "font-mono text-[11px] uppercase tracking-[.06em] text-mut";
export const DATA = "font-mono text-[12.5px] tabular-nums";
export const FIELD =
  "min-h-10 w-full border border-rule-strong bg-field px-2.5 focus:border-accent focus:outline-none";
/** A line under a section's title, with the start of it in the accent color. */
export const SECTION_TITLE = `${LABEL} relative border-b border-rule-strong pb-1 after:absolute after:-bottom-px after:left-0 after:h-px after:w-8 after:bg-accent`;
/** A group of information that stands on its own. */
export const CARD = "min-w-0 border border-rule bg-panel p-4";
export const CHECKBOX =
  "size-4 cursor-pointer appearance-none border border-mut checked:border-accent checked:bg-accent indeterminate:bg-mut";

/**
 * Violet is what can be clicked, grey is what can only be read: the color tells them apart,
 * so no box is needed around every action. Orange stays for what needs attention.
 */
const CONTROL =
  "inline-flex cursor-pointer items-center justify-center gap-2 border border-transparent font-sans text-[14px] font-medium disabled:cursor-default disabled:opacity-50";
const REGULAR = "min-h-10 px-3.5";
const SMALL = "min-h-8 px-2.5";
const SURFACE = "bg-accent-soft text-accent hover:bg-accent/20 disabled:hover:bg-accent-soft";
/** Becomes orange only when pointed at: on every line of a list, it would drown real alerts. */
const SURFACE_DANGER = "bg-accent-soft text-accent hover:bg-alert/20 hover:text-alert disabled:hover:bg-accent-soft disabled:hover:text-accent";
const SURFACE_PRIMARY = "bg-accent text-bg hover:brightness-110 disabled:hover:brightness-100";
const SURFACE_PRIMARY_DANGER = "bg-alert text-bg hover:brightness-110 disabled:hover:brightness-100";
const PRESSED = "aria-pressed:bg-accent aria-pressed:text-bg";

/** The usual action. */
export const BUTTON = `${CONTROL} ${REGULAR} ${SURFACE}`;
/** Same, among the lines of a list or a table. */
export const BUTTON_SMALL = `${CONTROL} ${SMALL} ${SURFACE}`;
/** The one action a screen or a form is there for. */
export const BUTTON_PRIMARY = `${CONTROL} ${REGULAR} ${SURFACE_PRIMARY}`;
export const BUTTON_PRIMARY_SMALL = `${CONTROL} ${SMALL} ${SURFACE_PRIMARY}`;
/** An action that loses data, which still asks before doing so. */
export const BUTTON_DANGER = `${CONTROL} ${REGULAR} ${SURFACE_DANGER}`;
export const BUTTON_SMALL_DANGER = `${CONTROL} ${SMALL} ${SURFACE_DANGER}`;
/** The confirmation of an action that loses data. */
export const BUTTON_PRIMARY_DANGER = `${CONTROL} ${REGULAR} ${SURFACE_PRIMARY_DANGER}`;
/** An icon alone, which always needs an aria-label. Its background appears when pointed at. */
export const BUTTON_ICON = `${CONTROL} size-8 shrink-0 text-accent hover:bg-accent-soft`;
/** Something that is on or off. */
export const BUTTON_TOGGLE = `${BUTTON} ${PRESSED}`;
export const BUTTON_TOGGLE_SMALL = `${BUTTON_SMALL} group ${PRESSED}`;
/** One choice among a few, side by side. */
export const SEGMENT = `${BUTTON} group ${PRESSED}`;
export const SEGMENT_SMALL = `${BUTTON_SMALL} group ${PRESSED}`;
/** Goes elsewhere, inside text or a list. */
export const LINK = "cursor-pointer text-accent hover:underline";
/** A fact about something, which does nothing when clicked. */
export const BADGE = "inline-block bg-sel px-1.5 font-mono text-[11px] leading-[18px] text-mut";
export const BADGE_ALERT = "inline-block bg-alert/15 px-1.5 font-mono text-[11px] leading-[18px] text-alert";
