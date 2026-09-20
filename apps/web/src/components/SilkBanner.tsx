/// A band of abstract, grayscale ribbons: the one piece of imagery on the landing page. Drawn in
/// SVG from the page's own off-white at low opacity, so it adds texture without adding a colour or
/// an icon. It is decorative and static.
const ribbons = Array.from({ length: 16 }, (_, i) => {
  const o = i * 8;
  return `M-80 ${230 + o * 0.5} C 180 ${20 + o}, 420 ${340 - o * 0.6}, 680 ${200 + o * 0.35} S 1060 ${30 + o * 0.9}, 1280 ${170 + o * 0.5}`;
});

export function SilkBanner({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`relative overflow-hidden rounded-[10px] border border-line/70 bg-surface ${className ?? ""}`}>
      <svg viewBox="0 0 1200 340" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="silk-fade" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--color-text)" stopOpacity="0" />
            <stop offset="0.45" stopColor="var(--color-text)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--color-text)" stopOpacity="0" />
          </linearGradient>
          <filter id="silk-soft" x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur stdDeviation="26" />
          </filter>
          <radialGradient id="silk-vignette" cx="0.5" cy="0.5" r="0.75">
            <stop offset="0.5" stopColor="var(--color-surface)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--color-surface)" stopOpacity="1" />
          </radialGradient>
        </defs>
        <path d={ribbons[6]} fill="none" stroke="var(--color-text)" strokeOpacity="0.22" strokeWidth="70" filter="url(#silk-soft)" />
        <path d={ribbons[12]} fill="none" stroke="var(--color-muted)" strokeOpacity="0.2" strokeWidth="46" filter="url(#silk-soft)" />
        {ribbons.map((d, i) => (
          <path key={d} d={d} fill="none" stroke="url(#silk-fade)" strokeWidth={i % 5 === 0 ? 1.6 : 0.8} opacity={0.35 + (i % 4) * 0.12} />
        ))}
        <rect width="1200" height="340" fill="url(#silk-vignette)" />
      </svg>
    </div>
  );
}
