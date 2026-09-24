"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface LogoMotionProps {
  /// The server-rendered svg from `MorphingLogo`.
  children: ReactNode;
  secondsPerState: number;
  paused: boolean;
}

/// Runs the loop for the svg inside it. Kept apart from `MorphingLogo` so that the logo's data (the
/// vector layers and the warp that makes the states) is not part of the page's first JavaScript: it is
/// fetched here, together with GSAP and MorphSVG, after first paint, and not at all with reduced motion.
export function LogoMotion({ children, secondsPerState, paused }: LogoMotionProps) {
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = host.current?.querySelector("svg");
    if (!root || paused) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cancelled = false;
    let stop: (() => void) | undefined;

    async function start() {
      const [{ gsap }, { MorphSVGPlugin }, { default: art }, morph] = await Promise.all([
        import("gsap"),
        import("gsap/MorphSVGPlugin"),
        import("@/lib/logo-paths.json"),
        import("@/lib/logo-morph"),
      ]);
      // Reduced motion may have been switched on, or the effect torn down, while the chunk loaded.
      if (cancelled || reduced.matches || !root) return;
      gsap.registerPlugin(MorphSVGPlugin);

      const logo = art as unknown as import("@/lib/logo-morph").LogoArt;
      const layers = Array.from(root.querySelectorAll<SVGPathElement>("[data-layer]"));
      const states = morph.allStatePaths(logo);
      const rest = states[0]!;
      const ctx = gsap.context(() => {
        const loop = gsap.timeline({ repeat: -1, defaults: { ease: "sine.inOut", duration: secondsPerState } });
        // rest, then each state in turn, then back to rest; every step moves every layer at once
        for (let step = 1; step <= states.length; step++) {
          const target = states[step % states.length]!;
          layers.forEach((layer, index) => {
            // Identical structure in every state, so a straight point-to-point morph is exact.
            // `position` pairs the subpaths of a layer by where they are, not by size, which keeps
            // near-equal islands from swapping places mid-morph.
            loop.to(layer, { morphSVG: { shape: target[index]!, type: "linear", shapeIndex: 0, map: "position" } }, (step - 1) * secondsPerState);
          });
        }
      }, root);

      // Nothing to animate while the mark is scrolled out of view.
      const watcher = new IntersectionObserver(([entry]) => {
        gsap.globalTimeline.paused(!entry?.isIntersecting);
      });
      watcher.observe(root);
      stop = () => {
        watcher.disconnect();
        gsap.globalTimeline.paused(false);
        ctx.revert();
        layers.forEach((layer, index) => layer.setAttribute("d", rest[index]!));
        stop = undefined;
      };
    }

    if (!reduced.matches) void start();
    const onChange = () => {
      if (reduced.matches) stop?.();
      else if (!stop) void start();
    };
    reduced.addEventListener("change", onChange);
    return () => {
      cancelled = true;
      reduced.removeEventListener("change", onChange);
      stop?.();
    };
  }, [paused, secondsPerState]);

  return (
    <span ref={host} className="contents">
      {children}
    </span>
  );
}
