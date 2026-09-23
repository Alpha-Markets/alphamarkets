"use client";

import { cn } from "@alphamarkets/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";

/// Fades, lifts and pops a section in, once, the first time it crosses into view — the one
/// scroll-driven motion on the landing page below the hero, applied the same way to every section so
/// scrolling itself reads as a small reward each time, not a jump cut between sections. The pop is a
/// back-out easing curve on the same transform (settles a touch past 1, then eases back), not a
/// separate bounce animation — one property doing the work, not several competing motions. Reveals
/// early enough (rootMargin) that it finishes before the section is centred, and never re-hides on the
/// way back up. Skipped outright under reduced motion.
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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
      { threshold: 0.1, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1.42,0.36,1)]",
        visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-8 scale-[0.97] opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
