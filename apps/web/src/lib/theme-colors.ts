/// The 3 hex values that render outside Tailwind's reach — the browser-chrome `themeColor` in
/// `layout.tsx` and the edge-rendered `opengraph-image.tsx` — so both stay in sync with
/// `globals.css`'s `--color-ground`/`--color-text`/`--color-muted` instead of each hardcoding its
/// own copy. If the palette ever moves, this is the one other place to update.
export const THEME_GROUND = "#0b1211";
export const THEME_TEXT = "#eef4f2";
export const THEME_MUTED = "#a4b5b1";
