import { useEffect } from "react";

/** The page behind stays where it is: only what covers it scrolls. */
export function usePageLock(locked = true) {
  useEffect(() => {
    if (!locked) return;
    const root = document.documentElement;
    const previous = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    // Without its scrollbar the page would grow wider and the content behind would jump.
    const scrollbar = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
    return () => {
      root.style.overflow = previous.overflow;
      root.style.paddingRight = previous.paddingRight;
    };
  }, [locked]);
}
