/// The logo as vector layers, and the morph states the hero animation moves between.
///
/// `logo-paths.json` (made by `apps/web/scripts/build-logo-paths.py` from the supplied logo) holds the
/// mark as stacked layers of absolute cubic Bezier subpaths, each filled with a gradient fitted to the
/// original shading. A morph state is not a new drawing: it is the same points moved by a smooth warp,
/// so the identity of the mark stays and every state has exactly the same path structure, which is what
/// path morphing needs to interpolate cleanly. States are described by a few soft fields, and the
/// warped result keeps the mark centred.

/// A layer: its fill, an optional linear gradient [x1, y1, x2, y2, from, to] in art units, and its
/// subpaths, each a flat array [x0, y0, (c1x, c1y, c2x, c2y, x, y) per curve].
export interface LogoLayer {
  fill: string;
  grad?: [number, number, number, number, string, string];
  subpaths: number[][];
}

export interface LogoArt {
  width: number;
  height: number;
  layers: LogoLayer[];
}

/// One soft field. Centres and radius are fractions of the art's width and height, so a field means
/// the same thing at any size.
export type Field =
  /// Scales the art about (cx, cy) by (sx, sy), fading out with distance (a gaussian of width r).
  | { kind: "scale"; cx: number; cy: number; sx: number; sy: number; r: number }
  /// A slow ripple: displaces x by ax and y by ay (fractions of width and height) along a sine of the
  /// other axis.
  | { kind: "wave"; ax: number; ay: number; fx: number; fy: number; px: number; py: number };

export interface MorphState {
  name: string;
  fields: Field[];
}

/// The states of the loop. The first is the logo exactly as supplied. The others breathe it: a lobe
/// swells while the waist between the two ends of the ribbon draws in, first on the foot side, then
/// on the tail side, with a slow ripple through the arch in between. Amplitudes stay small enough that
/// the mark is always recognisably the logo.
export const MORPH_STATES: MorphState[] = [
  { name: "rest", fields: [] },
  {
    name: "foot swells",
    fields: [
      { kind: "scale", cx: 0.22, cy: 0.62, sx: 1.1, sy: 1.07, r: 0.3 },
      { kind: "scale", cx: 0.5, cy: 0.42, sx: 0.9, sy: 1.02, r: 0.2 },
      { kind: "scale", cx: 0.82, cy: 0.42, sx: 0.95, sy: 0.96, r: 0.24 },
      { kind: "wave", ax: 0.012, ay: 0.01, fx: 1.1, fy: 0.9, px: 0.4, py: 1.3 },
    ],
  },
  {
    name: "arch rises",
    fields: [
      { kind: "scale", cx: 0.36, cy: 0.16, sx: 1.06, sy: 1.14, r: 0.28 },
      { kind: "scale", cx: 0.5, cy: 0.8, sx: 0.94, sy: 0.96, r: 0.3 },
      { kind: "scale", cx: 0.86, cy: 0.42, sx: 1.04, sy: 1.03, r: 0.2 },
      { kind: "wave", ax: 0.014, ay: 0.012, fx: 0.9, fy: 1.2, px: 1.9, py: 0.2 },
    ],
  },
  {
    name: "tail swells",
    fields: [
      { kind: "scale", cx: 0.8, cy: 0.5, sx: 1.12, sy: 1.1, r: 0.26 },
      { kind: "scale", cx: 0.5, cy: 0.4, sx: 0.9, sy: 1.03, r: 0.2 },
      { kind: "scale", cx: 0.2, cy: 0.62, sx: 0.95, sy: 0.96, r: 0.28 },
      { kind: "wave", ax: 0.012, ay: 0.011, fx: 1.2, fy: 1, px: 3.1, py: 2.4 },
    ],
  },
  {
    name: "settle",
    fields: [
      { kind: "scale", cx: 0.5, cy: 0.62, sx: 1.05, sy: 0.93, r: 0.5 },
      { kind: "scale", cx: 0.5, cy: 0.2, sx: 0.96, sy: 1.06, r: 0.25 },
      { kind: "wave", ax: 0.01, ay: 0.013, fx: 0.8, fy: 1.1, px: 4.4, py: 3.3 },
    ],
  },
];

/// How far the fields push, as a multiple of the values written in them. One knob for the whole loop:
/// raise it for a bolder breath, lower it for a calmer one.
export const STRENGTH = 1.9;

/// Where a point goes under one state, before the state is recentred.
function displacement(x: number, y: number, art: LogoArt, fields: Field[]): [number, number] {
  const u = x / art.width;
  const v = y / art.height;
  let dx = 0;
  let dy = 0;
  for (const field of fields) {
    if (field.kind === "scale") {
      const du = u - field.cx;
      const dv = v - field.cy;
      const g = Math.exp(-(du * du + dv * dv) / (2 * field.r * field.r));
      dx += (field.sx - 1) * STRENGTH * du * g * art.width;
      dy += (field.sy - 1) * STRENGTH * dv * g * art.height;
    } else {
      dx += field.ax * STRENGTH * Math.sin(2 * Math.PI * (field.fy * v) + field.px) * art.width;
      dy += field.ay * STRENGTH * Math.sin(2 * Math.PI * (field.fx * u) + field.py) * art.height;
    }
  }
  return [dx, dy];
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/// A subpath's points as an SVG path string, `M x y C ... Z`.
export function subpathToD(points: number[]): string {
  let d = `M${fmt(points[0]!)} ${fmt(points[1]!)}`;
  for (let i = 2; i < points.length; i += 6) {
    d += `C${fmt(points[i]!)} ${fmt(points[i + 1]!)} ${fmt(points[i + 2]!)} ${fmt(points[i + 3]!)} ${fmt(points[i + 4]!)} ${fmt(points[i + 5]!)}`;
  }
  return `${d}Z`;
}

/// The `d` attribute of every layer, for one state. The state's average displacement over the outline is
/// removed, so the mark stays where it is while its shape changes.
export function statePaths(art: LogoArt, state: MorphState): string[] {
  if (state.fields.length === 0) return art.layers.map((layer) => layer.subpaths.map(subpathToD).join(""));

  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const sub of art.layers[0]!.subpaths) {
    for (let i = 0; i < sub.length; i += 2) {
      const [dx, dy] = displacement(sub[i]!, sub[i + 1]!, art, state.fields);
      sx += dx;
      sy += dy;
      n++;
    }
  }
  const mx = sx / n;
  const my = sy / n;

  return art.layers.map((layer) =>
    layer.subpaths
      .map((sub) => {
        const moved = new Array<number>(sub.length);
        for (let i = 0; i < sub.length; i += 2) {
          const [dx, dy] = displacement(sub[i]!, sub[i + 1]!, art, state.fields);
          moved[i] = sub[i]! + dx - mx;
          moved[i + 1] = sub[i + 1]! + dy - my;
        }
        return subpathToD(moved);
      })
      .join(""),
  );
}

/// Every state's paths, in order, for the loop.
export function allStatePaths(art: LogoArt, states: MorphState[] = MORPH_STATES): string[][] {
  return states.map((state) => statePaths(art, state));
}

/// The largest distance any outline point of a state moves from where it rests, as a fraction of the
/// art's width. Used to keep the states subtle.
export function maxTravel(art: LogoArt, state: MorphState): number {
  const rest = art.layers[0]!.subpaths;
  const moved = state.fields.length === 0 ? rest : parsePoints(statePaths(art, state)[0]!, rest);
  let max = 0;
  rest.forEach((sub, s) => {
    const other = moved[s]!;
    for (let i = 0; i < sub.length; i += 2) max = Math.max(max, Math.hypot(sub[i]! - other[i]!, sub[i + 1]! - other[i + 1]!));
  });
  return max / art.width;
}

/// Reads the numbers back out of a path string built by `statePaths`, subpath by subpath.
function parsePoints(d: string, like: number[][]): number[][] {
  const parts = d.split("Z").filter(Boolean);
  return parts.map((part, index) => (part.match(/-?\d+\.?\d*/g) ?? []).map(Number).slice(0, like[index]!.length));
}
