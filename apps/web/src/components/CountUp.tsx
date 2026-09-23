"use client";

import { useEffect, useRef, useState } from "react";

/// Counts a figure up from 0 to `value` the first time it scrolls into view — a score tally, not a
/// plain appearance. Runs once, eased out, and is skipped outright (the final value shows immediately)
/// under `prefers-reduced-motion`. `value` undefined shows "–" via `format`, same as every other
/// landing-page figure that has not loaded yet.
export function CountUp({ value, format, duration = 900 }: { value: number | undefined; format: (n: number) => string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [display, setDisplay] = useState(0);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = ref.current;
    if (!el || reducedRef.current) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || value === undefined) return;
    if (reducedRef.current) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, value, duration]);

  return <span ref={ref}>{value === undefined ? "–" : format(visible ? display : 0)}</span>;
}
