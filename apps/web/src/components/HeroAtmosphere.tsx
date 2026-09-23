"use client";

import { useEffect, useRef } from "react";

/// The page's one piece of ambient imagery, fixed behind the whole scroll (not just the hero): neon
/// streaks ("rising lines"), twinkling particles, and a drifting field of coin/token discs, all
/// glowing with a canvas shadow-blur for a circuit-board/cyberpunk feel — from scratch (no external
/// component registry), in the mark's own accent teal. The coin field is the interactive layer: each
/// coin parallaxes off the pointer by its own depth, and brightens as the cursor nears it.
const LINE_COUNT = 36;
const PARTICLE_COUNT = 56;
const COIN_COUNT = 12;
/// How far the nearest (depth 1) asteroid shifts per full pointer swing, in CSS px before the DPR scale.
const PARALLAX_MAX_PX = 34;
/// Cursor-to-asteroid distance (CSS px) inside which a rock starts brightening toward the cursor.
const HOVER_RADIUS_PX = 160;

function accentRgb(): [number, number, number] {
  const fallback: [number, number, number] = [58, 219, 208]; // --color-accent, if the token isn't readable yet
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return fallback;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

type Line = { x: number; y: number; length: number; width: number; speed: number; opacity: number };
type Particle = { x: number; y: number; radius: number; speed: number; phase: number; freq: number };
/// A coin's position and spin are pure functions of time (seed + drift * t, wrapped 0..1) rather
/// than mutated state — the same trick the field's very first version used for its drift blobs — so
/// nothing needs re-seeding on resize beyond the rim silhouette itself.
type Coin = {
  seedX: number;
  seedY: number;
  driftX: number;
  driftY: number;
  spinPhase: number;
  spinSpeed: number;
  size: number;
  depth: number;
  rimRatios: number[];
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

function randomCoin(): Coin {
  const depth = 0.15 + Math.random() * 0.85;
  const sides = 20 + Math.floor(Math.random() * 5);
  return {
    seedX: Math.random(),
    seedY: Math.random(),
    driftX: (Math.random() - 0.5) * 0.00003,
    driftY: -(0.00002 + Math.random() * 0.00004),
    spinPhase: Math.random() * Math.PI * 2,
    spinSpeed: (Math.random() - 0.5) * 0.0003,
    size: 6 + depth * 16,
    depth,
    rimRatios: Array.from({ length: sides }, () => 0.92 + Math.random() * 0.08),
  };
}

export function HeroAtmosphere({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const [r, g, b] = accentRgb();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dpr = 1;
    let lines: Line[] = [];
    let particles: Particle[] = [];
    const coins: Coin[] = Array.from({ length: COIN_COUNT }, randomCoin);
    // Normalised -1..1 pointer position, so parallax strength reads the same regardless of hero size.
    // px/py start far off-canvas so no rock shows a false hover-glow before the pointer ever moves.
    const pointer = { x: 0, y: 0, px: -9999, py: -9999 };

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      const width = rect?.width ?? window.innerWidth;
      const height = rect?.height ?? window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      lines = Array.from({ length: LINE_COUNT }, () => randomLine(canvas.width, canvas.height));
      particles = Array.from({ length: PARTICLE_COUNT }, () => randomParticle(canvas.width, canvas.height));
    };
    resize();
    window.addEventListener("resize", resize);

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      pointer.px = (event.clientX - rect.left) * dpr;
      pointer.py = (event.clientY - rect.top) * dpr;
    };
    window.addEventListener("pointermove", onPointerMove);

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
          Object.assign(line, randomLine(canvas.width, canvas.height), { y: canvas.height + line.length });
        }
        const gradient = ctx.createLinearGradient(line.x, line.y, line.x, line.y + line.length);
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${line.opacity})`);
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
          Object.assign(p, randomParticle(canvas.width, canvas.height), { y: canvas.height + 4 });
        }
        const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * p.freq + p.phase));
        const alpha = (twinkle * 0.85).toFixed(3);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Coin field: token discs drifting on their own slow diagonal, wrapping edge to edge. Nearer
      // coins (higher depth) sit bigger, glow brighter, parallax more off the pointer, and brighten
      // further the closer the cursor sits to them — the field's interactive layer.
      for (const coin of coins) {
        const driftedX = ((coin.seedX + coin.driftX * time) % 1 + 1) % 1;
        const driftedY = ((coin.seedY + coin.driftY * time) % 1 + 1) % 1;
        const parallaxX = pointer.x * coin.depth * PARALLAX_MAX_PX * dpr;
        const parallaxY = pointer.y * coin.depth * PARALLAX_MAX_PX * dpr;
        const cx = driftedX * canvas.width + parallaxX;
        const cy = driftedY * canvas.height + parallaxY;

        const distance = Math.hypot(pointer.px - cx, pointer.py - cy) / dpr;
        const proximity = Math.max(0, 1 - distance / HOVER_RADIUS_PX);
        const baseAlpha = 0.14 + coin.depth * 0.3;
        const alpha = Math.min(1, baseAlpha + proximity * 0.5);
        const radius = coin.size * dpr;
        const angle = coin.spinPhase + coin.spinSpeed * time;

        ctx.beginPath();
        coin.rimRatios.forEach((ratio, i) => {
          const a = angle + (i / coin.rimRatios.length) * Math.PI * 2;
          const vx = cx + Math.cos(a) * radius * ratio;
          const vy = cy + Math.sin(a) * radius * ratio;
          if (i === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        });
        ctx.closePath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(alpha * 0.22).toFixed(3)})`;
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        ctx.shadowBlur = (6 + proximity * 16) * dpr;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = (0.8 + coin.depth * 0.8) * dpr;
        ctx.fill();
        ctx.stroke();

        // Inner ring: a plain concentric circle (not jittered, unlike the rim) so the contrast
        // between the fine-grained outer edge and the smooth inner face reads as a stamped coin.
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(alpha * 0.55).toFixed(3)})`;
        ctx.lineWidth = (0.6 + coin.depth * 0.5) * dpr;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    if (reduced) draw(0);
    else raf = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden="true" className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className ?? ""}`}>
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
      {/* Vignette: a lighter touch than a flat field would need, since the coin glow now carries
          most of the depth — just enough to keep the headline's contrast in the corners. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.42) 100%)" }}
      />
    </div>
  );
}
