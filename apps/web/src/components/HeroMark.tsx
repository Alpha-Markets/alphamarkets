"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import mark from "@/assets/alphamarkets-mark-hero.webp";

const WORDMARK = "ALPHAMARKETS";

/// The logo lockup in the landing hero: the ribbon mark with the wordmark under it, introduced by one
/// short GSAP timeline and then left to drift. The mark is a picture (the supplied SVG wraps a raster
/// and its alpha mask), so nothing here draws paths: a wide alpha mask slides across it to unfold it,
/// a highlight clipped to the ribbon's own alpha passes over it, and the letters rise out of a clip.
///
/// 1. entrance (0 to 0.9 s): the ribbon unfolds foot to tail while it settles into place.
/// 2. icon (0.55 to 1.7 s): one light pass over the ribbon.
/// 3. wordmark (0.95 to 1.8 s): the letters rise in, one after another.
/// 4. idle: the mark floats a few pixels, and the highlight passes again every ten seconds.
///
/// Only transform, opacity and two mask or background positions change. GSAP is imported from inside
/// the effect, so it is a separate chunk that never delays first paint, and it is not loaded at all
/// when the visitor asks for reduced motion (globals.css then shows the final state). The lockup is
/// decorative: the header link and the h1 carry the accessible content.
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
        const letters = q("[data-letter]");

        gsap.set(markEl, { "--reveal": 100, opacity: 0, y: 14, scale: 0.96, rotation: -1.5, transformOrigin: "50% 60%" });
        gsap.set(sheen, { "--sheen": 100 });
        gsap.set(letters, { opacity: 0, yPercent: 110 });

        gsap
          .timeline({ defaults: { ease: "power3.out" } })
          .to(markEl, { opacity: 1, y: 0, scale: 1, duration: 0.9 }, 0)
          .to(markEl, { "--reveal": 0, duration: 1, ease: "power2.inOut" }, 0)
          .to(markEl, { rotation: 0, duration: 1.1 }, 0.4)
          .to(sheen, { "--sheen": 0, duration: 1.15, ease: "power1.inOut" }, 0.55)
          .to(letters, { opacity: 1, yPercent: 0, duration: 0.6, stagger: 0.035 }, 0.95)
          .add(() => {
            // Idle: a slow float, and the highlight again every ten seconds.
            gsap.to(drift, { y: 6, rotation: 0.6, duration: 4, ease: "sine.inOut", yoyo: true, repeat: -1 });
            gsap
              .timeline({ repeat: -1, repeatDelay: 8.85, delay: 8 })
              .fromTo(sheen, { "--sheen": 100 }, { "--sheen": 0, duration: 1.15, ease: "power1.inOut" });
          }, 1.8);
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
    <div
      ref={root}
      aria-hidden="true"
      className="hero-lockup pointer-events-none absolute left-1/2 top-[14dvh] w-[clamp(180px,52vw,320px)] -translate-x-1/2 lg:left-auto lg:right-[6vw] lg:top-[15dvh] lg:w-[clamp(300px,32vw,540px)] lg:translate-x-0"
    >
      <div data-drift className="will-change-transform">
        <div data-mark className="hero-anim hero-mark relative will-change-transform">
          <Image src={mark} alt="" priority sizes="(min-width: 1024px) 32vw, 52vw" className="block h-auto w-full" />
          <span data-sheen className="hero-sheen" style={{ maskImage: `url(${mark.src})` }} />
        </div>
      </div>
      <p className="mt-[clamp(10px,1.6vw,22px)] flex justify-center pl-[0.32em] text-[clamp(0.6875rem,1.05vw,0.9375rem)] font-medium leading-none tracking-[0.32em] text-muted">
        {WORDMARK.split("").map((letter, index) => (
          <span key={index} className="inline-block overflow-hidden py-[0.2em]">
            <span data-letter className="hero-anim inline-block">
              {letter}
            </span>
          </span>
        ))}
      </p>
      <noscript>
        <style>{".hero-anim{opacity:1;animation:none}"}</style>
      </noscript>
    </div>
  );
}
