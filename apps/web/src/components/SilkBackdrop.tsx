/// A field of abstract ribbons that fills the landing hero: the one piece of imagery on
/// the page. Drawn in SVG from the accent teal at low opacity, so the strands echo the logo's ribbon
/// without adding an icon. It is decorative. Each ribbon sways on its own phase of a slow loop
/// (`silk-sway` in globals.css) and the soft glows drift behind them; reduced motion stops both.
/// The band crosses the upper half of the view and a ground-coloured shade darkens the lower left,
/// where the headline sits, so the type stays readable over the strands.
const ribbons = Array.from({ length: 16 }, (_, i) => {
  const o = i * 10;
  return `M-140 ${400 + o * 0.6} C 240 ${60 + o}, 600 ${640 - o * 0.7}, 960 ${330 + o * 0.4} S 1420 ${20 + o}, 1740 ${190 + o * 0.6}`;
});

export function SilkBackdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`}>
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="silk-fade" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0" />
            <stop offset="0.45" stopColor="var(--color-accent)" stopOpacity="0.5" />
            <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
          <filter id="silk-soft" x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="40" />
          </filter>
          <radialGradient id="silk-vignette" cx="0.5" cy="0.4" r="0.8">
            <stop offset="0.45" stopColor="var(--color-ground)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--color-ground)" stopOpacity="1" />
          </radialGradient>
          <radialGradient id="silk-shade" cx="0.15" cy="1" r="0.75">
            <stop offset="0" stopColor="var(--color-ground)" stopOpacity="0.92" />
            <stop offset="0.6" stopColor="var(--color-ground)" stopOpacity="0.45" />
            <stop offset="1" stopColor="var(--color-ground)" stopOpacity="0" />
          </radialGradient>
          <pattern id="silk-grid" width="64" height="64" patternUnits="userSpaceOnUse">
            <path d="M64 0H0V64" fill="none" stroke="var(--color-accent)" strokeOpacity="0.05" strokeWidth="1" />
          </pattern>
        </defs>
        {/* A faint technical grid plate under the ribbons: a HUD base plate for the brand's own
            organic ribbon shapes, not a replacement for them. */}
        <rect width="1600" height="900" fill="url(#silk-grid)" />
        <path className="silk-drift" d={ribbons[6]} fill="none" stroke="var(--color-accent)" strokeOpacity="0.16" strokeWidth="110" filter="url(#silk-soft)" />
        <path
          className="silk-drift"
          d={ribbons[12]}
          fill="none"
          stroke="var(--color-accent)"
          strokeOpacity="0.1"
          strokeWidth="72"
          filter="url(#silk-soft)"
          style={{ animationDelay: "-11s", animationDirection: "alternate-reverse" }}
        />
        {ribbons.map((d, i) => (
          <path
            key={d}
            className="silk-ribbon"
            d={d}
            fill="none"
            stroke="url(#silk-fade)"
            strokeWidth={i % 5 === 0 ? 2 : 1}
            opacity={0.35 + (i % 4) * 0.12}
            style={{ animationDelay: `${-i * 0.7}s`, animationDuration: `${9 + (i % 4) * 1.5}s` }}
          />
        ))}
        <rect width="1600" height="900" fill="url(#silk-vignette)" />
        <rect width="1600" height="900" fill="url(#silk-shade)" />
      </svg>
    </div>
  );
}
