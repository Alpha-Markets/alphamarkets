#!/usr/bin/env python3
"""Turns the supplied logo (apps/web/src/assets/alpha-market-logo.svg, a raster colour image plus an
alpha mask wrapped in SVG) into stacked vector layers, so the mark can be morphed as paths.

Method: the logo's colours run along one ramp (deep teal, teal, bright cyan, near white), so the
lightness of a pixel orders them. Layer 0 is the whole silhouette in the darkest band. Each next
layer is the region at or above a lightness threshold, drawn over the one below. A band mixes
saturated teal (the arch and right leg) with paler mint (the left leg and foot) at the same
lightness, so each layer is filled with a linear gradient fitted to the colours of its own pixels
across the picture, not with one flat colour. Stacked, the layers rebuild the shaded ribbon. Each layer is traced to
Bezier curves with potrace and written as absolute cubic subpaths, so every point can be moved by a
warp later and every state keeps the same structure (which is what path morphing needs).

Needs: python3 with Pillow and numpy, and potrace on the PATH.
Run from the repo root:  python3 apps/web/scripts/build-logo-paths.py
"""
import base64, json, re, subprocess, sys, tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "apps/web/src/assets/alpha-market-logo.svg"
OUT = ROOT / "apps/web/src/lib/logo-paths.json"

WIDTH = 1000          # units of the output coordinate system (height follows the aspect ratio)
LAYERS = 34           # lightness bands
BLUR = 3.2            # smooths band edges before tracing, in pixels at WIDTH
POTRACE = ["-t", "40", "-a", "1.334", "-O", "3"]  # drop specks, smooth corners, merge curves


def load_logo():
    svg = SRC.read_text()
    color64, mask64 = None, None
    imgs = re.findall(r"base64,([A-Za-z0-9+/=]+)", svg)
    mask, color = imgs[0], imgs[1]  # the SVG masks the second image with the first
    tmp = Path(tempfile.mkdtemp())
    (tmp / "m.png").write_bytes(base64.b64decode(mask))
    (tmp / "c.png").write_bytes(base64.b64decode(color))
    alpha = Image.open(tmp / "m.png").convert("L")
    rgb = Image.open(tmp / "c.png").convert("RGB")
    box = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    alpha, rgb = alpha.crop(box), rgb.crop(box)
    h = round(alpha.height * WIDTH / alpha.width)
    return rgb.resize((WIDTH, h), Image.LANCZOS), alpha.resize((WIDTH, h), Image.LANCZOS)


def trace(mask_bool, name, tmp):
    """potrace one boolean mask; returns a list of subpaths as flat absolute cubic arrays."""
    h, w = mask_bool.shape
    pbm = tmp / f"{name}.pbm"
    Image.fromarray(np.where(mask_bool, 0, 255).astype(np.uint8)).convert("1").save(pbm)
    svg = tmp / f"{name}.svg"
    subprocess.run(["potrace", "-s", "-u", "10", *POTRACE, "-o", str(svg), str(pbm)], check=True)
    # potrace writes one <path> per connected component (holes stay inside their component)
    subs = []
    for d in re.findall(r' d="([^"]+)"', svg.read_text()):
        subs += parse_path(d, h)
    return subs


def parse_path(d, h):
    """potrace writes M and relative c/l; turn every segment into an absolute cubic (y flipped)."""
    tokens = re.findall(r"[MmCcLlZz]|-?\d+\.?\d*", d)
    subs, cur, i, x, y = [], None, 0, 0.0, 0.0
    cmd = None

    def num():
        nonlocal i
        v = float(tokens[i]); i += 1
        return v

    def pt(px, py):
        return [round(px / 10), round(h - py / 10)]

    while i < len(tokens):
        t = tokens[i]
        if re.match(r"[A-Za-z]", t):
            cmd = t; i += 1
            if cmd in "Zz":
                if cur: subs.append(cur); cur = None
                continue
        if cmd == "M":
            x, y = num(), num(); cur = pt(x, y)
        elif cmd == "m":
            x, y = x + num(), y + num(); cur = pt(x, y)
        elif cmd == "c":
            a, b, c2, d2, e, f = (num() for _ in range(6))
            cur += pt(x + a, y + b) + pt(x + c2, y + d2) + pt(x + e, y + f); x, y = x + e, y + f
        elif cmd == "C":
            a, b, c2, d2, e, f = (num() for _ in range(6))
            cur += pt(a, b) + pt(c2, d2) + pt(e, f); x, y = e, f
        elif cmd == "l":
            e, f = num(), num()
            cur += pt(x + e / 3 * 1, y + f / 3) + pt(x + e * 2 / 3, y + f * 2 / 3) + pt(x + e, y + f); x, y = x + e, y + f
        elif cmd == "L":
            e, f = num(), num()
            cur += pt(x + (e - x) / 3, y + (f - y) / 3) + pt(x + (e - x) * 2 / 3, y + (f - y) * 2 / 3) + pt(e, f); x, y = e, f
    if cur: subs.append(cur)
    return subs


def fit_gradient(c, band):
    """Fit a two-stop linear gradient (in output pixel space) to the colours of `band`."""
    ys, xs = np.nonzero(band)
    cols = c[band]
    if len(xs) < 50:
        return None
    # direction along which the teal-versus-pale balance (green minus red) changes most
    s = cols[:, 1] - cols[:, 0]
    design = np.stack([np.ones(len(xs)), xs, ys], axis=1)
    coef = np.linalg.lstsq(design, s, rcond=None)[0]
    d = np.array([coef[1], coef[2]])
    if np.linalg.norm(d) < 1e-6:
        return None
    d /= np.linalg.norm(d)
    t = xs * d[0] + ys * d[1]
    t0, t1 = np.percentile(t, [4, 96])
    if t1 - t0 < 4:
        return None
    a = np.stack([np.ones(len(t)), t], axis=1)
    fit = np.linalg.lstsq(a, cols, rcond=None)[0]           # 2 x 3: intercept and slope per channel
    stops = [np.clip(fit[0] + fit[1] * tt, 0, 255) for tt in (t0, t1)]
    hexs = ["#%02x%02x%02x" % tuple(int(round(v)) for v in st) for st in stops]
    return [round(float(t0 * d[0]), 1), round(float(t0 * d[1]), 1), round(float(t1 * d[0]), 1), round(float(t1 * d[1]), 1), hexs[0], hexs[1]]


def main():
    rgb, alpha = load_logo()
    w, h = rgb.size
    a = np.asarray(alpha, dtype=float) / 255
    c = np.asarray(rgb, dtype=float)
    inside = a > 0.5
    lightness = np.asarray(Image.fromarray(c.mean(axis=2).astype(np.uint8)).filter(ImageFilter.GaussianBlur(BLUR)), dtype=float)
    tmp = Path(tempfile.mkdtemp())
    sil = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(BLUR / 2)), dtype=float) > 127
    ts = [np.percentile(lightness[inside], 100 * k / LAYERS) for k in range(1, LAYERS)]
    edges = [-1.0, *ts, 256.0]
    layers = []
    for k in range(LAYERS):
        lo, hi = edges[k], edges[k + 1]
        band = inside & (lightness >= lo) & (lightness < hi)
        if band.sum() < 400:
            continue
        region = (inside if k == 0 else inside & (lightness >= lo)) & sil
        subs = trace(region, f"l{k}", tmp)
        if not subs:
            continue
        mean = c[band].mean(axis=0)
        layer = {"fill": "#%02x%02x%02x" % tuple(int(round(v)) for v in mean), "subpaths": subs}
        grad = fit_gradient(c, band)
        if grad:
            layer["grad"] = grad
        layers.append(layer)
        print(f"layer {k:2d} L>={lo:6.1f} {layer['fill']} grad {'yes' if grad else 'no '} subpaths {len(subs):2d} segments {sum((len(q) - 2) // 6 for q in subs)}", file=sys.stderr)
    OUT.write_text(json.dumps({"width": w, "height": h, "layers": layers}, separators=(",", ":")))
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1024:.0f} KB, {sum(sum((len(q) - 2) // 6 for q in l['subpaths']) for l in layers)} segments", file=sys.stderr)


if __name__ == "__main__":
    main()
