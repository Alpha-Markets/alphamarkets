"use client";

import { useEffect, useState } from "react";

/// Wall-clock time in ms, re-rendering every second. Starts at 0 on the server so server and
/// client markup match, then fills in after hydration.
export function useNow(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
