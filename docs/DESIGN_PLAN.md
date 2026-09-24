---
id: DESIGN_PLAN
aliases: []
tags: []
---

# Design System — AlphaMarkets Frontend Redesign

Scope decisions this plan is built on (settled during planning, see `PROJECT_BRIEF.md` §2 and this
repo's `REDESIGN_PLAN.md`):

- Color palette stays the logo-derived teal-on-dark set (owner-set 2026-09-21). Not touched here.
- No user-toggleable dark/light mode is being built. The app is fixed-dark with one light `.paper`
  region; this doc formalizes that as the documented strategy.
- Non-color styling cues were imitated from `orionisderivative.tech` (display font, glow-shadow motif,
  radius scale) — its own accent/up/down colors were Binance's brand colors and are explicitly not
  used here.

## 1. Color palette (unchanged — reference only)

Defined in `apps/web/src/app/globals.css` `@theme`. Not part of this redesign; listed here so the
design system doc is self-contained.

| Role | Token | Value |
|---|---|---|
| Ground | `--color-ground` | `#0b1211` |
| Surface | `--color-surface` | `#121b1a` |
| Raised | `--color-raised` | `#1a2624` |
| Line | `--color-line` | `#293937` |
| Text | `--color-text` | `#eef4f2` |
| Muted | `--color-muted` | `#a4b5b1` |
| Faint | `--color-faint` | `#93a4a0` |
| Accent | `--color-accent` | `#3adbd0` |
| Up | `--color-up` | `#72d977` |
| Down | `--color-down` | `#ee7069` |
| Paper (light region) | `--color-paper` / `--color-ink` | `#f7faf9` / `#0f3733` |

## 2. Typography

| Role | Token | Family | Used for |
|---|---|---|---|
| Display | `--font-serif` | **Tomorrow** (was Newsreader) | Hero headline, section titles, big figures |
| UI | `--font-sans` | Geist | Body copy, labels, controls, nav |
| Data | `--font-mono` | Geist Mono | Contract addresses, chain name, tech-stack tags — never prices |

Only the display face changes. Geist and Geist Mono already fill the same roles `orionisderivative.tech`
uses Instrument Sans and JetBrains Mono for, so they stay. Swapping Newsreader (literary serif) for
Tomorrow (geometric technical sans) moves the display voice from editorial toward institutional/
technical — closer to `PROJECT_BRIEF.md`'s "precise typography" / "financial-terminal aesthetic" line.

Type scale (unchanged, already in `@theme`): `--text-cell` (0.8125rem, table cells) → `--text-title`
(1.25rem, panel headers) → `--text-figure` (1.75rem, prices/stats) → `--text-display` (3rem, hero).
Chip/label typography gets one named source instead of five inline copies — see §4.

## 3. Spacing

Base unit stays `--spacing: 0.21875rem` (3.5px), unchanged. What changes is usage discipline: several
landing sections re-type this unit as raw pixel brackets (`py-[21px]`, `py-[35px]`) instead of the
scale classes those pixels already equal (`py-6`, `py-10` — 6×3.5=21, 10×3.5=35). This pass replaces
the brackets with the equivalent scale class everywhere the math is exact, and rounds onto the grid
where it's off by a pixel or two (e.g. `py-[18px]` → nearest of `py-5`/`py-6`).

## 4. New tokens this redesign adds

| Token | Value | Purpose |
|---|---|---|
| `--radius-control` | `6px` | Buttons, inputs, small chips |
| `--radius-panel` | `10px` | `Panel` and anything reimplementing its look |
| `--radius-feature` | `14px` | Hero's large marketing/stat cards only |
| `--radius-pill` | `9999px` | Status/market badges (formalizes existing ad-hoc `rounded-full`) |
| `--shadow-up-glow` | `0 0 20px rgb(114 217 119 / .25)` | Long/bullish emphasis (PnL, up badges) |
| `--shadow-down-glow` | `0 0 20px rgb(238 112 105 / .25)` | Short/bearish emphasis (PnL, down badges) |
| `CHIP_LABEL` (JS constant, `frame.ts`) | `text-[13px] font-medium uppercase tracking-[0.04em]` | One source for the chip-label style currently duplicated in 5 files |

Radius is used as a hierarchy signal, not applied uniformly: **sharp (0)** for tabular/ledger content
(tables, ticker rows — keeps market data reading as data, not as cards), **control** for anything
clickable at small scale, **panel** for containers, **feature** reserved for the handful of large
hero/marketing cards, **pill** for status badges. This replaces 5 previously-uncoordinated radius
values (`rounded-lg`, `rounded-md`, `rounded-[10px]`, `rounded-[14px]`, `rounded-[2px]`) with 5 named,
purposeful ones.

The glow-shadow tokens are built from the existing `--color-up`/`--color-down` hex values, not new
colors — a low-alpha halo behind up/down figures and long/short buttons, imitating
`orionisderivative.tech`'s own up/down glow treatment without adopting its (Binance-derived) hues.

**Status: done.** All 4 radius tokens and both glow tokens are in `globals.css`. `Panel.tsx`,
`MarketHeader.tsx`, `PortfolioView.tsx` now use `rounded-panel` instead of duplicating
`rounded-[10px]`. The glow halo is applied to one place only — the change chip on each
`HeroCardStack` card (`rounded-pill` + `--shadow-up-glow`/`--shadow-down-glow`) — deliberately not
to `Num`/`Change` globally, since those render in every dense table row and a halo on each one would
be decoration, not a showcase (breaks the "no oversized cards" / high-density brief mandate).

**Markets density check against `leveramarkets.tech`'s `market-tile` grid: no change needed.** Its
tiles run `min-height:190px`, `padding:30px 25px` — roomier than `LandingMarkets.tsx`'s row list
(`py-[18px]`, price + sparkline + change + funding all inline). The row list is already denser and
fits the brief's density mandate better than the reference's own tile grid does.

### Hero market-card ring (imitated from `leveramarkets.tech`)

`HeroCardStack.tsx` already implements the same concept as this reference's hero — a 3D ring of live
market cards (`.stock-scene`/`.stock-stage`/`.stock-card`, the same class names even; `BrandLogos.tsx`
already cites this reference by name). The restyle brings the card *face* closer to it, visual-only,
keeping the existing rotateY orbit mechanic and existing live-price `Quote` (no new data wiring — a
separate live-price-flash-on-tick feature was considered and explicitly deferred, since it needs real
price-tick data reaching the hero and is behavior, not styling):

- **Radius** — `rounded-[10px]` → `rounded-sharp` (new `--radius-sharp: 2px` token). Matches the
  reference's near-flat card and formalizes the one audit found `rounded-[2px]` outlier that had no
  named home.
- **Border** — `border-line/70` (a fixed dark line) → `border-white/20` (translucent light edge).
  Each card's background is a different brand color (`BrandLogos.tsx`), so a fixed dark border reads
  inconsistently against light brand fills (e.g. AAPL's near-white, NFLX's cream); a translucent white
  edge holds up across all of them, the same fix the reference's own `#ffffff38` border applies.
- **Shadow** — tightened from `0_20px_45px_-20px` to `0_16px_40px_-12px`, closer to the reference's
  crisper card lift without copying its flat `#0007`.
- **Caption row** — added one small uppercase caption line ("Live perpetual markets") beneath the
  ring, where the reference runs its `motion-row`/`scene-caption` strip. The hero previously had
  nothing there.

## 5. Dark mode strategy

Not a toggle. The app is fixed-dark (`:root { color-scheme: dark }` in `globals.css`); one region —
the landing page below the hero, and the footer's decorative panel — runs on a `.paper` class that
re-points the same token names to a light "paper" palette (`--color-ground` → `#f7faf9`, etc.), so
`Panel`, `Num`, `Change`, `Sparkline` and every hover state render correctly there without per-component
edits. This is the intentional, complete strategy: no `next-themes`, no `ThemeProvider`, no `dark:`
Tailwind variants are being introduced. `.paper` is a place (two fixed sections), not a mode a viewer
can switch.

## 6. Breakpoints

Tailwind v4 defaults (`sm`/`md`/`lg`/`xl`/`2xl`), unchanged — no project-specific override exists or is
being added. Mobile-first: base classes target the smallest viewport, `sm:`/`md:`/`lg:` layer up.
Verification pass (end of implementation) resizes to 375px and checks every touched section, with
particular attention to `StrategyBuilder.tsx`'s table (see `REDESIGN_PLAN.md`'s plan file for the
specific overflow bug being fixed there).

## 7. Motion

Budget stays at one orchestrated moment: the hero's GSAP reveal, the markets ticker marquee, and the
statement-band scroll reveal. No fade/slide-up entrance is added to individual cards or sections, and
no new per-element hover choreography beyond what exists (`stock-card` hover scale, focus rings). This
keeps the redesign from drifting into the generic "every card fades in on scroll" pattern.

---

## Implementation status

**Landing page: done.** In order:

- **Font**: `Tomorrow` replaces `Newsreader` under `--font-serif` (`layout.tsx`, `globals.css`) — every
  `font-serif` caller (hero H1, `SECTION_TITLE`, `StatementBand`, `StackPyramid`'s layer name, the
  footer wordmark) picked it up with no class renames.
- **Radius**: `--radius-control/-panel/-feature/-pill/-sharp` all in `globals.css`. Rolled out
  everywhere a bracket or `rounded-lg`/`rounded-md` matched one of them exactly (zero visual change
  where the pixel value was identical, e.g. `rounded-md` → `rounded-control` both being 6px):
  `Button.tsx`, `interaction.ts` (`chip`/`pill`/`listLink`), `Panel.tsx`, `Header.tsx`,
  `WalletButton.tsx`, `Footer.tsx`, `LandingTicker.tsx`, `page.tsx`, `StackPyramid.tsx`,
  `LandingMarkets.tsx`, `MarketHeader.tsx`, `PortfolioView.tsx`, `HeroCardStack.tsx`.
- **Spacing**: `py-[21px]`/`py-[28px]`/`py-[35px]` → `py-6`/`py-8`/`py-10` (exact grid matches) in
  `page.tsx`, `LandingFaq.tsx`, `LandingContracts.tsx`, `LandingStats.tsx`. `LandingMarkets.tsx`'s
  `py-[18px]`/`py-[24px]` didn't land on the 3.5px grid — rounded to `py-5`/`py-7` (17.5px/24.5px,
  within 0.5px of the original).
- **`CHIP_LABEL`**: added to `frame.ts`, replacing the duplicated
  `text-[13px] font-medium uppercase tracking-[0.04em]` in `page.tsx`, `StackPyramid.tsx`,
  `LandingMarkets.tsx`. (`WalletButton.tsx`/`Header.tsx`'s similar-looking strings use `!`-important
  overrides for a different job — sizing a shared `Button` to match nav height — so they stayed
  separate rather than being forced into the same constant.)
- **Hex fixes**: `StatementBand.tsx`, `Footer.tsx` (`#eef4f2` → `text-text`), `StackPyramid.tsx`
  (`#f7faf9` → `var(--color-paper)`). `layout.tsx`'s `themeColor` and `opengraph-image.tsx` now read
  from a new `apps/web/src/lib/theme-colors.ts` instead of each hardcoding the same 3 hex values.
- Grepped the whole app afterward for stray hex and `rounded-[` brackets: none left outside
  `BrandLogos.tsx` (third-party brand marks, correctly exempt) and `theme-colors.ts` itself.
- `pnpm --filter web build` passes.

**Also done, on confirmation**: `StatementBand.tsx` was dead code (never imported). Wired into
`page.tsx` between the hero and the `.paper` region, still on the dark ground — its own gradient
starts at `#06201d`, close enough to `--color-ground` (`#0b1211`) that the hero-to-band transition
reads as one continuous dark passage rather than a seam. `page.tsx`'s own top comment updated to
document the new order (hero → statement → paper region → footer).

**Not done (out of today's landing-page scope, still in the plan)**: `StrategyBuilder.tsx`'s missing
`overflow-x-auto` wrapper — a trading-terminal page, not landing.

## Hero rebuild (imitated from openjev.sh)

Second pass, same session: replaced the hero's background technique and layout, keeping the teal
palette (openjev.sh's own pink is Anthropic-unrelated but still not AlphaMarkets' brand, so not
adopted — same rule as the earlier orionisderivative.tech pass).

- **`HeroAtmosphere.tsx`** (new) replaces `SilkBackdrop.tsx` (deleted): a canvas halftone effect —
  three soft gradient blobs drift on a sine loop and nudge toward the pointer, redrawn each frame as
  a grid of dots whose *size* (not opacity) carries brightness, the real print-halftone convention.
  Runs off a 46×26 offscreen buffer so cost stays flat regardless of viewport/DPR. Respects
  `prefers-reduced-motion` (draws one static frame, no loop). Four hairline corner brackets added in
  the same component, imitating the reference's reticle frame.
- **Hero layout**: split (headline+CTA left, `HeroCardStack` market ring right) → single centered
  column, matching the reference. **`HeroCardStack.tsx` and its only other consumer, `BrandLogos.tsx`,
  were deleted** (dropped rather than relocated, on request) rather than left as dead code.
- **Caught before shipping**: `HeroMark.tsx`'s own effect checks `element.offsetParent === null` to
  skip loading its GSAP chunk on phones, relying on the old markup's `max-sm:hidden` wrapper. The
  centered rewrite initially dropped that wrapper, which would have made mobile load and animate the
  mark for the first time — restored `max-sm:hidden` around `HeroMark` in the new layout so that
  deliberate mobile-performance decision still holds.
- Orphaned `globals.css` rules from both deleted components (`.silk-*`/`silk-sway`/`silk-drift`,
  `.stock-*`/`stock-orbit`) removed.
- `pnpm --filter web build` passes. The long-running dev server's incremental cache broke on the file
  deletions (`Cannot find module './431.js'`, stale webpack manifest) — unrelated to the code itself
  (production build was clean throughout); fixed by killing it, `rm -rf .next`, and restarting.
