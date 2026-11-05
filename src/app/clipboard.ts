/**
 * The clipboard API exists only on https or localhost: the app opened by a local name over
 * http goes through a hidden text area and the older copy command instead.
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused: the older way may still be allowed.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  // Inside an open dialog or a full-screen element, where the focus is kept.
  const host = document.fullscreenElement ?? document.querySelector("dialog[open]") ?? document.body;
  const focused = document.activeElement as HTMLElement | null;
  host.appendChild(area);
  area.select();
  let done = false;
  try {
    done = document.execCommand("copy");
  } catch {
    done = false;
  }
  area.remove();
  focused?.focus();
  return done;
}
