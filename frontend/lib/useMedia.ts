"use client";

import { useEffect, useState } from "react";

export function useMedia(query: string, initial = false) {
  const [match, setMatch] = useState(initial);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return match;
}

/** Phones and tablets: show directions (geo: intent) and Snapp. Desktop shows contact only. */
export const useIsTouchDevice = () => useMedia("(pointer: coarse) and (max-width: 1023px)");
export const useIsDesktop = () => useMedia("(min-width: 1024px)", true);
