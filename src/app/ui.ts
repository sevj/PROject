export const LABEL = "font-mono text-[11.5px] uppercase tracking-[.05em] text-mut";
export const DATA = "font-mono text-[13px] tabular-nums";
export const FIELD =
  "min-h-10 w-full border border-rule-strong bg-field px-2.5 focus:border-accent focus:outline-none";
/** A line under a section's title, with the start of it in the accent color. */
export const SECTION_TITLE = `${LABEL} relative border-b border-rule-strong pb-1 after:absolute after:-bottom-px after:left-0 after:h-px after:w-8 after:bg-accent`;
/** The title of a page, alone: no sentence under it. */
export const PAGE_TITLE = "text-[32px] leading-none font-bold tracking-tight";
/** A group of information that stands on its own. */
export const CARD = "min-w-0 border border-rule bg-panel p-4";
export const CHECKBOX =
  "size-4 cursor-pointer appearance-none border border-mut checked:border-accent checked:bg-accent indeterminate:bg-mut";

/**
 * Violet is what can be clicked, grey is what can only be read: the color tells them apart,
 * so no box is needed around every action. Orange stays for what needs attention.
 * Three weights tell what matters: filled for the one action of a screen, tinted for the usual ones,
 * outlined for the rare ones and those repeated on every line.
 */
const CONTROL =
  "inline-flex cursor-pointer items-center justify-center gap-2 border font-sans text-[14px] font-medium disabled:cursor-default disabled:opacity-50";
const REGULAR = "min-h-10 px-3.5";
const SMALL = "min-h-8 px-2.5";
const SURFACE = "border-transparent bg-accent-soft text-accent hover:bg-accent/20 disabled:hover:bg-accent-soft";
/**
 * Lighter, for the actions repeated on every line of a list and the rare ones of a screen: an outline
 * instead of a fill, so that a column of them does not outweigh the content, and filled buttons stand out.
 */
const SURFACE_QUIET =
  "border-accent/30 text-accent hover:border-accent/50 hover:bg-accent-soft disabled:hover:border-accent/30 disabled:hover:bg-transparent";
/** Orange from the start on its own, so that it is not taken for a harmless action before being pointed at. */
const SURFACE_DANGER = "border-transparent bg-alert/10 text-alert hover:bg-alert/20 disabled:hover:bg-alert/10";
/** Becomes orange only when pointed at: on every line of a list, it would drown real alerts. */
const SURFACE_QUIET_DANGER =
  "border-accent/30 text-accent hover:border-alert/60 hover:bg-alert/15 hover:text-alert disabled:hover:border-accent/30 disabled:hover:bg-transparent disabled:hover:text-accent";
const SURFACE_PRIMARY = "border-transparent bg-accent text-bg hover:brightness-110 disabled:hover:brightness-100";
const SURFACE_PRIMARY_DANGER = "border-transparent bg-alert text-bg hover:brightness-110 disabled:hover:brightness-100";
const PRESSED = "aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-bg aria-pressed:hover:bg-accent";

/** The usual action. */
export const BUTTON = `${CONTROL} ${REGULAR} ${SURFACE}`;
/** Same, among the lines of a list or a table. */
export const BUTTON_SMALL = `${CONTROL} ${SMALL} ${SURFACE_QUIET}`;
/** The one action a screen or a form is there for. */
export const BUTTON_PRIMARY = `${CONTROL} ${REGULAR} ${SURFACE_PRIMARY}`;
export const BUTTON_PRIMARY_SMALL = `${CONTROL} ${SMALL} ${SURFACE_PRIMARY}`;
/** An action that loses data, which still asks before doing so. */
export const BUTTON_DANGER = `${CONTROL} ${REGULAR} ${SURFACE_DANGER}`;
export const BUTTON_SMALL_DANGER = `${CONTROL} ${SMALL} ${SURFACE_QUIET_DANGER}`;
/** The confirmation of an action that loses data. */
export const BUTTON_PRIMARY_DANGER = `${CONTROL} ${REGULAR} ${SURFACE_PRIMARY_DANGER}`;
/** A secondary action at a screen's size: outlined, beside a filled one that matters more. */
export const BUTTON_QUIET = `${CONTROL} ${REGULAR} ${SURFACE_QUIET}`;
/** An icon alone, which always needs an aria-label. Its background appears when pointed at. */
export const BUTTON_ICON = `${CONTROL} size-8 shrink-0 border-transparent text-accent hover:bg-accent-soft`;
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

/** A tab of a page, as a link: the open one carries `aria-current="page"`. */
export const TAB =
  "-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-3.5 font-medium text-mut hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink";
