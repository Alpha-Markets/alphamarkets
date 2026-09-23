"use client";

import { useEffect, useRef } from "react";

/// The page's one piece of ambient imagery, fixed behind the whole scroll (not just the hero): neon
/// streaks ("rising lines") and twinkling particles, glowing with a canvas shadow-blur for a
/// circuit-board/cyberpunk feel — from scratch (no external component registry), in the mark's own
/// accent teal.
const LINE_COUNT = 36;
const PARTICLE_COUNT = 56;

function accentRgb(): [number, number, number] {
  const fallback: [number, number, number] = [58, 219, 208]; // --color-accent, if the token isn't readable yet
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-accent")
    .trim();
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return fallback;
  return [
    parseInt(match[1], 16),
    parseInt(match[2], 16),
    parseInt(match[3], 16),
  ];
}

type Line = {
  x: number;
  y: number;
  length: number;
  width: number;
  speed: number;
  opacity: number;
};
type Particle = {
  x: number;
  y: number;
  radius: number;
  speed: number;
  phase: number;
  freq: number;
};

function randomLine(width: number, height: number): Line {
  return {
    x: Math.random() * width,
    y: height + Math.random() * height,
    length: (60 + Math.random() * 160) * (height / 900 || 1),
    width: 0.6 + Math.random() * 1.2,
    speed: 0.02 + Math.random() * 0.045,
    opacity: 0.12 + Math.random() * 0.26,
  };
}

function randomParticle(width: number, height: number): Particle {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    radius: 0.6 + Math.random() * 1.4,
    speed: 0.006 + Math.random() * 0.014,
    phase: Math.random() * Math.PI * 2,
    freq: 0.0015 + Math.random() * 0.0015,
  };
}

export function HeroAtmosphere({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const [r, g, b] = accentRgb();
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let dpr = 1;
    let lines: Line[] = [];
    let particles: Particle[] = [];

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      const width = rect?.width ?? window.innerWidth;
      const height = rect?.height ?? window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      lines = Array.from({ length: LINE_COUNT }, () =>
        randomLine(canvas.width, canvas.height),
      );
      particles = Array.from({ length: PARTICLE_COUNT }, () =>
        randomParticle(canvas.width, canvas.height),
      );
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const draw = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Rising lines: thin neon streaks, bright head fading to a transparent tail, scrolling upward
      // and re-seeding at a fresh random x once they clear the top edge. A shadow-blur glow on each
      // stroke is what turns them from plain lines into the circuit/neon "cyber" look.
      ctx.shadowBlur = 6 * dpr;
      for (const line of lines) {
        line.y -= line.speed * canvas.height * 0.01;
        if (line.y + line.length < 0) {
          Object.assign(
            line,
            randomLine(canvas.width, canvas.height),
            { y: canvas.height + line.length },
          );
        }
        const gradient = ctx.createLinearGradient(
          line.x,
          line.y,
          line.x,
          line.y + line.length,
        );
        gradient.addColorStop(
          0,
          `rgba(${r}, ${g}, ${b}, ${line.opacity})`,
        );
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.strokeStyle = gradient;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${line.opacity})`;
        ctx.lineWidth = line.width * dpr;
        ctx.beginPath();
        ctx.moveTo(line.x, line.y);
        ctx.lineTo(line.x, line.y + line.length);
        ctx.stroke();
      }

      // Particles: small glowing dots drifting upward, each twinkling on its own sine cycle like
      // status LEDs on a board.
      ctx.shadowBlur = 4 * dpr;
      for (const p of particles) {
        p.y -= p.speed * canvas.height * 0.01;
        if (p.y < -4) {
          Object.assign(
            p,
            randomParticle(canvas.width, canvas.height),
            { y: canvas.height + 4 },
          );
        }
        const twinkle =
          0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * p.freq + p.phase));
        const alpha = (twinkle * 0.85).toFixed(3);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    if (reduced) draw(0);
    else raf = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className ?? ""}`}
    >
      {/* Faint circuit-board grid, fixed (not animated) so it reads as structure under the moving
          field rather than competing with it. Page-wide now, so this also replaces the standalone
          `.grid-field` background that used to sit below the hero on its own. */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--color-accent) 1px, transparent 1px), linear-gradient(to bottom, var(--color-accent) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
      {/* Vignette: a light touch, just enough to keep the headline's contrast in the corners. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.42) 100%)",
        }}
      />
    </div>
  );
}
