"""
Bakes the ground's surface textures: src/assets/ground-{soil,grass,rock,sand,snow}.webp.

Each is a seamless 512² tile. RGB is the layer's colour divided by its own mean
(stored at half scale, so 0.5 means "the ground's colour as it is"); the terrain
shader multiplies it into the zone colours, so a tile adds pebbles, blades,
cracks and grain without changing what colour a zone is. A is height, for
blending the layers into each other and for the bump.

    python3 scripts/ground-textures.py [--preview]
"""

import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

N = 512
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets')
rng = np.random.default_rng(7)


def fbm(octaves, base=4, falloff=0.55, seed=0):
    """Tileable fractal noise in 0..1 (summed periodic value noise)."""
    r = np.random.default_rng(seed)
    out = np.zeros((N, N))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        f = base * 2 ** o
        g = r.random((f, f))
        # Bicubic-ish upsample of a periodic grid.
        img = Image.fromarray((g * 255).astype(np.uint8))
        big = np.asarray(Image.fromarray(np.tile(np.asarray(img), (3, 3))).resize((N * 3, N * 3), Image.BICUBIC), dtype=float)[N:2 * N, N:2 * N] / 255
        out += big * amp
        total += amp
        amp *= falloff
    out /= total
    return (out - out.min()) / (out.max() - out.min() + 1e-9)


def voronoi(count, seed=0):
    """Tileable Voronoi: distance to nearest and second-nearest point (pixels), and the nearest cell's id."""
    r = np.random.default_rng(seed)
    pts = r.random((count, 2)) * N
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    d1 = np.full((N, N), 1e9)
    d2 = np.full((N, N), 1e9)
    cell = np.zeros((N, N), dtype=int)
    for i, (px, py) in enumerate(pts):
        dx = np.abs(xx - px)
        dy = np.abs(yy - py)
        dx = np.minimum(dx, N - dx)
        dy = np.minimum(dy, N - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        cell = np.where(closer, i, cell)
        d1 = np.where(closer, d, d1)
    return d1, d2, cell


def warp(a, amount, seed):
    """Shift an image by a noise field (tileable), breaking up straight lines."""
    u = (fbm(4, 4, seed=seed) - 0.5) * amount
    v = (fbm(4, 4, seed=seed + 1) - 0.5) * amount
    yy, xx = np.mgrid[0:N, 0:N]
    return a[(yy + v).astype(int) % N, (xx + u).astype(int) % N]


def lines(strokes, width_px, bg=0.0):
    """Draws coloured strokes (x0, y0, x1, y1, rgb, h) into colour and height layers, wrapped at the edges."""
    col = Image.new('RGB', (N, N), (0, 0, 0))
    hgt = Image.new('L', (N, N), 0)
    dc, dh = ImageDraw.Draw(col), ImageDraw.Draw(hgt)
    for x0, y0, x1, y1, rgb, h, w in strokes:
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                if min(x0, x1) + ox > N + 8 or max(x0, x1) + ox < -8 or min(y0, y1) + oy > N + 8 or max(y0, y1) + oy < -8:
                    continue
                dc.line((x0 + ox, y0 + oy, x1 + ox, y1 + oy), fill=rgb, width=w)
                dh.line((x0 + ox, y0 + oy, x1 + ox, y1 + oy), fill=int(h * 255), width=w)
    return np.asarray(col, dtype=float) / 255, np.asarray(hgt, dtype=float) / 255


def save(name, rgb, h):
    """Normalises the colour to its own mean (stored at 0.5) and writes RGBA."""
    mean = rgb.reshape(-1, 3).mean(0)
    ratio = np.clip(rgb / mean * 0.5, 0, 1)
    h = (h - h.min()) / (h.max() - h.min() + 1e-9)
    img = np.dstack([ratio, h])
    Image.fromarray((img * 255).round().astype(np.uint8), 'RGBA').save(os.path.join(OUT, f'ground-{name}.webp'), quality=88, method=6)
    print(name, 'mean', (mean * 255).round(), os.path.getsize(os.path.join(OUT, f'ground-{name}.webp')) // 1024, 'KB')
    return rgb


def soil():
    """Packed earth: clods and fine grit, scattered pebbles, dark twigs and a few dry cracks."""
    base = fbm(7, 4, 0.6, seed=1)
    grit = fbm(3, 128, 0.5, seed=2)
    h = base * 0.5 + grit * 0.25
    rgb = np.dstack([0.36 + 0.1 * base, 0.27 + 0.07 * base, 0.18 + 0.05 * base]) * (0.8 + 0.4 * grit[..., None])
    # Pebbles: a sparse set of Voronoi cells, their outlines warped into irregular stones, lit from one side.
    d1, d2, cell = voronoi(420, seed=3)
    u = (fbm(4, 16, seed=33) - 0.5) * 9
    v = (fbm(4, 16, seed=34) - 0.5) * 9
    yy, xx = np.mgrid[0:N, 0:N]
    iy, ix = (yy + v).astype(int) % N, (xx + u).astype(int) % N
    d1, cell = d1[iy, ix], cell[iy, ix]
    r = np.random.default_rng(4)
    keep = r.random(420) < 0.4
    size = r.uniform(2.5, 8.0, 420)
    tone = r.uniform(0.7, 1.3, 420)
    grey = r.random(420) < 0.6
    stone = keep[cell] & (d1 < size[cell])
    dome = np.clip(1 - (d1 / size[cell]) ** 2, 0, 1) ** 0.6
    gy, gx = np.gradient(np.where(stone, dome, 0))
    lit = np.clip(0.85 - (gx + gy) * 3.0, 0.55, 1.25)
    pc = np.where(grey[cell][..., None], np.array([0.42, 0.4, 0.37]) * np.ones((N, N, 3)), np.array([0.45, 0.37, 0.28]) * np.ones((N, N, 3)))
    pc = pc * tone[cell][..., None] * lit[..., None] * (0.85 + 0.3 * fbm(3, 64, seed=35)[..., None])
    rgb = np.where(stone[..., None], pc, rgb)
    h = np.where(stone, 0.5 + 0.5 * dome, h)
    # Soft shadow pooled at the foot of each stone (down and right of it).
    sh = np.roll(np.roll(stone.astype(float), 2, 0), 2, 1)
    sh = np.asarray(Image.fromarray((sh * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)), dtype=float) / 255
    rgb = np.where(stone[..., None], rgb, rgb * (1 - 0.35 * sh[..., None]))
    # Clods: lumps of earth, lighter on top.
    clod = np.clip((fbm(4, 24, seed=36) - 0.6) * 5, 0, 1)
    rgb *= (1 + 0.18 * clod)[..., None]
    h += clod * 0.2
    # Dry cracks in patches.
    cd1, cd2, _ = voronoi(60, seed=5)
    crack = np.clip(1 - (cd2 - cd1) / 2.2, 0, 1) * (fbm(4, 4, seed=6) > 0.68)
    crack = warp(crack, 10, 7)
    rgb *= (1 - 0.55 * crack)[..., None]
    h -= crack * 0.3
    # Twigs and dead leaves.
    r = np.random.default_rng(8)
    strokes = []
    for _ in range(45):
        x, y, a, L = r.random() * N, r.random() * N, r.random() * np.pi, r.uniform(5, 14)
        c = tuple(int(v) for v in np.array([60, 44, 28]) * r.uniform(0.6, 1.2))
        strokes.append((x, y, x + np.cos(a) * L, y + np.sin(a) * L, c, 0.7, 1))
    tc, th = lines(strokes, 2)
    m = th > 0
    rgb = np.where(m[..., None], tc, rgb)
    h = np.where(m, np.maximum(h, 0.6), h)
    return save('soil', rgb, h)


def grass():
    """Short grass: dense blades in mixed greens and straw over dark soil, clover clumps, a few bare spots."""
    soil_rgb = (np.array([0.2, 0.16, 0.1]) * np.ones((N, N, 3))) * (0.7 + 0.6 * fbm(5, 16, seed=11)[..., None])
    r = np.random.default_rng(12)
    clump = fbm(5, 8, seed=13)
    strokes = []
    for _ in range(26000):
        x, y = r.random() * N, r.random() * N
        if r.random() > 0.35 + 0.65 * clump[int(y) % N, int(x) % N]:
            continue
        a = r.uniform(0, np.pi * 2)
        L = r.uniform(4, 11)
        k = r.random()
        if k < 0.6:
            c = np.array([62, 92, 34]) * r.uniform(0.7, 1.25)
        elif k < 0.85:
            c = np.array([88, 104, 44]) * r.uniform(0.8, 1.2)
        else:
            c = np.array([128, 112, 62]) * r.uniform(0.8, 1.15)
        hb = r.uniform(0.5, 1.0)
        strokes.append((x, y, x + np.cos(a) * L, y + np.sin(a) * L * 0.6, tuple(int(v) for v in np.clip(c, 0, 255)), hb, 2 if r.random() < 0.7 else 1))
    # Later strokes sit on top: sort short ones first so tall blades win.
    strokes.sort(key=lambda s: s[5])
    bc, bh = lines(strokes, 2)
    m = bh > 0
    rgb = np.where(m[..., None], bc * (0.75 + 0.45 * bh[..., None]), soil_rgb)
    h = np.where(m, bh, 0.1 * fbm(4, 16, seed=14))
    # Clover: little round leaf clusters.
    d1, _, cell = voronoi(300, seed=15)
    rr = np.random.default_rng(16)
    on = rr.random(300) < 0.3
    leaf = on[cell] & (d1 < 3.2)
    rgb = np.where(leaf[..., None], (np.array([0.2, 0.36, 0.14]) * np.ones((N, N, 3))) * (0.8 + 0.3 * (1 - d1 / 3.2))[..., None], rgb)
    h = np.where(leaf, np.maximum(h, 0.7), h)
    rgb = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.SMOOTH)
    return save('grass', np.asarray(rgb, dtype=float) / 255, h)


def rock():
    """Weathered stone: broad planes and ridges, a web of cracks, chipped grit, flecks of lichen."""
    big = fbm(7, 3, 0.62, seed=21)
    ridge = 1 - np.abs(fbm(6, 6, 0.55, seed=22) * 2 - 1)
    grit = fbm(3, 128, 0.5, seed=23)
    h = big * 0.55 + ridge * 0.3 + grit * 0.15
    g = 0.38 + 0.22 * big + 0.1 * ridge
    rgb = np.dstack([g * 1.02, g, g * 0.95]) * (0.85 + 0.3 * grit[..., None])
    # Planes: each Voronoi cell a slightly different face of the stone.
    d1, d2, cell = voronoi(22, seed=24)
    face = np.random.default_rng(25).uniform(0.88, 1.1, 22)
    rgb *= face[cell][..., None]
    edge = np.clip(1 - (d2 - d1) / 4.0, 0, 1) ** 2
    edge = warp(edge, 26, 26)
    rgb *= (1 - 0.45 * edge)[..., None]
    h -= edge * 0.35
    # Fine cracks.
    cd1, cd2, _ = voronoi(160, seed=27)
    fine = warp(np.clip(1 - (cd2 - cd1) / 1.2, 0, 1), 14, 28) * (fbm(4, 6, seed=29) > 0.6)
    rgb *= (1 - 0.3 * fine)[..., None]
    h -= fine * 0.15
    # Lichen and dark weathering stains.
    lichen = np.clip((fbm(5, 12, seed=30) - 0.62) * 6, 0, 1) * (fbm(3, 64, seed=31) > 0.4)
    rgb = rgb * (1 - lichen[..., None]) + (np.array([0.42, 0.44, 0.3]) * np.ones((N, N, 3))) * lichen[..., None]
    stain = np.clip((fbm(5, 4, seed=32) - 0.55) * 3, 0, 1)
    rgb *= (1 - 0.35 * stain)[..., None]
    return save('rock', rgb, h)


def sand():
    """Sand: wind ripples, fine grain, a scatter of shell bits and dark grains."""
    grain = fbm(2, 256, 0.5, seed=41)
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    w = fbm(5, 4, seed=42)
    ripple = 0.5 + 0.5 * np.sin((xx * 0.7 + yy * 0.3) / N * np.pi * 2 * 6 + w * 7)
    ripple = ripple ** 1.6
    h = ripple * 0.55 + grain * 0.25 + fbm(5, 4, seed=43) * 0.2
    t = 0.6 + 0.06 * ripple + 0.08 * (grain - 0.5)
    rgb = np.dstack([t * 1.05, t * 0.94, t * 0.78])
    r = np.random.default_rng(44)
    dark = r.random((N, N)) < 0.004
    light = r.random((N, N)) < 0.004
    rgb = np.where(dark[..., None], rgb * 0.55, rgb)
    rgb = np.where(light[..., None], np.minimum(1, rgb * 1.35), rgb)
    rgb *= (0.92 + 0.12 * fbm(5, 6, seed=45))[..., None]
    return save('sand', rgb, h)


def snow():
    """Snow: soft wind-carved drifts, faint ripples, blue shadow in the hollows, glinting crystals."""
    drift = fbm(6, 3, 0.55, seed=51)
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    w = fbm(4, 4, seed=52)
    ripple = 0.5 + 0.5 * np.sin((xx * 0.4 + yy * 0.9) / N * np.pi * 2 * 5 + w * 8)
    fine = fbm(3, 64, 0.5, seed=53)
    h = drift * 0.6 + ripple * 0.15 + fine * 0.25
    t = 0.86 + 0.1 * (h - 0.5)
    rgb = np.dstack([t * 0.95, t * 0.97, t * 1.02])
    # Blue in the hollows.
    hollow = np.clip((0.45 - drift) * 2.5, 0, 1)
    rgb = rgb * (1 - 0.12 * hollow[..., None]) + np.array([0.0, 0.01, 0.04]) * hollow[..., None]
    r = np.random.default_rng(54)
    glint = r.random((N, N)) < 0.006
    rgb = np.where(glint[..., None], np.minimum(1, rgb * 1.25), rgb)
    return save('snow', rgb, h)


if __name__ == '__main__':
    tiles = [soil(), grass(), rock(), sand(), snow()]
    if '--preview' in sys.argv:
        strip = np.concatenate([np.tile(np.clip(t, 0, 1), (2, 2, 1)) for t in tiles], axis=1)
        Image.fromarray((strip * 255).astype(np.uint8)).save(os.path.join(os.path.dirname(__file__), '..', 'blender', 'preview', 'ground.png'))
