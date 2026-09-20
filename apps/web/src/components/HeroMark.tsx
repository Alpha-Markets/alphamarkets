"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import mark from "@/assets/alphamarkets-mark-hero.webp";

/// The logo mark in the landing hero, introduced by one short GSAP timeline and then left to drift.
/// The mark is a picture (the supplied SVG wraps a raster and its alpha mask), so nothing here draws
/// paths: a wide alpha mask slides across it to unfold it and a highlight clipped to the ribbon's own
/// alpha passes over it.
///
/// 1. entrance (0 to 0.9 s): the ribbon unfolds foot to tail while it settles into place.
/// 2. icon (0.55 to 1.7 s): one light pass over the ribbon.
/// 3. idle: the mark floats a few pixels, and the highlight passes again every ten seconds.
///
/// Only transform, opacity and two mask or background positions change. GSAP is imported from inside
/// the effect, so it is a separate chunk that never delays first paint, and it is not loaded at all
/// when the visitor asks for reduced motion (globals.css then shows the final state). The mark is
/// decorative: the header link and the h1 carry the accessible content. The name is not repeated
/// under it; the hero's right column says it.
export function HeroMark() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let stop: (() => void) | undefined;
    let cancelled = false;

    async function start() {
      const { gsap } = await import("gsap");
      // Reduced motion may have been switched on, or the effect torn down, while the chunk loaded.
      if (cancelled || reduced.matches || !element) return;

      element.classList.add("hero-js");
      const ctx = gsap.context(() => {
        const q = gsap.utils.selector(element);
        const [drift] = q("[data-drift]");
        const [markEl] = q("[data-mark]");
        const [sheen] = q("[data-sheen]");

        gsap.set(markEl, { "--reveal": 100, opacity: 0, y: 14, scale: 0.96, rotation: -1.5, transformOrigin: "50% 60%" });
        gsap.set(sheen, { "--sheen": 100 });

        gsap
          .timeline({ defaults: { ease: "power3.out" } })
          .to(markEl, { opacity: 1, y: 0, scale: 1, duration: 0.9 }, 0)
          .to(markEl, { "--reveal": 0, duration: 1, ease: "power2.inOut" }, 0)
          .to(markEl, { rotation: 0, duration: 1.1 }, 0.4)
          .to(sheen, { "--sheen": 0, duration: 1.15, ease: "power1.inOut" }, 0.55)
          .add(() => {
            // Idle: a slow float, and the highlight again every ten seconds.
            gsap.to(drift, { y: 6, rotation: 0.6, duration: 4, ease: "sine.inOut", yoyo: true, repeat: -1 });
            gsap
              .timeline({ repeat: -1, repeatDelay: 8.85, delay: 8 })
              .fromTo(sheen, { "--sheen": 100 }, { "--sheen": 0, duration: 1.15, ease: "power1.inOut" });
          }, 1.7);
      }, element);

      // Nothing to animate while the hero is scrolled out of view.
      const watcher = new IntersectionObserver(([entry]) => {
        gsap.globalTimeline.paused(!entry?.isIntersecting);
      });
      watcher.observe(element);

      stop = () => {
        watcher.disconnect();
        gsap.globalTimeline.paused(false);
        ctx.revert();
        element.classList.remove("hero-js");
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
  }, []);

  return (
    <div ref={root} aria-hidden="true" className="hero-lockup pointer-events-none w-[clamp(96px,16dvh,170px)]">
      <div data-drift className="will-change-transform">
        <div data-mark className="hero-anim hero-mark relative will-change-transform">
          <Image src={mark} alt="" priority sizes="170px" className="block h-auto w-full" />
          <span data-sheen className="hero-sheen" style={{ maskImage: `url(${mark.src})` }} />
        </div>
      </div>
      <noscript>
        <style>{".hero-anim{opacity:1;animation:none}"}</style>
      </noscript>
    </div>
  );
}
