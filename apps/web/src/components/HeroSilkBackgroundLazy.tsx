"use client";

import dynamic from "next/dynamic";

/// Purely decorative (aria-hidden), so it's dropped from SSR entirely and mounted client-side
/// only; a static gradient fallback matching the shader's own colors avoids a flash while its
/// chunk loads. `ssr: false` needs a client-component boundary, hence this thin wrapper around
/// the dynamic import — `page.tsx` itself stays a server component.
export const HeroSilkBackground = dynamic(
  () => import("./HeroSilkBackground").then((m) => m.HeroSilkBackground),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--color-accent)_10%,var(--color-ground))_0%,var(--color-ground)_70%)]"
      />
    ),
  },
);
