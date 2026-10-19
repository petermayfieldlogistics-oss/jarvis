"""Mythbound's creatures and great foes, modelled anew in Blender over their own skeletons.

    npx vite-node scripts/dump-creatures.ts      # the skeletons (and the old bodies, for sizes)
    python blender/beasts.py [kind ...] [--preview]

Each builder sculpts its creature from metaball clay around the skeleton the
game animates (so every animation still plays), adds hard parts (claws,
teeth, horns, eyes), and paints it with colour slots the game fills from the
creature's own colour (so a frost wolf and a grey wolf share one model). The
result goes into src/assets/creatures.bin.gz beside whatever else is there.
"""

import gzip
import json
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402,I001
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

import forge as F  # noqa: E402
from kit import DARK, FIXED, GLOW, LIGHT, MAIN, Beast, G, Part, lerp, look, pack  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RIGS = os.path.join(HERE, 'rigs')
OUT = os.path.join(HERE, '..', 'src', 'assets', 'creatures.bin.gz')
BUILDERS = {}
# The colour each was modelled for (the game's default), for previews.
COLOURS = {}


def builder(kind, colour):
    def wrap(fn):
        BUILDERS[kind] = fn
        COLOURS[kind] = colour
        return fn
    return wrap


def gv(b, x=0.0, y=0.0, z=0.0):
    """A point offset from a joint, offsets in the game's axes (x right, y up, z forward)."""
    return b + G(x, y, z)


# ------------------------------------------------------------------ canines --


def canine(bt, heavy=False):
    """A wolf (or, heavy, a magma hound): lean deep-chested runner, long snout, bushy tail."""
    n = bt.n
    B = bt.B
    hips, chest = n['hips'], n['chest']
    neck, head, jaw = n['neck'], n['head'], n['jaw']
    k = 1.15 if heavy else 1.0
    H, C = B[hips], B[chest]
    torso = [hips, chest]
    back = 0.62 if not heavy else None
    # Pale legs, throat and muzzle on a wolf; a hound is soot-dark there instead.
    pale = (lambda v, nn: True) if not heavy else None
    legc = dict(light=pale) if not heavy else dict(slot=DARK)
    # The ribcage, deep and narrow; a tucked waist; the haunches.
    bt.blob(gv(C, 0, -0.02, -0.04), 0.15 * k, 0.2 * k, 0.27, bones=[chest], belly=not heavy, back=back, mottle=0.25)
    bt.capsule(gv(C, 0, -0.03, -0.2), gv(H, 0, 0.0, 0.05), 0.125 * k, 0.11 * k, bones=torso, belly=True, back=back, mottle=0.25)
    bt.blob(gv(H, 0, 0.02, -0.06), 0.145 * k, 0.15 * k, 0.19, bones=[hips], belly=True, back=back, mottle=0.25)
    # Neck and ruff.
    N0, N1, Hd = B[neck[0]], B[neck[-1]], B[head]
    bt.capsule(gv(C, 0, 0.06, 0.1), gv(Hd, 0, -0.03, -0.06), 0.12 * k, 0.085 * k, bones=[chest] + neck, belly=-0.1, back=back, mottle=0.3)
    for i in range(7):
        a = (i / 6 - 0.5) * 2.2
        bt.blob(gv(N0, math.sin(a) * 0.1 * k, 0.03 + math.cos(a) * 0.06, 0.04), 0.07 * k, 0.05, 0.06, rot=(0, 0.4 * math.sin(a), 0), bones=neck + [chest], belly=-0.1, back=back, mottle=0.35)
    # The head: a broad skull, cheek fluff, a long tapering snout and a black nose.
    bt.blob(gv(Hd, 0, 0.0, 0.02), 0.085 * k, 0.075 * k, 0.095, bones=[head], light=lambda v, nn: nn.z < -0.3)
    for s in (-1, 1):
        bt.blob(gv(Hd, s * 0.065 * k, -0.03, 0.0), 0.04, 0.035, 0.05, bones=[head], light=pale)
    snout_a, snout_b = gv(Hd, 0, -0.01, 0.07), gv(Hd, 0, -0.035, 0.28)
    bt.capsule(snout_a, snout_b, 0.048 * k, 0.03, bones=[head], light=lambda v, nn: nn.z < 0.2)
    bt.blob(gv(Hd, 0, -0.023, 0.295), 0.022, 0.018, 0.016, bones=[head], slot=FIXED, rgb=0x1a1414)
    # Brow ridge over the eyes.
    for s in (-1, 1):
        bt.blob(gv(Hd, s * 0.04, 0.03, 0.07), 0.03, 0.018, 0.035, bones=[head])
    # The lower jaw, pale beneath.
    J = B[jaw]
    bt.capsule(gv(J, 0, 0.0, -0.04), gv(J, 0, -0.012, 0.19), 0.03 * k, 0.02, bones=[jaw], slot=LIGHT)
    for s in (-1, 1):
        for t in (0.25, 0.55, 0.85):
            p = gv(J, s * 0.022, 0.012, -0.02 + t * 0.2)
            bt.cone(p, p + G(0, 0.02 + (0.012 if t < 0.3 else 0), 0.004), 0.006, [jaw], rgb=0xf0ead8)
    # Ears: tall, pointed, set back on the skull.
    for e in n.get('ears') or []:
        E = B[e]
        s = 1 if E.x > 0 else -1
        # A flattened cone, broad at the base and sharp at the tip, tipped outward a little.
        base, tip = gv(E, -s * 0.008, -0.03, 0), gv(E, s * 0.025, 0.1, -0.025)
        bt.tube([base, base.lerp(tip, 0.45), tip], lambda t: 0.046 * (1 - t) ** 0.85 + 0.002, [e], surface="fur", slot=DARK, n=10, squash=0.42)
        bt.capsule(gv(E, -s * 0.03, -0.06, 0.0), gv(E, 0, -0.005, -0.004), 0.035, 0.026, bones=[e, head], back=-1.0 if not heavy else None)
    # Eyes.
    for s in (-1, 1):
        bt.eye(gv(Hd, s * 0.047 * k, 0.02, 0.085), 0.013, [head], rgb=0xff3a10 if heavy else 0xffc030)
    # Legs: shoulder blades and haunches, slim forelegs, long hocks, paws with toes and claws.
    for leg in n['limbs']:
        up, mid, low = leg['up'], leg['mid'], leg['low']
        U, M, L = B[up], B[mid], B[low]
        F = G(*leg['foot'])
        s = leg['side']
        if leg['front']:
            bt.blob(gv(U, -s * 0.02, -0.02, -0.03), 0.06 * k, 0.13, 0.085, rot=(0.25, 0, 0), bones=[chest, up], mottle=0.2, back=back)
            bt.capsule(gv(U, 0, -0.05, 0), M, 0.06 * k, 0.04 * k, bones=[up, mid], mottle=0.2)
            bt.capsule(M, L, 0.034 * k, 0.025 * k, bones=[mid, low], **legc)
        else:
            bt.blob(gv(U, -s * 0.01, -0.06, 0.02), 0.075 * k, 0.15, 0.11, rot=(-0.3, 0, 0), bones=[hips, up], mottle=0.2, back=back)
            bt.capsule(gv(U, 0, -0.1, 0.04), M, 0.075 * k, 0.045 * k, bones=[up, mid], mottle=0.2)
            bt.capsule(M, L, 0.04 * k, 0.026 * k, bones=[mid, low])
        bt.capsule(L, F + G(0, 0.02, 0), 0.025 * k, 0.022 * k, bones=[low], **legc)
        paw = F + G(0, 0.012, 0.03)
        bt.blob(paw, 0.034 * k, 0.022, 0.045, bones=[low], **legc)
        for t in (-1.5, -0.5, 0.5, 1.5):
            toe = paw + G(t * 0.016 * k, -0.002, 0.04)
            bt.blob(toe, 0.012, 0.012, 0.016, bones=[low], **legc)
            bt.cone(toe + G(0, -0.002, 0.012), toe + G(0, -0.012, 0.035), 0.006, [low], rgb=0x2a2420)
    # The tail: thick with fur, dark at the tip.
    tail = n['tail']
    pts = [B[t] for t in tail]
    end = pts[-1] + (pts[-1] - pts[-2]) * 0.9
    radii = [0.05, 0.07, 0.072, 0.06]
    for i in range(len(pts)):
        a, b = pts[i], pts[i + 1] if i + 1 < len(pts) else end
        bt.capsule(a, b, radii[min(i, 3)] * k, radii[min(i + 1, 3)] * k * (0.6 if i == len(pts) - 1 else 1), bones=tail[max(0, i - 1):i + 2], slot=DARK if i == len(pts) - 1 else MAIN, mottle=0.35, back=back)
    if heavy:
        # A ridge of volcanic spines down the back, and cracks of glowing magma.
        for t in range(9):
            p = H.lerp(C, t / 8) + G(0, 0.17 + 0.03 * math.sin(t), 0)
            bt.cone(p - G(0, 0.04, 0), p + G(0, 0.13 + 0.03 * (t % 2), -0.06), 0.034, torso, rgb=0x2a2220, flat=True)
        for t in range(6):
            p = H.lerp(C, (t + 0.5) / 6)
            for s in (-1, 1):
                q = p + G(s * 0.15, 0.02 * math.sin(t * 2.0), 0)
                bt.tube([q, q + G(s * 0.01, -0.06, 0.03), q + G(s * 0.005, -0.12, -0.01)], 0.009, torso, surface='glow', slot=GLOW, rgb=0xff6a10, n=5)


@builder('wolf', 0x5d5852)
def wolf(bt):
    canine(bt)
    return bt.build(0.0055, 9000, ('CLOUDS', 0.012, 0.0035)), ['fur', 'glow']


@builder('hound', 0x3a2018)
def hound(bt):
    canine(bt, heavy=True)
    return bt.build(0.006, 9000, ('VORONOI', 0.02, 0.004)), ['fur', 'glow']


# ------------------------------------------------------------ hoofed beasts --


def hoof(bt, L, F, bones, r, cloven=True, rgb=0x221a14):
    """A hoof under the lower leg: a dark, slightly flared cap, split in two when cloven."""
    for t in ((-0.5, 0.5) if cloven else (0,)):
        c = F + G(t * r * 0.9, r * 0.55, r * 0.25)
        bt.tube([c + G(0, r * 0.7, -r * 0.2), c, c + G(0, -r * 0.55, r * 0.35)], lambda u: r * (0.55 if cloven else 0.95) * (0.8 + 0.35 * u), bones, surface='shell', rgb=rgb, n=8, squash=0.8)


@builder('boar', 0x5a3a26)
def boar(bt):
    """A great bristling boar: a barrel body under a humped, maned shoulder, a wedge head and curling tusks."""
    n, B = bt.n, bt.B
    hips, chest, neck, head, jaw = n['hips'], n['chest'], n['neck'], n['head'], n['jaw']
    H, C, Hd, J = B[hips], B[chest], B[head], B[jaw]
    torso = [hips, chest]
    coat = dict(belly=-0.6, back=0.6, mottle=0.3)
    # The barrel and the hump of muscle over the shoulders.
    bt.blob(gv(C, 0, 0.0, 0.0), 0.23, 0.24, 0.28, bones=[chest], **coat)
    bt.blob(gv(C, 0, 0.12, -0.04), 0.15, 0.14, 0.22, rot=(-0.2, 0, 0), bones=[chest], **coat)
    bt.capsule(gv(C, 0, -0.01, -0.1), gv(H, 0, 0.0, 0.05), 0.23, 0.2, bones=torso, **coat)
    bt.blob(gv(H, 0, 0.0, -0.08), 0.2, 0.21, 0.2, bones=[hips], **coat)
    # A short thick neck running into the head.
    bt.capsule(gv(C, 0, 0.0, 0.2), gv(Hd, 0, 0.0, -0.06), 0.17, 0.12, bones=[chest] + neck + [head], **coat)
    # The head: a long wedge, heavy jowls, a flat snout disc and small mean eyes.
    bt.blob(gv(Hd, 0, 0.04, 0.0), 0.11, 0.11, 0.13, bones=[head], back=0.5, mottle=0.25)
    bt.capsule(gv(Hd, 0, 0.02, 0.05), gv(Hd, 0, -0.03, 0.33), 0.1, 0.06, bones=[head], back=0.5, mottle=0.25)
    for sd in (-1, 1):
        bt.blob(gv(Hd, sd * 0.08, -0.05, 0.06), 0.05, 0.06, 0.08, bones=[head, jaw], mottle=0.25)
    bt.blob(gv(Hd, 0, -0.035, 0.37), 0.062, 0.052, 0.025, bones=[head], slot=FIXED, rgb=0x7a5048)
    for sd in (-1, 1):
        bt.blob(gv(Hd, sd * 0.025, -0.035, 0.392), 0.013, 0.016, 0.008, bones=[head], slot=FIXED, rgb=0x1a1010)
        e = bt.surface(gv(Hd, sd * 0.3, 0.06, 0.12), G(-sd, 0, 0))
        bt.eye(e + G(sd * 0.004, 0, 0), 0.016, [head], rgb=0x1a0c08, glow=False)
        # Brow ridge.
        bt.blob(gv(Hd, sd * 0.06, 0.1, 0.1), 0.04, 0.02, 0.04, bones=[head], slot=DARK)
    # The lower jaw.
    bt.capsule(gv(J, 0, 0.0, -0.04), gv(J, 0, -0.01, 0.22), 0.065, 0.04, bones=[jaw], slot=LIGHT, mottle=0.2)
    # Tusks: from the jaw, curling out and up past the snout.
    for sd in (-1, 1):
        a = gv(J, sd * 0.055, 0.02, 0.19)
        pts = [a, a + G(sd * 0.04, 0.03, 0.05), a + G(sd * 0.075, 0.1, 0.07), a + G(sd * 0.07, 0.17, 0.03)]
        bt.tube(pts, lambda t: 0.024 * (1 - t) ** 0.8 + 0.002, [jaw], rgb=0xeee4c8, n=8)
    # Ears: small, stiff, leaf-shaped.
    for e in n['ears']:
        E = B[e]
        sd = 1 if E.x > 0 else -1
        base, tip = gv(E, -sd * 0.02, -0.05, 0.0), gv(E, sd * 0.06, 0.08, -0.07)
        bt.tube([base, base.lerp(tip, 0.4), tip], lambda t: 0.055 * (1 - t) ** 0.7 + 0.003, [e], surface='fur', slot=DARK, n=10, squash=0.35)
    # The mane of bristles down the spine, rooted in the skin.
    for t in range(18):
        u = t / 17
        z = lerp(-Hd.y - 0.0, -H.y, u)
        root = bt.top(0, z)
        lift = 0.07 + 0.15 * math.sin(min(1.0, u * 1.5) * math.pi * 0.5) * (1.2 - u * 0.5)
        bone = chest if u < 0.55 else hips
        for sd in (-1, 0, 1):
            q = bt.top(sd * 0.04, z + 0.015 * sd) if sd else root
            bt.cone(q - G(0, 0.03, 0), q + G(sd * 0.04, lift * (0.8 if sd else 1), -0.08), 0.02, [bone] + (neck if u < 0.3 else []), rgb=0x24180f, flat=True)
    # Legs: thick hams and shoulders, short shanks, cloven hooves.
    for leg in n['limbs']:
        up, mid, low = leg['up'], leg['mid'], leg['low']
        U, M, L = B[up], B[mid], B[low]
        F = G(*leg['foot'])
        sd = leg['side']
        if leg['front']:
            bt.blob(gv(U, -sd * 0.03, -0.06, -0.02), 0.09, 0.15, 0.11, bones=[chest, up], **coat)
            bt.capsule(gv(U, 0, -0.08, 0), M, 0.085, 0.055, bones=[up, mid], mottle=0.3)
        else:
            bt.blob(gv(U, -sd * 0.03, -0.07, 0.03), 0.1, 0.17, 0.14, rot=(-0.2, 0, 0), bones=[hips, up], **coat)
            bt.capsule(gv(U, 0, -0.1, 0.04), M, 0.09, 0.055, bones=[up, mid], mottle=0.3)
        bt.capsule(M, L, 0.05, 0.04, bones=[mid, low], slot=DARK)
        bt.capsule(L, F + G(0, 0.05, 0.01), 0.04, 0.038, bones=[low], slot=DARK)
        hoof(bt, L, F + G(0, -0.01, 0.01), [low], 0.045)
    # A thin tail with a tuft.
    tail = n['tail']
    T0, T1 = B[tail[0]], B[tail[1]]
    bt.capsule(gv(T0, 0, 0.02, 0.05), T1, 0.035, 0.018, bones=tail)
    bt.capsule(T1, T1 + (T1 - T0) * 0.8, 0.02, 0.012, bones=[tail[1]])
    bt.blob(T1 + (T1 - T0) * 0.9, 0.03, 0.06, 0.03, bones=[tail[1]], slot=DARK)
    return bt.build(0.007, 9500, ('CLOUDS', 0.02, 0.006)), ['fur', 'glow']


def curve(pts, n=8):
    """A smooth Catmull-Rom run through points (for antlers, horns, tails)."""
    pts = [Vector(p) for p in pts]
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


# (Cernunna is forged now: see the great foes below.)

# ------------------------------------------------------------------ dragons --


def wyrm(bt, u, tips, belly_rgb, horn_rgb=0x2a1e16, embers=False, club=False):
    """
    A drake or (embers, club) the elder dragon: a heavy scaled body, a long
    neck and tail ridged with spines, a horned head, clawed legs and wing
    arms whose fingers carry the membrane the game stretches between them.
    `u` scales the dragon's own measurements down to a drake's.
    """
    n, B = bt.n, bt.B
    hips, chest, neck, head, jaw, tail = n['hips'], n['chest'], n['neck'], n['head'], n['jaw'], n['tail']
    H, C, Hd, J = B[hips], B[chest], B[head], B[jaw]
    torso = [hips, chest]
    hide = dict(belly=-0.45, back=0.7, mottle=0.25)
    ivory, spine = 0xe2d6b8, 0x1c1210
    # The body: a deep chest and a heavy belly.
    bt.blob(gv(C, 0, 0.0, 0.05 * u), 0.46 * u, 0.48 * u, 0.55 * u, bones=[chest], **hide)
    bt.capsule(gv(C, 0, -0.02 * u, -0.2 * u), gv(H, 0, 0.0, 0.1 * u), 0.45 * u, 0.42 * u, bones=torso, **hide)
    bt.blob(gv(H, 0, 0.02 * u, -0.15 * u), 0.38 * u, 0.4 * u, 0.45 * u, bones=[hips], **hide)
    # Belly plates, one after another from chest to hips.
    for i in range(9):
        z = lerp(-C.y + 0.35 * u, -H.y - 0.2 * u, i / 8)
        p = bt.surface(G(0, H.z - 1.5 * u, z), Vector((0, 0, 1)))
        bt.blob(p + G(0, 0.03 * u, 0), 0.3 * u, 0.06 * u, 0.1 * u, bones=torso, slot=FIXED, rgb=belly_rgb, stiff=3.0)
        if embers and i < 7:
            bt.tube([p + G(-0.2 * u, 0.0, -0.11 * u), p + G(0, -0.012 * u, -0.12 * u), p + G(0.2 * u, 0.0, -0.11 * u)], 0.016 * u, torso, surface='glow', slot=GLOW, rgb=0xff5a14, n=4)
    # The neck: long, thick at the shoulders, plated beneath.
    path = [gv(C, 0, 0.12 * u, 0.3 * u)] + [B[k] for k in neck] + [Hd]
    radii = [lerp(0.4, 0.2, i / (len(path) - 1)) * u for i in range(len(path))]
    bt.chain(path, radii, [[chest, neck[0]]] + [[neck[i], neck[min(i + 1, len(neck) - 1)]] for i in range(len(neck))], **hide)
    for i in range(1, len(path) - 1):
        d = (path[i + 1] - path[i - 1]).normalized()
        down = (Vector((0, 0, -1)) - d * d.z).normalized()
        bt.blob(path[i] + down * radii[i] * 0.8, radii[i] * 0.75, radii[i] * 0.22, radii[i] * 0.5, rot=look(d), bones=[neck[i - 1]], slot=FIXED, rgb=belly_rgb, stiff=3.0)
    # The head: a broad skull, heavy brows, a long snout, eyes of fire, a crown of horns.
    hy = Hd + G(0, 0.03 * u, 0)
    bt.blob(gv(hy, 0, 0.0, 0.06 * u), 0.22 * u, 0.19 * u, 0.27 * u, bones=[head], **hide)
    bt.capsule(gv(hy, 0, 0.0, 0.2 * u), gv(hy, 0, -0.08 * u, 0.76 * u), 0.18 * u, 0.07 * u, bones=[head], **hide)
    for sd in (-1, 1):
        bt.blob(gv(hy, sd * 0.12 * u, 0.12 * u, 0.2 * u), 0.09 * u, 0.045 * u, 0.17 * u, rot=(0.25, 0, -sd * 0.35), bones=[head], slot=DARK)
        bt.eye(gv(hy, sd * 0.145 * u, 0.075 * u, 0.26 * u), 0.03 * u, [head], rgb=0xffb020, squash=0.7)
        bt.blob(gv(hy, sd * 0.045 * u, -0.03 * u, 0.76 * u), 0.016 * u, 0.012 * u, 0.012 * u, bones=[head], slot=FIXED, rgb=0x120806)
        # Horns: a great pair sweeping back, a lesser pair below, spikes down the cheeks.
        big = curve([gv(hy, sd * 0.12 * u, 0.13 * u, -0.02 * u), gv(hy, sd * 0.32 * u, 0.38 * u, -0.2 * u), gv(hy, sd * 0.38 * u, 0.3 * u, -0.62 * u), gv(hy, sd * 0.32 * u, 0.4 * u, -0.85 * u)], 3)
        bt.tube(big, lambda t: (0.075 * (1 - t) ** 0.9 + 0.004) * u, [head], rgb=horn_rgb, n=9)
        low = curve([gv(hy, sd * 0.17 * u, 0.03 * u, -0.06 * u), gv(hy, sd * 0.37 * u, 0.07 * u, -0.22 * u), gv(hy, sd * 0.45 * u, -0.03 * u, -0.47 * u)], 3)
        bt.tube(low, lambda t: (0.05 * (1 - t) + 0.003) * u, [head], rgb=horn_rgb, n=7)
        for i in range(4):
            a = gv(hy, sd * 0.17 * u, -0.06 * u, (0.04 - i * 0.06) * u)
            bt.cone(a, a + G(sd * 0.11 * u, -0.03 * u, -0.1 * u), 0.025 * u, [head], rgb=spine)
        for i in range(6):
            a = gv(hy, sd * (0.12 - i * 0.012) * u, -0.08 * u, (0.34 + i * 0.075) * u)
            bt.cone(a, a + G(0, -0.07 * u, 0.005), 0.014 * u, [head], rgb=ivory)
    bt.cone(gv(hy, 0, 0.06 * u, 0.6 * u), gv(hy, 0, 0.16 * u, 0.56 * u), 0.03 * u, [head], rgb=horn_rgb)
    if embers:
        bt.blob(gv(hy, 0, -0.11 * u, 0.42 * u), 0.1 * u, 0.025 * u, 0.26 * u, bones=[head], slot=FIXED, rgb=0x2a0a04)
    # The lower jaw, with its own teeth.
    bt.capsule(gv(J, 0, -0.02 * u, 0.02 * u), gv(J, 0, -0.05 * u, 0.62 * u), 0.15 * u, 0.05 * u, bones=[jaw], slot=FIXED, rgb=belly_rgb)
    for sd in (-1, 1):
        for i in range(5):
            a = gv(J, sd * (0.1 - i * 0.012) * u, -0.03 * u, (0.28 + i * 0.075) * u)
            bt.cone(a, a + G(0, 0.065 * u, 0.005), 0.013 * u, [jaw], rgb=ivory)
    for sd in (-1, 0, 1):
        a = gv(J, sd * 0.06 * u, -0.1 * u, 0.18 * u)
        bt.cone(a, a + G(sd * 0.03 * u, -0.12 * u, -0.1 * u), 0.02 * u, [jaw], rgb=spine)
    # Legs: thick-muscled, scaled, with hooked ivory claws and a spur at the knee.
    for leg in n['limbs']:
        up, mid, low_, F = leg['up'], leg['mid'], leg['low'], G(*leg['foot'])
        U, M, L = B[up], B[mid], B[low_]
        sd = leg['side']
        if leg['front']:
            bt.blob(gv(U, -sd * 0.04 * u, -0.08 * u, 0.0), 0.18 * u, 0.32 * u, 0.22 * u, bones=[chest, up], **hide)
            bt.capsule(gv(U, 0, -0.15 * u, 0), M, 0.17 * u, 0.12 * u, bones=[up, mid], **hide)
        else:
            bt.blob(gv(U, -sd * 0.04 * u, -0.1 * u, 0.04 * u), 0.22 * u, 0.36 * u, 0.28 * u, rot=(-0.2, 0, 0), bones=[hips, up], **hide)
            bt.capsule(gv(U, 0, -0.18 * u, 0.06 * u), M, 0.2 * u, 0.13 * u, bones=[up, mid], **hide)
        bt.capsule(M, L, 0.1 * u, 0.08 * u, bones=[mid, low_], slot=DARK)
        bt.capsule(L, F + G(0, 0.07 * u, 0.02 * u), 0.08 * u, 0.075 * u, bones=[low_], slot=DARK)
        bt.blob(F + G(0, 0.06 * u, 0.06 * u), 0.12 * u, 0.065 * u, 0.15 * u, bones=[low_], slot=DARK)
        for dx in (-0.08, 0, 0.08):
            a = F + G(dx * u, 0.07 * u, 0.12 * u)
            bt.tube(curve([a, a + G(dx * 0.4 * u, 0.0, 0.13 * u), a + G(dx * 0.5 * u, -0.07 * u, 0.2 * u)], 3), lambda t: (0.034 * (1 - t) + 0.003) * u, [low_], rgb=ivory, n=6)
        a = F + G(0, 0.09 * u, -0.06 * u)
        bt.cone(a, a + G(0, -0.06 * u, -0.13 * u), 0.03 * u, [low_], rgb=ivory)
        a = M + G(0, 0.02 * u, (-0.08 if leg['front'] else 0.06) * u)
        bt.cone(a, a + G(sd * 0.04 * u, 0.06 * u, (-0.3 if leg['front'] else 0.28) * u), 0.05 * u, [mid], rgb=spine)
    # Wings: the arm, forearm and hand in flesh; finger bones out to each tip; a thumb claw.
    for w in n['wings']:
        root, fore, hand, fingers = w['root'], w['fore'], w['hand'], w['fingers']
        sd = 1 if B[hand].x > 0 else -1
        S, E, W = B[root], B[fore], B[hand]
        bt.capsule(gv(S, -sd * 0.05 * u, -0.05 * u, 0), E, 0.15 * u, 0.1 * u, bones=[root, fore], **hide)
        bt.capsule(E, W, 0.1 * u, 0.065 * u, bones=[fore, hand], **hide)
        bt.blob(W, 0.08 * u, 0.07 * u, 0.08 * u, bones=[hand], **hide)
        for f, t in zip(fingers, tips):
            tip = W + G(sd * t[0], t[1], t[2])
            bt.tube(curve([W, W.lerp(tip, 0.5) + G(0, 0.04 * u, 0), tip], 4), lambda t: (0.048 * (1 - t) + 0.006) * u, [f], surface='scale', slot=DARK, n=7)
        a = W + G(0, 0.02 * u, 0)
        bt.tube(curve([a, a + G(sd * 0.05 * u, 0.12 * u, 0.2 * u), a + G(sd * 0.02 * u, 0.06 * u, 0.34 * u)], 3), lambda t: (0.05 * (1 - t) + 0.003) * u, [hand], rgb=ivory, n=6)
        for f in (0.3, 0.6):
            p = S.lerp(E, f)
            bt.cone(p + G(0, 0.06 * u, 0), p + G(sd * 0.05 * u, 0.3 * u, -0.15 * u), 0.04 * u, [root], rgb=spine)
        bt.cone(E + G(0, 0.05 * u, 0), E + G(sd * 0.1 * u, 0.34 * u, -0.12 * u), 0.05 * u, [fore], rgb=spine)
    # The tail: tapering away, ridged on top, ending in blades (and, on the elder dragon, a spiked club).
    pts = [gv(H, 0, 0.02 * u, -0.3 * u)] + [B[t] for t in tail]
    end = pts[-1] + (pts[-1] - pts[-2]) * 0.6
    pts.append(end)
    tb = [[hips, tail[0]]] + [[tail[i], tail[min(i + 1, len(tail) - 1)]] for i in range(len(tail))]
    rr = [lerp(0.34, 0.035, (i / (len(pts) - 1)) ** 0.9) * u for i in range(len(pts))]
    bt.chain(pts, rr, tb, **hide)
    last = tail[-1]
    if club:
        bt.blob(end + G(0, 0.02 * u, 0.05 * u), 0.13 * u, 0.11 * u, 0.2 * u, bones=[last], slot=DARK)
        for dy, dz in ((0.12, 0.08), (0.14, -0.08), (-0.1, 0.02)):
            a = end + G(0, dy * 0.5 * u, dz * u)
            bt.cone(a, a + G(0, dy * 2.6 * u, (dz - 0.12) * u), 0.04 * u, [last], rgb=spine)
    for sd in (-1, 1):
        a = end + G(0, 0, 0.18 * u)
        bt.tube(curve([a, end + G(sd * 0.32 * u, 0.0, 0.0), end + G(sd * 0.2 * u, 0, -0.32 * u)], 3), lambda t: (0.05 * math.sin(math.pi * min(1, 0.15 + t)) + 0.006) * u, [last], rgb=ivory if club else spine, n=6, squash=0.25)
    # Spines down the back, rooted in the skin: neck, back and tail.
    ridge = path[::-1] + [gv(C, 0, 0, 0), gv(H, 0, 0, 0)] + pts[1:-1]
    for i in range(len(ridge) - 1):
        for f in (0.0, 0.5):
            p = ridge[i].lerp(ridge[i + 1], f)
            root_ = bt.surface(p + G(0, 1.2 * u, 0), Vector((0, 0, -1)), far=2.4 * u)
            near = min(range(len(bt.B)), key=lambda b: (bt.B[b] - p).length)
            span = 0.24 * u if (p - C).length < 0.9 * u or (p - H).length < 0.9 * u else 0.14 * u
            bt.cone(root_ - G(0, 0.04 * u, 0), root_ + G(0, span, -span * 0.55), 0.055 * u, [near], rgb=spine, flat=True)
    if embers:
        # Molten cracks over the chest, glowing through the scales.
        for sd in (-1, 1):
            crack = []
            for i, z in enumerate((0.18, 0.36, 0.55, 0.74, 0.9)):
                y = H.z - 0.25 * u + 0.12 * u * math.sin(i * 2.3)
                crack.append(bt.surface(G(sd * 2 * u, y, z * u * 1.1), G(-sd, 0, 0)) + G(sd * 0.01 * u, 0, 0))
            bt.tube(crack, lambda t: 0.02 * u * (1 - t) + 0.004 * u, torso, surface='glow', slot=GLOW, rgb=0xff5a14, n=4)


@builder('drake', 0x4a2a24)
def drake(bt):
    wyrm(bt, 0.54, [(0.75, -0.18, -0.26), (0.55, -0.28, -0.9), (0.12, -0.34, -1.34)], 0xb08860)
    return bt.build(0.0075, 12000, ('VORONOI', 0.02, 0.004), surface='scale'), ['scale', 'fur', 'glow']


# -------------------------------------------------------------- arthropods --


def jointed(bt, pts, radii, bones, slot=DARK, rgb=0x202020, surface='shell', n=8):
    """A jointed limb: a hard tapered tube per segment, each on its own bone, bulging at the middle, knobbed at each joint."""
    for k in range(len(pts) - 1):
        a, b = Vector(pts[k]), Vector(pts[k + 1])
        r0, r1 = radii[k], radii[k + 1]
        mid = a.lerp(b, 0.45)
        bt.tube([a, mid, b], lambda t, r0=r0, r1=r1: lerp(r0, r1, t) * (1 + 0.25 * math.sin(math.pi * t)), [bones[k]], surface=surface, slot=slot, rgb=rgb, n=n)
        if k:
            bt.hard.append((surface, _ball(a, r0 * 1.12), _part(bones[k - 1:k + 1], slot, rgb)))


def _ball(c, r, squash=(1, 1, 1)):
    import bmesh as _bm
    bm = _bm.new()
    _bm.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * squash[0], v.co.y * squash[1], v.co.z * squash[2])) + Vector(c)
    for f in bm.faces:
        f.smooth = True
    return bm


def _part(bones, slot, rgb):
    from kit import Part
    return Part(bones, slot=slot, rgb=rgb)


@builder('insect', 0x7a5a32)
def scorpion(bt):
    """A scorpion: a plated, glossy body, great pincers, eight jointed legs and a beaded tail arching to a venom bulb."""
    n, B = bt.n, bt.B
    body, head, tail = n['body'], n['head'], n['tail']
    Bo, Hd = B[body], B[head]
    shell = dict(belly=-0.3, under=DARK)
    # The head-plate, ridged, with a cluster of glowing eyes.
    bt.blob(gv(Hd, 0, 0.03, 0.06), 0.25, 0.1, 0.24, bones=[head], **shell)
    bt.blob(gv(Hd, 0, 0.09, 0.04), 0.1, 0.05, 0.16, bones=[head], **shell)
    for sd in (-1, 1):
        for dx, dz in ((0.04, 0.24), (0.08, 0.2), (0.11, 0.15)):
            bt.eye(gv(Hd, sd * dx, 0.1, dz), 0.017, [head], rgb=0xa0ff60)
        # Mouthparts.
        bt.cone(gv(Hd, sd * 0.05, -0.02, 0.27), gv(Hd, sd * 0.03, -0.06, 0.36), 0.03, [head], slot=DARK)
    # The abdomen: seven overlapping plates, broadest in the middle.
    for i in range(7):
        t = i / 6
        z = lerp(0.12, -0.7, t)
        w = 0.27 * math.sin(math.pi * lerp(0.35, 0.9, t)) + 0.05
        c = G(0, Bo.z + 0.03 + 0.02 * t, z)
        bt.blob(c, w, 0.11 - 0.03 * t, 0.085, bones=[body] if t < 0.85 else [body, tail[0]], stiff=2.6, **shell)
        bt.blob(c + G(0, 0.06 - 0.02 * t, -0.03), w * 0.85, 0.05, 0.06, bones=[body], stiff=3.0, slot=DARK)
    # The tail: five beads and a bulb, arching over the back.
    pts = [gv(Bo, 0, 0.04, -0.58)] + [B[t] for t in tail]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        r = 0.095 - i * 0.011
        bt.blob(a.lerp(b, 0.5), (b - a).length * 0.55, r, r, rot=look(b - a), bones=[tail[i]], stiff=2.8, **shell)
        bt.blob(b, r * 0.7, r * 0.7, r * 0.7, bones=[tail[i]], slot=DARK, stiff=2.8)
    tb, last = pts[-1], tail[-1]
    bt.blob(tb + G(0, 0, 0.07), 0.075, 0.075, 0.11, bones=[last], slot=FIXED, rgb=0x8a4a28)
    sting = curve([tb + G(0, 0, 0.15), tb + G(0, 0.02, 0.27), tb + G(0, -0.12, 0.31)], 3)
    bt.tube(sting, lambda t: 0.036 * (1 - t) + 0.002, [last], rgb=0x14100c, n=7)
    bt.eye(sting[-1], 0.012, [last], rgb=0xa0ff60)
    # Pincers: a jointed arm to a swollen claw with a fixed and a moving finger.
    for pc in n['pincers']:
        arm, fore, hand, finger = pc['arm'], pc['fore'], pc['hand'], pc['finger']
        A, E, Wr, Fi = B[arm], B[fore], B[hand], B[finger]
        sd = 1 if Wr.x > 0 else -1
        jointed(bt, [A, E, Wr], [0.05, 0.065, 0.06], [arm, fore], slot=MAIN)
        bt.blob(gv(Wr, 0, 0.0, 0.17), 0.13, 0.09, 0.21, bones=[hand], **shell)
        bt.tube(curve([gv(Wr, -sd * 0.05, 0.0, 0.28), gv(Wr, -sd * 0.08, 0.0, 0.45), gv(Wr, -sd * 0.04, 0.0, 0.6)], 3), lambda t: 0.05 * (1 - t) + 0.004, [hand], slot=DARK, n=8, squash=0.75)
        bt.tube(curve([Fi, gv(Fi, sd * 0.02, 0.0, 0.18), gv(Fi, -sd * 0.05, 0.0, 0.31)], 3), lambda t: 0.045 * (1 - t) + 0.004, [finger], slot=DARK, n=8, squash=0.75)
        for k in range(4):
            a = gv(Wr, -sd * 0.03, 0.0, 0.32 + k * 0.06)
            bt.cone(a, a + G(sd * 0.03, 0, 0.01), 0.008, [hand], rgb=0xd8ccb0)
    # Legs: four pairs, splayed, jointed.
    for leg in n['limbs']:
        up, mid, low = leg['up'], leg['mid'], leg['low']
        jointed(bt, [B[up], B[mid], B[low], G(*leg['foot'])], [0.05, 0.042, 0.03, 0.008], [up, mid, low])
    return bt.build(0.006, 9000, ('CLOUDS', 0.03, 0.0015), surface='shell'), ['shell', 'glow', 'fur']


# ------------------------------------------------------------- robed spirits --


def tatters(bt, strands, width, surface, fade, slot=MAIN, bones_of=None, flare=1.0):
    """Ragged cloth strips hanging along chains of joints, flat side outward, frayed to a point."""
    B = bt.B
    for st in strands:
        pts = [B[k] for k in st]
        tip = pts[-1] + (pts[-1] - pts[-2]) * 1.0
        run = pts + [tip]
        c = Vector((0, 0, run[0].z))
        out = Vector((run[0].x, run[0].y, 0))
        out = out.normalized() if out.length > 1e-6 else Vector((0, -1, 0))
        side = out.cross(Vector((0, 0, 1)))
        w = width * (0.8 + 0.3 * math.cos(st[0] * 1.7))
        fine = curve(run, 3)
        jag = lambda t: w * (1 - 0.75 * t ** 1.4) * (1 + 0.12 * math.sin(t * 17 + st[0]))
        bt.tube(fine, jag, st, surface=surface, n=8, squash=0.16, wide=side, part=Part(st, slot=slot, fade=fade, mottle=0.25))


def sleeve_arm(bt, arm, r, cuff, bone_rgb, surface='fur', fingers=4, robe=None):
    """A wide sleeve to the elbow and past it, then a bony forearm and long-fingered hand."""
    B = bt.B
    up, mid, low = arm['up'], arm['mid'], arm['low']
    S, E, W = B[up], B[mid], B[low]
    robe = robe or {}
    bt.capsule(S, E, r, r * 1.05, bones=[up, mid], **robe)
    bt.capsule(E, E.lerp(W, 0.62), r * 1.05, cuff, bones=[mid], **robe)
    bt.tube([E, E.lerp(W, 0.5), W], lambda t: 0.028 - 0.008 * t, [mid], surface=surface, rgb=bone_rgb, n=6)
    bt.hard.append((surface, _ball(W, 0.035, (1, 1, 0.8)), Part([low], slot=FIXED, rgb=bone_rgb)))
    sd = 1 if W.x > 0 else -1
    for f in range(fingers):
        sp = (f - (fingers - 1) / 2) * 0.035
        k0 = W + G(sp, -0.02, 0.025)
        k1 = k0 + G(sp * 0.6, -0.1, 0.06)
        k2 = k1 + G(0, -0.08, 0.07)
        bt.tube(curve([k0, k1, k2], 2), lambda t: 0.013 * (1 - t) + 0.002, [low], surface=surface, rgb=bone_rgb, n=5)


def skull(bt, c, r, head, bone_rgb, eye_rgb, jaw=True, sockets=0x050408):
    """A skull face looking forward (+z): brow, cheekbones, deep sockets with burning points, a toothed jaw."""
    bt.hard.append(('fur', _ball(c, r, (0.85, 0.85, 1.0)), Part([head], slot=FIXED, rgb=bone_rgb)))
    for sd in (-1, 1):
        e = c + G(sd * r * 0.38, r * 0.15, r * 0.78)
        bt.hard.append(('fur', _ball(e, r * 0.27, (1.0, 0.6, 0.85)), Part([head], slot=FIXED, rgb=sockets)))
        bt.eye(e + G(0, 0, r * 0.12), r * 0.12, [head], rgb=eye_rgb)
    bt.hard.append(('fur', _ball(c + G(0, -r * 0.2, r * 0.9), r * 0.09, (0.8, 1.2, 0.5)), Part([head], slot=FIXED, rgb=sockets)))
    if jaw:
        bt.tube([c + G(0, -r * 0.55, r * 0.35), c + G(0, -r * 0.8, r * 0.72)], lambda t: r * (0.55 - 0.15 * t), [head], surface='fur', rgb=bone_rgb, n=8, squash=0.6, wide=Vector((1, 0, 0)))
        for k in range(6):
            x = (k - 2.5) * r * 0.13
            a = c + G(x, -r * 0.48, r * 0.88 - abs(x) * 0.4)
            bt.cone(a, a + G(0, -r * 0.16, 0), r * 0.06, [head], surface='fur', rgb=0xe8e0c8)


@builder('wraith', 0x6c6290)
def wraith(bt):
    """A wraith: a tall hooded shade, a void for a face with two cold points of light, a robe dissolving into tatters, bony hands reaching."""
    n, B = bt.n, bt.B
    body, chest, head = n['body'], n['chest'], n['head']
    Bo, C, Hd = B[body], B[chest], B[head]
    robe = dict(fade=(0.3, 2.0, 0.3), mottle=0.2, stiff=3.5)
    bone = 0xcfc7ad
    # Narrow shoulders under a cowl, a robe that falls straight and flares at the hem.
    bt.blob(gv(C, 0, 0.17, -0.01), 0.24, 0.07, 0.14, bones=[chest], **robe)
    bt.capsule(gv(C, 0, 0.16, 0), gv(C, 0, -0.12, 0), 0.14, 0.15, bones=[chest], **robe)
    bt.capsule(gv(C, 0, -0.12, 0), gv(Bo, 0, 0.1, 0), 0.15, 0.18, bones=[chest, body], **robe)
    bt.capsule(gv(Bo, 0, 0.1, 0), gv(Bo, 0, -0.08, 0), 0.18, 0.25, bones=[body], **robe)
    bt.capsule(gv(Bo, 0, -0.08, 0), gv(Bo, 0, -0.03, 0), 0.25, 0.27, bones=[body], **robe)
    tatters(bt, n['strands'], 0.13, 'ghost', (0.1, 1.5, 0.25))
    # A mantle hanging from the shoulders over the back.
    for x in (-0.12, 0.0, 0.12):
        a0 = gv(C, x, 0.15, -0.12)
        bt.tube(curve([a0, a0 + G(x * 0.3, -0.35, -0.08), a0 + G(x * 0.5, -0.75, -0.1)], 3), lambda t: 0.09 * (1 - 0.6 * t) + 0.01, [chest, body], surface='ghost', n=8, squash=0.16, wide=Vector((1, 0, 0)), part=Part([chest, body], slot=MAIN, fade=(0.3, 2.0, 0.3), mottle=0.2))
    # The hood: tall and peaked, its face hollowed out, a void within.
    bt.blob(gv(Hd, 0, 0.03, -0.03), 0.16, 0.18, 0.18, bones=[head], **robe)
    bt.capsule(gv(Hd, 0, 0.1, -0.08), gv(Hd, 0, 0.12, -0.3), 0.08, 0.02, bones=[head], **robe)
    bt.blob(gv(Hd, 0, -0.01, 0.13), 0.11, 0.13, 0.12, bones=[head], neg=True)
    bt.hard.append(('fur', _ball(gv(Hd, 0, 0.0, -0.02), 0.14, (1, 1.05, 0.85)), Part([head], slot=FIXED, rgb=0x050408)))
    for sd in (-1, 1):
        bt.eye(gv(Hd, sd * 0.045, 0.02, 0.115), 0.02, [head], rgb=0x80b0ff, squash=0.6)
    bt.tube([gv(Hd, 0, -0.1, 0.05), gv(Hd, 0, -0.12, 0.1)], lambda t: 0.04 - 0.01 * t, [head], surface='fur', rgb=0x6a6658, n=8, squash=0.4, wide=Vector((1, 0, 0)))
    # Long sleeves, ragged at the cuff, and skeletal hands.
    for arm in n['arms']:
        up, mid, low = arm['up'], arm['mid'], arm['low']
        S, E, W = B[up], B[mid], B[low]
        cloth = Part([up, mid], slot=MAIN, fade=(0.3, 2.0, 0.3), mottle=0.2)
        cuff = E.lerp(W, 0.7)
        bt.tube(curve([S + G(0, 0.02, 0), E, cuff], 3), lambda t: 0.05 + 0.065 * t ** 1.6, [up, mid], surface='ghost', n=10, part=cloth)
        bt.tube([E, E.lerp(W, 0.5), W], lambda t: 0.024 - 0.006 * t, [mid], surface='fur', rgb=bone, n=6)
        bt.hard.append(('fur', _ball(W, 0.032, (1, 1, 0.8)), Part([low], slot=FIXED, rgb=bone)))
        for f in range(4):
            sp = (f - 1.5) * 0.034
            k0 = W + G(sp, -0.02, 0.025)
            k1 = k0 + G(sp * 0.6, -0.1, 0.06)
            k2 = k1 + G(0, -0.08, 0.07)
            bt.tube(curve([k0, k1, k2], 2), lambda t: 0.012 * (1 - t) + 0.002, [low], surface='fur', rgb=bone, n=5)
    return bt.build(0.0075, 7000, ('CLOUDS', 0.04, 0.006), surface='ghost'), ['ghost', 'fur', 'glow']


def cap(c, r, theta, axis, thick=0.0, segs=24, rings=8):
    """A spherical cap round `axis` out to polar angle `theta` (a closed shell `thick` deep when thick > 0)."""
    import bmesh as _bm
    bm = _bm.new()
    q = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized())
    layers = []
    for rr in ((r, r - thick) if thick else (r,)):
        layer = []
        for i in range(1, rings + 1):
            th = theta * i / rings
            layer.append([bm.verts.new(Vector(c) + q @ Vector((math.sin(th) * math.cos(a), math.sin(th) * math.sin(a), math.cos(th))) * rr) for a in (k / segs * math.tau for k in range(segs))])
        pole = bm.verts.new(Vector(c) + q @ Vector((0, 0, rr)))
        layers.append((pole, layer))
    for li, (pole, layer) in enumerate(layers):
        flip = li == 1
        for k in range(segs):
            f = [pole, layer[0][k], layer[0][(k + 1) % segs]]
            bm.faces.new(f[::-1] if flip else f)
        for a, b in zip(layer, layer[1:]):
            for k in range(segs):
                f = [a[k], b[k], b[(k + 1) % segs], a[(k + 1) % segs]]
                bm.faces.new(f[::-1] if flip else f)
    if thick:
        o, i_ = layers[0][1][-1], layers[1][1][-1]
        for k in range(segs):
            bm.faces.new([o[k], i_[k], i_[(k + 1) % segs], o[(k + 1) % segs]])
    for f in bm.faces:
        f.smooth = True
    return bm


@builder('eye', 0x2a2030)
def eye(bt):
    """A floating eye: a bloodshot ball in a fleshy hood, lids that blink, a burning iris and a slit pupil, tentacles below."""
    n, B = bt.n, bt.B
    head, iris, pupil, lids = n['head'], n['iris'], n['pupil'], n['lids']
    C = B[head]
    R = 0.55
    flesh = dict(mottle=0.35, fade=(0.3, 2.0, 0.55))
    # The eyeball: white in front, flushed red behind, veined.
    front = Vector((0, -1, 0))
    bt.hard.append(('fur', cap(C, R, 1.6, front, segs=28, rings=10), Part([head], slot=FIXED, rgb=0xe8dcc8)))
    bt.hard.append(('fur', cap(C, R * 0.995, math.pi - 1.5, -front, segs=28, rings=8), Part([head], slot=FIXED, rgb=0x9a3a34)))
    for i in range(10):
        a = i / 10 * math.tau
        pts = []
        for t in (0, 0.25, 0.5, 0.75, 1):
            th = 2.2 - t * 1.15
            ph = a + math.sin(t * 4 + i * 1.3) * 0.25
            d = G(math.cos(ph) * math.sin(th), math.sin(ph) * math.sin(th), math.cos(th))
            pts.append(C + d * R * 1.004)
        bt.tube(curve(pts, 2), lambda t: 0.014 * (1 - t) + 0.002, [head], surface='fur', rgb=0x8a1414, n=4)
    # The iris and pupil, turning on their own bones.
    bt.hard.append(('glow', cap(C, R * 1.006, 0.5, front, segs=28, rings=5), Part([iris], slot=GLOW, rgb=0xff2a20)))
    bt.hard.append(('glow', cap(C, R * 1.009, 0.24, front, segs=28, rings=3), Part([iris], slot=GLOW, rgb=0xffb040)))
    bt.hard.append(('fur', _ball(C + G(0, 0, R * 1.0), 1.0, (0.05, 0.02, 0.2)), Part([pupil], slot=FIXED, rgb=0x050303)))
    # The fleshy hood behind, and the lids: thick shells that close over the ball.
    bt.blob(gv(C, 0, 0, -0.3), R * 0.9, R * 0.9, R * 0.72, bones=[head], **flesh)
    for lid in lids:
        upper = lid == lids[0]
        # The upper lid tipped back over the top, the lower one under: the front stays open.
        ax = Vector((0, math.sin(0.55), math.cos(0.55))) if upper else Vector((0, math.sin(0.55), -math.cos(0.55)))
        bt.hard.append(('fur', cap(C, R * 1.07, 1.25, ax, thick=0.035, segs=28, rings=7), Part([lid], slot=MAIN, mottle=0.3)))
    # Tentacles writhing below and behind.
    for st in n['strands']:
        pts = [B[k] for k in st]
        tip = pts[-1] + (pts[-1] - pts[-2]) * 0.9
        run = pts + [tip]
        radii = [0.09, 0.07, 0.05, 0.035, 0.012]
        for k in range(len(run) - 1):
            bt.capsule(run[k], run[k + 1], radii[k], radii[k + 1], bones=st[max(0, k - 1):k + 2], **flesh)
        bt.capsule(run[0] + (C - run[0]) * 0.5, run[0], 0.12, 0.09, bones=[st[0], head], **flesh)
        for k in range(1, 4):
            p = run[k].lerp(run[k + 1], 0.4)
            out = (p - C)
            out.z = 0
            out = out.normalized() * radii[k] * 0.9 if out.length > 1e-6 else Vector((0, 0, 0))
            bt.hard.append(('fur', _ball(p + out, radii[k] * 0.35, (1, 1, 1)), Part([st[k]], slot=LIGHT)))
    return bt.build(0.0085, 8000, ('CLOUDS', 0.04, 0.004), surface='fur'), ['fur', 'glow']


@builder('imp', 0xb0401c)
def imp(bt):
    """A fire imp: a wiry pot-bellied devil with curled horns, a grinning glowing mouth, bat wings and an arrow tail."""
    n, B = bt.n, bt.B
    body, chest, head, jaw, tail = n['body'], n['chest'], n['head'], n['jaw'], n['tail']
    Bo, C, Hd, J = B[body], B[chest], B[head], B[jaw]
    hide = dict(belly=-0.3, under=LIGHT, back=0.65, mottle=0.25)
    limb = dict(mottle=0.25)
    horn, claw = 0x2a2420, 0x1a1210
    # A narrow chest, a round little belly, bony shoulders.
    bt.blob(gv(C, 0, 0.04, 0.0), 0.15, 0.12, 0.1, bones=[chest], **hide)
    bt.blob(gv(Bo, 0, 0.06, 0.03), 0.12, 0.13, 0.12, bones=[body], **hide)
    bt.capsule(gv(Bo, 0, -0.06, 0), gv(C, 0, 0.1, 0), 0.1, 0.11, bones=[body, chest], **hide)
    bt.capsule(gv(C, 0, 0.12, 0), gv(Hd, 0, 0.0, -0.02), 0.06, 0.05, bones=[chest, head], **hide)
    # Belly seams of fire.
    pts = [bt.surface(gv(Bo, x, y, 0.6), G(0, 0, -1)) + G(0, 0, 0.004) for x, y in ((0.0, -0.04), (0.01, 0.06), (-0.01, 0.15))]
    bt.tube(curve(pts, 3), lambda t: 0.012 + 0.006 * math.sin(math.pi * t), [body, chest], surface='glow', slot=GLOW, rgb=0xff6a10, n=4)
    # The head: a big skull, a jutting brow, pointed ears, curled horns, a wide grinning maw.
    bt.blob(gv(Hd, 0, 0.05, 0.02), 0.13, 0.12, 0.12, bones=[head], **hide)
    bt.blob(gv(Hd, 0, 0.0, 0.11), 0.08, 0.06, 0.06, bones=[head], **hide)
    bt.capsule(gv(J, 0, -0.01, -0.02), gv(J, 0, -0.03, 0.11), 0.07, 0.035, bones=[jaw], slot=DARK)
    bt.hard.append(('glow', _ball(gv(Hd, 0, -0.025, 0.12), 1.0, (0.05, 0.05, 0.016)), Part([head], slot=GLOW, rgb=0xff7a20)))
    for sd in (-1, 1):
        bt.blob(gv(Hd, sd * 0.05, 0.1, 0.11), 0.045, 0.014, 0.035, rot=(0, 0, -sd * 0.4), bones=[head], slot=DARK)
        e = bt.surface(gv(Hd, sd * 0.055, 0.075, 0.6), G(0, 0, -1))
        bt.eye(e + G(0, 0, 0.004), 0.02, [head], rgb=0xffc020, squash=0.7)
        h = curve([gv(Hd, sd * 0.06, 0.14, 0.0), gv(Hd, sd * 0.14, 0.28, -0.04), gv(Hd, sd * 0.1, 0.36, -0.14), gv(Hd, sd * 0.06, 0.32, -0.2)], 3)
        bt.tube(h, lambda t: 0.032 * (1 - t) + 0.003, [head], surface='fur', rgb=horn, n=7)
        bt.tube([gv(Hd, sd * 0.1, 0.06, 0.0), gv(Hd, sd * 0.18, 0.09, -0.04), gv(Hd, sd * 0.25, 0.11, -0.07)], lambda t: 0.035 * (1 - t) + 0.002, [head], surface='fur', slot=MAIN, n=8, squash=0.35)
        for k in range(3):
            a = gv(Hd, sd * (0.02 + k * 0.022), -0.03, 0.14 - k * 0.012)
            bt.cone(a, a + G(0, -0.035, 0.005), 0.009, [head], rgb=0xf0e8d0)
    # Thin arms with three black claws.
    for arm in n['arms']:
        up, mid, low = arm['up'], arm['mid'], arm['low']
        S, E, W = B[up], B[mid], B[low]
        bt.capsule(S, E, 0.045, 0.035, bones=[up, mid], **limb)
        bt.capsule(E, W, 0.035, 0.03, bones=[mid, low], **limb)
        bt.blob(gv(W, 0, -0.03, 0.01), 0.032, 0.04, 0.03, bones=[low], **limb)
        for f in range(3):
            bt.tube(curve([gv(W, (f - 1) * 0.02, -0.05, 0.03), gv(W, (f - 1) * 0.028, -0.1, 0.06), gv(W, (f - 1) * 0.03, -0.13, 0.09)], 2), lambda t: 0.011 * (1 - t) + 0.001, [low], rgb=claw, n=5)
    # Digitigrade legs on clawed feet.
    for leg in n['limbs']:
        up, mid, low = leg['up'], leg['mid'], leg['low']
        U, M, L, F = B[up], B[mid], B[low], G(*leg['foot'])
        bt.capsule(U, M, 0.065, 0.045, bones=[up, mid], **limb)
        bt.capsule(M, L, 0.04, 0.03, bones=[mid, low], **limb)
        bt.capsule(L, F, 0.03, 0.03, bones=[low], slot=DARK)
        bt.blob(F + G(0, 0, 0.03), 0.035, 0.022, 0.055, bones=[low], slot=DARK)
        for f in range(3):
            a = F + G((f - 1) * 0.022, -0.005, 0.07)
            bt.cone(a, a + G((f - 1) * 0.01, -0.02, 0.04), 0.009, [low], rgb=claw)
    # The tail, ending in an arrowhead.
    pts = [B[t] for t in tail]
    end = pts[-1] + (pts[-1] - pts[-2]) * 0.6
    run = [gv(Bo, 0, -0.06, -0.06)] + pts + [end]
    rr = [0.04, 0.035, 0.028, 0.022, 0.016, 0.01]
    bt.chain(run, rr, [[body]] + [[tail[i], tail[min(i + 1, len(tail) - 1)]] for i in range(len(tail))], **hide)
    bt.tube([end - G(0, 0, -0.02), end + G(0, 0, -0.08), end + G(0, 0, -0.18)], lambda t: 0.075 * (1 - t) ** 0.8 + 0.002, [tail[-1]], surface='fur', slot=DARK, n=8, squash=0.15, wide=Vector((1, 0, 0)))
    # Wing arms and fingers, carrying the membrane the game stretches between them.
    for w in n['wings']:
        root, fore, hand, fingers = w['root'], w['fore'], w['hand'], w['fingers']
        S, E, W = B[root], B[fore], B[hand]
        sd = 1 if W.x > 0 else -1
        bt.capsule(S, E, 0.026, 0.02, bones=[root, fore], slot=DARK)
        bt.capsule(E, W, 0.02, 0.016, bones=[fore, hand], slot=DARK)
        tips = [(0.33, -0.06, -0.08), (0.22, -0.3, -0.16), (-0.02, -0.44, -0.14)]
        for f, t in zip(fingers, tips):
            tip = W + G(sd * t[0], t[1], t[2])
            bt.tube([W, W.lerp(tip, 0.5), tip], lambda u: 0.013 * (1 - u) + 0.003, [f], surface='fur', slot=DARK, n=5)
        bt.cone(W, W + G(sd * 0.02, 0.05, 0.05), 0.012, [hand], rgb=claw)
    return bt.build(0.0045, 7000, ('CLOUDS', 0.015, 0.0025), surface='fur'), ['fur', 'glow']


# ------------------------------------------------------------------ sea foes --


def fin(bt, base, tips, bones, rgb=0x5cbcc6, surface='membrane', scallop=0.22, rod_r=0.008, rod_rgb=0x1e5058, edge=0.6):
    """
    A fin: a sheet fanned between rods from a base out to each tip, its edge
    scalloped between the rods, paler toward its edge, the rods standing
    out darker (drawn two-sided).
    """
    base = Vector(base)
    tips = [Vector(t) for t in tips]
    bm = bmesh.new()
    rows = 4
    reach = max((t - base).length for t in tips)
    for i in range(len(tips) - 1):
        a, b = tips[i], tips[i + 1]
        grid = []
        for k in range(rows + 1):
            t = k / rows
            pa, pb = base.lerp(a, t), base.lerp(b, t)
            mid = pa.lerp(pb, 0.5)
            if k == rows:
                mid = base.lerp(mid, 1 - scallop)
            grid.append([bm.verts.new(pa), bm.verts.new(mid), bm.verts.new(pb)])
        for k in range(rows):
            for j in range(2):
                bm.faces.new([grid[k][j], grid[k][j + 1], grid[k + 1][j + 1], grid[k + 1][j]])
    for f in bm.faces:
        f.smooth = True
    part = Part(bones, slot=FIXED, rgb=rgb, mottle=0.2)
    bt.hard.append((surface, bm, part))
    for t in tips:
        bt.tube([base, base.lerp(t, 0.5), t], lambda u: rod_r * (1 - u) + 0.0015, bones, surface='shell', rgb=rod_rgb, n=4)


# -------------------------------------------------------------- stone giants --
# Humanoid great foes: the game's humanoid skeleton, its surfaces numbered
# ('0' matte, '1' metal, '2' glow), coloured in fixed colours of their own.


def shard(bt, base, d, length, r, bones, rgb):
    """A crystal: a five-sided prism ending in a point."""
    d = d.normalized()
    tip = base + d * length
    bt.tube([base - d * r, base + d * length * 0.6, tip], lambda t: r if t < 0.55 else r * (1 - t) / 0.45 + 0.002, bones, surface='2', slot=GLOW, rgb=rgb, n=5, flat=True)


# ------------------------------------------------------- humanoid monsters --


def bones_of(bt, bone_rgb, eye_rgb, surface='0', glow_cracks=None):
    """A walking skeleton, bone by bone: skull and jaw, spine, ribcage, pelvis, limb bones with knobbed joints, hands and feet."""
    n, B = bt.n, bt.B
    hips, spine, chest, head = n['hips'], n['spine'], n['chest'], n['head']
    Hp, Sp, C, Hd = B[hips], B[spine], B[chest], B[head]
    bn = lambda pts, r, bones, **kw: bt.tube(pts, r, bones, surface=surface, rgb=bone_rgb, n=kw.pop('n', 7), **kw)
    ball = lambda c, r, bones, sq=(1, 1, 1), rgb=bone_rgb: bt.hard.append((surface, _ball(c, r, sq), Part(bones, slot=FIXED, rgb=rgb)))
    # The skull: cranium, brow, cheekbones, deep sockets, a nasal hole, a hinged-looking jaw with teeth.
    ball(gv(Hd, 0, 0.12, -0.01), 0.1, [head], (0.9, 1.0, 1.05))
    ball(gv(Hd, 0, 0.05, 0.05), 0.075, [head], (1.0, 0.8, 0.9))
    for sd in (-1, 1):
        ball(gv(Hd, sd * 0.038, 0.09, 0.085), 0.03, [head], (1, 0.9, 0.6), rgb=0x0a0806)
        bt.eye(gv(Hd, sd * 0.038, 0.09, 0.1), 0.013, [head], rgb=eye_rgb)
        ball(gv(Hd, sd * 0.06, 0.05, 0.06), 0.025, [head], (1, 0.6, 1))
    ball(gv(Hd, 0, 0.045, 0.115), 0.014, [head], (0.8, 1.3, 0.5), rgb=0x0a0806)
    bn([gv(Hd, -0.055, 0.0, 0.02), gv(Hd, 0, -0.03, 0.095), gv(Hd, 0.055, 0.0, 0.02)], 0.022, [head])
    for k in range(6):
        x = (k - 2.5) * 0.016
        bt.cone(gv(Hd, x, 0.022, 0.1 - abs(x) * 0.4), gv(Hd, x, 0.0, 0.1 - abs(x) * 0.4), 0.007, [head], surface=surface, rgb=0xe8e0c8)
    # Neck and spine: a column of vertebrae from skull to pelvis.
    for k in range(9):
        t = k / 8
        p = gv(Hd, 0, -0.02, -0.02).lerp(gv(Hp, 0, 0.02, -0.04), t)
        bone = [head, chest] if t < 0.2 else [chest, spine] if t < 0.55 else [spine, hips]
        ball(p, 0.028 - 0.004 * math.sin(math.pi * t), bone, (1.2, 0.7, 1.0))
        bt.cone(p + G(0, 0, -0.01), p + G(0, -0.02, -0.06), 0.012, bone, surface=surface, rgb=bone_rgb)
    # The ribcage: ribs curving round from the spine to the breastbone.
    for k in range(6):
        y = 0.16 - k * 0.055
        w = 0.15 - abs(k - 2) * 0.012
        for sd in (-1, 1):
            pts = [gv(C, 0, y, -0.06), gv(C, sd * w * 0.9, y - 0.01, -0.03), gv(C, sd * w, y - 0.03, 0.05), gv(C, sd * w * 0.55, y - 0.05, 0.11), gv(C, 0, y - 0.06, 0.12)]
            bn(curve(pts, 2), 0.011, [chest], n=5)
    bn([gv(C, 0, 0.14, 0.12), gv(C, 0, -0.04, 0.13), gv(C, 0, -0.16, 0.11)], 0.016, [chest], n=5)
    for sd in (-1, 1):
        bn([gv(C, sd * 0.02, 0.17, 0.08), gv(C, sd * 0.12, 0.18, 0.03), gv(C, sd * 0.2, 0.17, 0.0)], 0.014, [chest])
        bn([gv(C, sd * 0.06, 0.16, -0.08), gv(C, sd * 0.14, 0.12, -0.1), gv(C, sd * 0.2, 0.17, -0.04)], 0.018, [chest], squash=0.4)
    # The pelvis.
    for sd in (-1, 1):
        bn(curve([gv(Hp, 0, 0.0, -0.05), gv(Hp, sd * 0.1, 0.07, -0.02), gv(Hp, sd * 0.13, 0.0, 0.04), gv(Hp, sd * 0.05, -0.06, 0.06)], 3), lambda t: 0.03 - 0.01 * t, [hips], n=7, squash=0.5)
    ball(gv(Hp, 0, -0.03, -0.04), 0.045, [hips], (1.2, 1, 0.8))
    # Limbs: long bones with knobbed ends.
    for side in ('L', 'R'):
        arm, fore, hand = n['arm' + side], n['fore' + side], n['hand' + side]
        leg, shin, foot = n['leg' + side], n['shin' + side], n['foot' + side]
        A, F, H = B[arm], B[fore], B[hand]
        L, S, Ft = B[leg], B[shin], B[foot]
        sd = 1 if A.x > 0 else -1
        ball(A, 0.035, [arm])
        bn([A, A.lerp(F, 0.5), F], lambda t: 0.018 + 0.006 * abs(t - 0.5) * 2, [arm])
        ball(F, 0.026, [arm, fore])
        for dx in (-0.012, 0.012):
            bn([F + G(dx, 0, 0), F.lerp(H, 0.5) + G(dx, 0, 0), H + G(dx * 0.6, 0.02, 0)], 0.011, [fore], n=5)
        ball(gv(H, 0, -0.02, 0.01), 0.026, [hand], (1, 1.1, 0.6))
        for f in range(4):
            sp = (f - 1.5) * 0.017
            k0 = gv(H, sp, -0.04, 0.02)
            bn(curve([k0, k0 + G(sp * 0.3, -0.05, 0.02), k0 + G(sp * 0.3, -0.09, 0.05)], 2), 0.007, [hand], n=4)
        ball(L, 0.04, [leg, hips])
        bn([L, L.lerp(S, 0.5), S], lambda t: 0.022 + 0.008 * abs(t - 0.5) * 2, [leg])
        ball(S + G(0, 0.02, 0.025), 0.03, [leg, shin], (1, 0.8, 0.7))
        ball(S, 0.032, [shin])
        bn([S, S.lerp(Ft, 0.5), Ft + G(0, 0.03, 0)], lambda t: 0.02 + 0.006 * abs(t - 0.5) * 2, [shin])
        bn([Ft + G(-0.025 * sd, 0, 0.02), Ft + G(-0.025 * sd, -0.01, 0.1)], 0.01, [shin, foot])
        ball(gv(Ft, 0, -0.02, 0.0), 0.03, [foot], (1, 0.8, 1.2))
        for t in range(4):
            x = (t - 1.5) * 0.02
            bn([gv(Ft, x, -0.04, 0.02), gv(Ft, x * 1.2, -0.07, 0.12)], 0.009, [foot], n=4)


@builder('h-506bf949', 0xcfc7ad)
def skeleton(bt):
    """A risen skeleton: yellowed bones, a rusted pauldron and a rag of a loincloth, cold blue eyes."""
    n, B = bt.n, bt.B
    bones_of(bt, 0xcfc7ad, 0x60a0ff)
    Hp, C = B[n['hips']], B[n['chest']]
    # A rag hanging from a belt.
    bt.tube([gv(Hp, -0.13, 0.04, 0.0), gv(Hp, 0, 0.06, 0.09), gv(Hp, 0.13, 0.04, 0.0), gv(Hp, 0, 0.03, -0.09), gv(Hp, -0.13, 0.04, 0.0)], 0.014, [n['hips']], surface='0', rgb=0x4a3a2a, n=5)
    for fz in (-1, 1):
        a = gv(Hp, 0.01, 0.04, fz * 0.08)
        bt.tube([a, a + G(0.01, -0.15, fz * 0.02), a + G(-0.02, -0.3, fz * 0.03)], lambda t: 0.08 * (1 - 0.4 * t), [n['hips']], surface='0', rgb=0x3a342a, n=6, squash=0.15, wide=Vector((1, 0, 0)))
    # One rusted pauldron on the left shoulder.
    A = B[n['armL']]
    bt.hard.append(('1', cap(gv(A, 0.01, 0.04, 0), 0.085, 1.1, G(0.5, 1, 0), segs=14, rings=4, thick=0.012), Part([n['armL']], slot=FIXED, rgb=0x8a7262)))
    return bt.build(0.01, 500, None, surface='0'), ['0', '1', '2']


@builder('h-56336bd5', 0x3a302c)
def revenant(bt):
    """An ash revenant: a charred skeleton in broken black plate, embers glowing between its bones, burning eyes, a scorched cape."""
    n, B = bt.n, bt.B
    hips, chest, head = n['hips'], n['chest'], n['head']
    Hp, C, Hd = B[hips], B[chest], B[head]
    bones_of(bt, 0x3a302c, 0xff8a30)
    plate = 0x2a2220
    # A breastplate, broken open on one side, ember light within.
    bt.hard.append(('1', cap(gv(C, 0.02, 0.02, 0.0), 0.2, 1.25, G(0, 0, 1), segs=16, rings=5, thick=0.02), Part([chest], slot=FIXED, rgb=plate)))
    bt.hard.append(('1', cap(gv(C, 0.0, 0.04, -0.02), 0.19, 1.15, G(0, 0, -1), segs=16, rings=5, thick=0.02), Part([chest], slot=FIXED, rgb=plate)))
    bt.eye(gv(C, -0.05, 0.0, 0.03), 0.06, [chest], rgb=0xff6a20)
    for side in ('L', 'R'):
        A, L = B[n['arm' + side]], B[n['leg' + side]]
        sd = 1 if A.x > 0 else -1
        bt.hard.append(('1', cap(gv(A, sd * 0.02, 0.04, 0), 0.1, 1.15, G(sd * 0.6, 1, 0), segs=14, rings=4, thick=0.015), Part([n['arm' + side]], slot=FIXED, rgb=plate)))
        bt.hard.append(('1', cap(gv(A, sd * 0.03, -0.02, 0), 0.085, 1.0, G(sd * 1, 0.4, 0), segs=14, rings=4, thick=0.015), Part([n['arm' + side]], slot=FIXED, rgb=plate)))
        bt.tube([gv(L, 0, -0.08, 0.02), gv(L, 0, -0.32, 0.03)], lambda t: 0.075 - 0.01 * t, [n['leg' + side]], surface='1', rgb=plate, n=8, squash=0.7)
        S = B[n['shin' + side]]
        bt.tube([gv(S, 0, -0.06, 0.03), gv(S, 0, -0.34, 0.03)], lambda t: 0.06 - 0.008 * t, [n['shin' + side]], surface='1', rgb=plate, n=8, squash=0.7)
        for k in range(3):
            bt.eye(gv(L, sd * 0.03, -0.1 - k * 0.12, 0.06), 0.012, [n['leg' + side]], rgb=0xff6a20)
    # A skirt of scorched mail plates.
    for k in range(10):
        a = k / 10 * math.tau
        p = gv(Hp, math.sin(a) * 0.15, -0.05, math.cos(a) * 0.12)
        bt.tube([p, p + G(math.sin(a) * 0.03, -0.18, math.cos(a) * 0.03)], lambda t: 0.04, [hips], surface='1', rgb=plate, n=4, squash=0.25, wide=G(math.cos(a), 0, -math.sin(a)))
    # A ragged cape on its own bones.
    cape = n.get('cape', -1)
    if cape is not None and cape >= 0:
        chain_ = [cape]
        while bt.child(chain_[-1]) is not None:
            chain_.append(bt.child(chain_[-1]))
        pts = [B[k] for k in chain_]
        tip = pts[-1] + (pts[-1] - pts[-2]) * 0.6
        bt.tube(curve(pts + [tip], 3), lambda t: 0.26 * (1 + 0.1 * t) * (1 - 0.35 * t * t), chain_, surface='0', rgb=0x1e1614, n=10, squash=0.08, wide=Vector((1, 0, 0)))
    return bt.build(0.01, 500, None, surface='0'), ['0', '1', '2']


@builder('h-921ba84b', 0x8aa2b4)
def frost_troll(bt):
    """A frost troll: hunched, pot-bellied and long-armed, frost-blue hide, a tusked underbite, a white mane, ice growing from its shoulders."""
    n, B = bt.n, bt.B
    hips, spine, chest, head = n['hips'], n['spine'], n['chest'], n['head']
    Hp, Sp, C, Hd = B[hips], B[spine], B[chest], B[head]
    hide = dict(slot=FIXED, rgb=0x8aa2b4, mottle=0.35)
    pale = dict(slot=FIXED, rgb=0xb4c4d0, mottle=0.3)
    bt.blob(gv(C, 0, 0.06, -0.04), 0.3, 0.22, 0.22, bones=[chest], **hide)
    bt.blob(gv(C, 0, 0.16, -0.1), 0.26, 0.14, 0.17, bones=[chest], **hide)
    bt.blob(gv(Sp, 0, -0.02, 0.06), 0.24, 0.2, 0.22, bones=[spine], **pale)
    bt.capsule(gv(Sp, 0, 0, 0), gv(Hp, 0, -0.02, 0), 0.22, 0.2, bones=[spine, hips], **hide)
    # The head sunk forward between the shoulders: heavy brow, small eyes, a jutting jaw with tusks, a big nose.
    bt.capsule(gv(C, 0, 0.18, 0.0), gv(Hd, 0, 0.0, 0.03), 0.13, 0.1, bones=[chest, head], **hide)
    bt.blob(gv(Hd, 0, 0.1, 0.04), 0.11, 0.11, 0.11, bones=[head], **hide)
    bt.blob(gv(Hd, 0, 0.14, 0.11), 0.1, 0.035, 0.05, bones=[head], **hide)
    bt.blob(gv(Hd, 0, 0.05, 0.14), 0.035, 0.05, 0.05, bones=[head], **pale)
    bt.blob(gv(Hd, 0, -0.02, 0.1), 0.1, 0.06, 0.08, bones=[head], **hide)
    for sd in (-1, 1):
        e = bt.surface(gv(Hd, sd * 0.045, 0.11, 0.6), G(0, 0, -1))
        bt.eye(e + G(0, 0, 0.004), 0.013, [head], rgb=0x9ad8ff)
        bt.tube(curve([gv(Hd, sd * 0.05, -0.02, 0.15), gv(Hd, sd * 0.06, 0.04, 0.17), gv(Hd, sd * 0.045, 0.08, 0.15)], 2), lambda t: 0.018 * (1 - t) + 0.003, [head], surface='0', rgb=0xe8e4d8, n=6)
        bt.tube([gv(Hd, sd * 0.1, 0.11, 0.0), gv(Hd, sd * 0.17, 0.14, -0.04)], lambda t: 0.035 * (1 - t) + 0.003, [head], surface='0', slot=FIXED, rgb=0x8aa2b4, n=6, squash=0.4)
    # A shaggy white mane down the back, a beard.
    for k in range(9):
        a = (k / 8 - 0.5) * 2.4 + math.pi
        root = gv(Hd, math.sin(a) * 0.08, 0.17, math.cos(a) * 0.08)
        bt.tube([root, root + G(math.sin(a) * 0.05, -0.15, math.cos(a) * 0.08), root + G(math.sin(a) * 0.06, -0.32, math.cos(a) * 0.12 - 0.04)], lambda t: 0.04 * (1 - 0.8 * t), [head, chest], surface='0', rgb=0xe8eef4, n=5, squash=0.5)
    for x in (-0.04, 0.0, 0.04):
        bt.tube([gv(Hd, x, -0.06, 0.14), gv(Hd, x * 1.3, -0.16, 0.13)], lambda t: 0.025 * (1 - 0.8 * t), [head], surface='0', rgb=0xe8eef4, n=5)
    # Long heavy arms, huge hands; short thick legs.
    for side in ('L', 'R'):
        arm, fore, hand = n['arm' + side], n['fore' + side], n['hand' + side]
        leg, shin, foot = n['leg' + side], n['shin' + side], n['foot' + side]
        A, F, H = B[arm], B[fore], B[hand]
        L, S, Ft = B[leg], B[shin], B[foot]
        sd = 1 if A.x > 0 else -1
        bt.blob(gv(A, sd * 0.02, 0.03, -0.02), 0.13, 0.12, 0.13, bones=[arm, chest], group='sh' + side, **hide)
        bt.capsule(gv(A, 0, -0.04, 0), F, 0.1, 0.085, bones=[arm, fore], group='arm' + side, **hide)
        bt.capsule(F, gv(H, 0, 0.03, 0), 0.09, 0.075, bones=[fore, hand], group='arm' + side, **hide)
        bt.blob(gv(H, 0, -0.06, 0.02), 0.07, 0.08, 0.075, bones=[hand], group='arm' + side, **hide)
        for f in range(4):
            bt.capsule(gv(H, (f - 1.5) * 0.034, -0.1, 0.05), gv(H, (f - 1.5) * 0.038, -0.17, 0.08), 0.022, 0.017, bones=[hand], group='arm' + side, **hide)
        bt.tube([gv(F, 0, -0.04, 0), gv(F, 0, -0.18, 0.01)], 0.1, [fore], surface='0', rgb=0x8a7a64, n=10)
        bt.capsule(gv(L, 0, -0.02, 0), S, 0.13, 0.1, bones=[leg, shin], **hide)
        bt.capsule(S, gv(Ft, 0, 0.04, 0), 0.095, 0.085, bones=[shin, foot], **hide)
        bt.blob(gv(Ft, 0, -0.02, 0.07), 0.08, 0.05, 0.13, bones=[foot], **hide)
        for t in range(3):
            bt.cone(gv(Ft, (t - 1) * 0.04, -0.04, 0.17), gv(Ft, (t - 1) * 0.045, -0.06, 0.22), 0.016, [foot], surface='0', rgb=0x3a3a40)
        # Ice crystals growing from the shoulders.
        for dx, dy, ln in ((0.06, 0.12, 0.16), (0.12, 0.07, 0.12), (0.0, 0.13, 0.12)):
            shard(bt, gv(A, sd * dx, dy, -0.05), G(sd * (0.3 + dx * 3), 1, -0.4), ln, 0.03, [arm], 0x9ad8ff)
    # A hide loincloth on a rope belt.
    bt.tube([gv(Hp, -0.2, 0.06, 0.0), gv(Hp, 0, 0.08, 0.19), gv(Hp, 0.2, 0.06, 0.0), gv(Hp, 0, 0.04, -0.19), gv(Hp, -0.2, 0.06, 0.0)], 0.02, [hips], surface='0', rgb=0x6a5a40, n=5)
    for fz in (-1, 1):
        a = gv(Hp, 0, 0.05, fz * 0.18)
        bt.tube([a, a + G(0, -0.18, fz * 0.03), a + G(0, -0.34, fz * 0.04)], lambda t: 0.13 * (1 - 0.3 * t), [hips], surface='0', rgb=0x4e4234, n=6, squash=0.15, wide=Vector((1, 0, 0)))
    return bt.build(0.008, 6000, ('CLOUDS', 0.04, 0.006), surface='0'), ['0', '1', '2']


@builder('h-14460606', 0x5a7a6a)
def drowned(bt):
    """One of the drowned: a bloated sea-green corpse in rotting rags, barnacled and hung with weed, glowing eyes in a sunken face."""
    n, B = bt.n, bt.B
    hips, spine, chest, head = n['hips'], n['spine'], n['chest'], n['head']
    Hp, Sp, C, Hd = B[hips], B[spine], B[chest], B[head]
    flesh = dict(slot=FIXED, rgb=0x5a7a6a, mottle=0.45)
    rag = dict(slot=FIXED, rgb=0x2a3a34, mottle=0.3)
    bt.blob(gv(C, 0, 0.04, 0.0), 0.2, 0.18, 0.15, bones=[chest], **rag)
    bt.blob(gv(Sp, 0, -0.02, 0.04), 0.18, 0.17, 0.17, bones=[spine], **flesh)
    bt.capsule(gv(Sp, 0, 0, 0), gv(Hp, 0, -0.02, 0), 0.17, 0.16, bones=[spine, hips], **rag)
    bt.capsule(gv(C, 0, 0.16, 0.0), gv(Hd, 0, 0.02, 0.0), 0.07, 0.06, bones=[chest, head], **flesh)
    # The head: a gaunt skull of a face, sunken cheeks, lank hair, glowing eyes, a slack jaw.
    bt.blob(gv(Hd, 0, 0.12, 0.0), 0.1, 0.12, 0.11, bones=[head], **flesh)
    bt.blob(gv(Hd, 0, 0.04, 0.05), 0.07, 0.06, 0.07, bones=[head], **flesh)
    for sd in (-1, 1):
        e = bt.surface(gv(Hd, sd * 0.038, 0.12, 0.6), G(0, 0, -1))
        bt.hard.append(('0', _ball(e, 0.022, (1, 0.8, 0.5)), Part([head], slot=FIXED, rgb=0x0a1210)))
        bt.eye(e + G(0, 0, 0.006), 0.012, [head], rgb=0x60ffe0)
    m = bt.surface(gv(Hd, 0, 0.03, 0.6), G(0, 0, -1))
    bt.hard.append(('0', _ball(m, 0.02, (1.2, 0.8, 0.5)), Part([head], slot=FIXED, rgb=0x0a1210)))
    for k in range(7):
        a = (k / 6 - 0.5) * 2.6 + math.pi
        root = gv(Hd, math.sin(a) * 0.09, 0.19, math.cos(a) * 0.09)
        bt.tube([root, root + G(math.sin(a) * 0.04, -0.15, math.cos(a) * 0.05), root + G(math.sin(a) * 0.03, -0.3, math.cos(a) * 0.06)], lambda t: 0.025 * (1 - 0.7 * t), [head, chest], surface='0', rgb=0x1a2420, n=4, squash=0.5)
    for side in ('L', 'R'):
        arm, fore, hand = n['arm' + side], n['fore' + side], n['hand' + side]
        leg, shin, foot = n['leg' + side], n['shin' + side], n['foot' + side]
        A, F, H = B[arm], B[fore], B[hand]
        L, S, Ft = B[leg], B[shin], B[foot]
        sd = 1 if A.x > 0 else -1
        bt.capsule(A, F, 0.055, 0.045, bones=[arm, fore], group='arm' + side, **rag)
        bt.capsule(F, gv(H, 0, 0.03, 0), 0.042, 0.034, bones=[fore, hand], group='arm' + side, **flesh)
        bt.blob(gv(H, 0, -0.05, 0.02), 0.035, 0.05, 0.03, bones=[hand], group='arm' + side, **flesh)
        for f in range(4):
            bt.capsule(gv(H, (f - 1.5) * 0.018, -0.08, 0.03), gv(H, (f - 1.5) * 0.02, -0.15, 0.06), 0.01, 0.007, bones=[hand], group='arm' + side, **flesh)
        bt.capsule(gv(L, 0, -0.03, 0), S, 0.07, 0.055, bones=[leg, shin], **rag)
        bt.capsule(S, gv(Ft, 0, 0.04, 0), 0.05, 0.045, bones=[shin, foot], **flesh)
        bt.blob(gv(Ft, 0, -0.02, 0.06), 0.045, 0.035, 0.1, bones=[foot], **flesh)
        # Rags hanging from the sleeve.
        a0 = A.lerp(F, 0.85)
        bt.tube([a0, a0 + G(sd * 0.02, -0.12, -0.02)], lambda t: 0.05 * (1 - 0.6 * t), [fore], surface='0', rgb=0x2a3a34, n=5, squash=0.2, wide=G(0, 0, 1))
    # Weed and barnacles.
    for k in range(6):
        a = k / 6 * math.tau + 0.3
        root = gv(C, math.sin(a) * 0.17, 0.1 - (k % 2) * 0.1, math.cos(a) * 0.13)
        bt.tube([root, root + G(math.sin(a) * 0.03, -0.25, math.cos(a) * 0.02), root + G(math.sin(a) * 0.02, -0.5, math.cos(a) * 0.03)], lambda t: 0.03 * (1 - 0.7 * t), [chest, spine], surface='0', rgb=0x2e5030 if k % 2 else 0x3e6034, n=4, squash=0.3)
    for k in range(10):
        a = k * 2.4
        p = bt.surface(gv(C, math.sin(a) * 0.5, 0.12 - (k % 4) * 0.08, math.cos(a) * 0.5), G(-math.sin(a), 0, -math.cos(a)))
        bt.hard.append(('0', _ball(p, 0.016, (1, 1, 0.6)), Part([chest], slot=FIXED, rgb=0xa8b0a2)))
    return bt.build(0.007, 5000, ('CLOUDS', 0.03, 0.004), surface='0'), ['0', '1', '2']

# ------------------------------------------------------------- great foes --
# Forged, not sculpted: crisp flat-shaded plate, blade and horn (forge.py).


class Body:
    """A humanoid's joints by name (Blender positions), left and right."""

    def __init__(self, bt):
        n, B = bt.n, bt.B
        self.bt, self.n, self.B = bt, n, B
        self.hips, self.spine, self.chest, self.head = n['hips'], n['spine'], n['chest'], n['head']
        self.Hp, self.Sp, self.C, self.Hd = B[self.hips], B[self.spine], B[self.chest], B[self.head]
        self.sides = []
        for side in ('L', 'R'):
            j = {k: n[k + side] for k in ('arm', 'fore', 'hand', 'leg', 'shin', 'foot')}
            self.sides.append((1 if B[j['arm']].x > 0 else -1, j))

    def P(self, j):
        return self.B[j]


@builder('h-662e96e4', 0x1a1426)
def erebus(bt):
    """Erebus, god of darkness: black plate with violet light in its seams, a horned helm over a void, wings of night."""
    p = Body(bt)
    C, Hp, Sp, Hd = p.C, p.Hp, p.Sp, p.Hd
    ch, hip, sp, hd = p.chest, p.hips, p.spine, p.head
    PL, PD, EDGE, TRIM, CLOTH, VOID = 0x2c2735, 0x16131c, 0x4a4060, 0xa070ff, 0x1d1527, 0x030205
    # ---- torso: a keeled breastplate, ribbed belly lames, the void in the chest
    keel = lambda a, i: 1 + 0.07 * max(0.0, math.cos(a)) ** 6 if 1 <= i <= 3 else 1
    F.hull(bt, [(gv(C, 0, -0.17, 0.0), 0.16, 0.115), (gv(C, 0, -0.08, 0.012), 0.19, 0.13), (gv(C, 0, 0.03, 0.02), 0.215, 0.145), (gv(C, 0, 0.13, 0.012), 0.225, 0.142), (gv(C, 0, 0.21, -0.008), 0.18, 0.12), (gv(C, 0, 0.255, -0.012), 0.1, 0.085)], [ch], PL, sides=14, wave=keel)
    for k in range(3):
        y = 0.06 - k * 0.07
        F.hull(bt, [(gv(Sp, 0, y + 0.035, 0.008), 0.152 + 0.006 * k, 0.11), (gv(Sp, 0, y - 0.03, 0.01), 0.16 + 0.006 * k, 0.116)], [sp, hip] if k == 2 else [sp], PD if k % 2 else PL, sides=14)
    core = gv(C, 0, 0.04, 0.165)
    F.gem(bt, core, 0.055, [ch], VOID, surf='0', glow=False, stretch=1.2)
    F.ring(bt, core, 0.075, [ch], TRIM, width=0.016, thick=0.014, axis=(0, 0, 1), glow=True, surf='2')
    for k in range(6):
        a = k / 6 * math.tau + 0.3
        F.blade(bt, core + G(math.sin(a) * 0.08, math.cos(a) * 0.08, -0.01), core + G(math.sin(a) * 0.19, math.cos(a) * 0.17, -0.035), 0.012, [ch], TRIM, thick=0.004, surf='2', glow=True, side=G(0, 0, 1))
    # The gorget: a high collar, spiked behind.
    F.hull(bt, [(gv(C, 0, 0.23, -0.005), 0.15, 0.13), (gv(C, 0, 0.33, -0.01), 0.125, 0.12)], [ch, hd], PD, sides=12, arc=(-2.6, 2.6))
    for k in range(7):
        a = math.pi + (k - 3) * 0.32
        b = gv(C, math.sin(a) * 0.13, 0.27, math.cos(a) * 0.12)
        F.spike(bt, b, b + G(math.sin(a) * 0.08, 0.2 + 0.05 * (3 - abs(k - 3)), math.cos(a) * 0.1), 0.022, [ch], EDGE)
    # ---- shoulders: three lames each, spiked, with violet light along the top one
    for sd, j in p.sides:
        A, Fo, W = p.P(j['arm']), p.P(j['fore']), p.P(j['hand'])
        arm, fore, hand = j['arm'], j['fore'], j['hand']
        for k in range(3):
            F.dome(bt, gv(A, sd * (0.02 + 0.012 * k), 0.05 - 0.065 * k, 0), 0.17 - 0.022 * k, [arm, ch] if k == 0 else [arm], PL if k % 2 == 0 else PD, axis=(sd * 0.55, 1, 0), theta=1.25, thick=0.014, squash=(1.05, 0.85, 1.1))
        F.ring(bt, gv(A, sd * 0.02, 0.05, 0), 0.16, [arm, ch], TRIM, width=0.012, thick=0.01, axis=(sd * 0.55, 1, 0), glow=True, surf='2', arc=(0.6, math.tau - 0.6))
        for v in (-0.07, 0.0, 0.07):
            b = gv(A, sd * 0.07, 0.17, v)
            F.spike(bt, b, b + G(sd * 0.16, 0.3 - abs(v) * 1.2, v * 1.6), 0.03, [arm], EDGE)
            F.gem(bt, b + G(sd * 0.16, 0.3 - abs(v) * 1.2, v * 1.6), 0.012, [arm], TRIM)
        # Mail under the plate, a rerebrace, a spiked couter, a flared vambrace, a clawed gauntlet.
        F.prism(bt, gv(A, 0, -0.04, 0), Fo, 0.068, 0.058, [arm, fore], PD, sides=8, surf='0')
        F.hull(bt, [(gv(A, 0, -0.08, 0), 0.075, 0.075), (A.lerp(Fo, 0.75), 0.068, 0.068)], [arm], PL, sides=8, arc=(-2.2, 2.2))
        F.dome(bt, gv(Fo, 0, 0.0, -0.01), 0.07, [fore], PL, axis=(0, 0.2, -1), theta=1.3, thick=0.01)
        F.spike(bt, gv(Fo, 0, 0.0, -0.06), gv(Fo, 0, 0.04, -0.2), 0.025, [fore], EDGE)
        F.hull(bt, [(Fo.lerp(W, 0.1), 0.058, 0.058), (Fo.lerp(W, 0.6), 0.064, 0.064), (Fo.lerp(W, 0.95), 0.082, 0.082)], [fore], PL, sides=8)
        F.ring(bt, Fo.lerp(W, 0.92), 0.085, [fore], TRIM, width=0.012, thick=0.008, glow=True, surf='2')
        F.plate(bt, gv(W, 0, -0.05, 0.02), (0.075, 0.09, 0.05), [hand], PD, bevel=0.3)
        for f in range(4):
            x = (f - 1.5) * 0.017
            k0 = gv(W, x, -0.09, 0.035)
            k1 = k0 + G(0, -0.06, 0.025)
            F.prism(bt, k0, k1, 0.011, 0.009, [hand], PD, sides=5)
            F.spike(bt, k1, k1 + G(0, -0.045, 0.03), 0.009, [hand], EDGE)
        F.prism(bt, gv(W, -sd * 0.03, -0.05, 0.04), gv(W, -sd * 0.05, -0.1, 0.07), 0.012, 0.009, [hand], PD, sides=5)
    # ---- hips: faulds in rows, tassets, tattered cloth to the shin
    for k in range(3):
        y = 0.04 - k * 0.065
        F.hull(bt, [(gv(Hp, 0, y + 0.035, 0.01), 0.175 + 0.012 * k, 0.13 + 0.008 * k), (gv(Hp, 0, y - 0.035, 0.012), 0.188 + 0.012 * k, 0.138 + 0.008 * k)], [hip], PL if k % 2 == 0 else PD, sides=14, arc=(-2.3, 2.3))
    for sd, j in p.sides:
        L, S, Ft = p.P(j['leg']), p.P(j['shin']), p.P(j['foot'])
        leg, shin, foot = j['leg'], j['shin'], j['foot']
        F.plate(bt, gv(L, sd * 0.05, -0.15, 0.04), (0.15, 0.2, 0.018), [leg], PL, rot=(-0.12, 0, sd * 0.12), bevel=0.4, taper=1.15)
        F.plate(bt, gv(L, sd * 0.06, -0.27, 0.05), (0.13, 0.12, 0.016), [leg], PD, rot=(-0.12, 0, sd * 0.12), bevel=0.4)
        # Under the plate a dark padded leg; a cuisse, a spiked poleyn, a ridged greave, a pointed sabaton.
        F.prism(bt, gv(L, 0, 0.02, 0), S, 0.09, 0.07, [hip, leg], CLOTH, sides=8, surf='0')
        F.hull(bt, [(L.lerp(S, 0.35), 0.088, 0.085), (L.lerp(S, 0.9), 0.072, 0.07)], [leg], PL, sides=8, arc=(-1.7, 1.7))
        F.dome(bt, gv(S, 0, 0.0, 0.035), 0.065, [leg, shin], PL, axis=(0, 0.25, 1), theta=1.3, thick=0.01)
        F.spike(bt, gv(S, 0, 0.0, 0.09), gv(S, 0, 0.06, 0.2), 0.022, [shin], EDGE)
        ridge = lambda a, i: 1 + 0.18 * max(0.0, math.cos(a)) ** 10
        F.hull(bt, [(gv(S, 0, -0.04, 0), 0.07, 0.072), (S.lerp(Ft, 0.5), 0.064, 0.066), (gv(Ft, 0, 0.02, 0), 0.06, 0.062)], [shin], PL, sides=10, wave=ridge)
        F.plate(bt, gv(Ft, 0, -0.03, 0.055), (0.11, 0.1, 0.23), [foot], PD, bevel=0.35, taper=0.7)
        F.spike(bt, gv(Ft, 0, -0.05, 0.16), gv(Ft, 0, -0.07, 0.28), 0.03, [foot], EDGE)
        F.ring(bt, gv(Ft, 0, 0.03, 0), 0.066, [shin], TRIM, width=0.01, thick=0.008, glow=True, surf='2')
    strips = [(-0.13, 0.15, 1), (-0.04, 0.17, 1), (0.05, 0.16, 1), (0.13, 0.14, 1), (-0.14, 0.15, -1), (-0.05, 0.17, -1), (0.04, 0.18, -1), (0.14, 0.15, -1)]
    for x, w, face in strips:
        leg = p.sides[0][1]['leg'] if (x > 0) == (p.sides[0][0] > 0) else p.sides[1][1]['leg']
        top = gv(Hp, x, -0.06, face * 0.15)
        drop = 0.42 + 0.08 * math.sin(x * 40)
        F.ribbon(bt, [top, top + G(0, -drop * 0.5, face * 0.03), top + G(0, -drop, face * 0.06)], [w, w * 0.95, w * 0.6], G(1, 0, 0), [hip, leg], CLOTH)
    # ---- the helm: horned, a black visor over a void, two violet eyes, a crown of shadow
    F.hull(bt, [(gv(Hd, 0, 0.02, 0.0), 0.1, 0.11), (gv(Hd, 0, 0.12, 0.005), 0.125, 0.135), (gv(Hd, 0, 0.22, 0.0), 0.13, 0.14), (gv(Hd, 0, 0.3, -0.01), 0.105, 0.115), (gv(Hd, 0, 0.35, -0.02), 0.04, 0.05)], [hd], PD, sides=12, wave=lambda a, i: 1 + 0.08 * max(0.0, math.cos(a)) ** 8 if i in (1, 2) else 1)
    F.plate(bt, gv(Hd, 0, 0.15, 0.135), (0.17, 0.055, 0.02), [hd], VOID, bevel=0.3, surf='0', rot=(0.1, 0, 0))
    for sd in (-1, 1):
        F.gem(bt, gv(Hd, sd * 0.042, 0.155, 0.148), 0.018, [hd], 0xd0a0ff, stretch=0.55)
        F.chain(bt, [gv(Hd, sd * 0.105, 0.22, -0.01), gv(Hd, sd * 0.2, 0.3, -0.06), gv(Hd, sd * 0.25, 0.43, -0.17), gv(Hd, sd * 0.22, 0.56, -0.33), gv(Hd, sd * 0.16, 0.62, -0.45)], [0.04, 0.032, 0.022, 0.012, 0.004], [hd], PD, sides=6)
    for k in range(9):
        a = (k - 4) * 0.36
        tall = 0.13 + 0.09 * (1 - abs(k - 4) / 4)
        b = gv(Hd, math.sin(a) * 0.11, 0.3, math.cos(a) * 0.11 - 0.015)
        F.blade(bt, b, b + G(math.sin(a) * 0.05, tall, math.cos(a) * 0.04), 0.035, [hd], TRIM if k % 2 == 0 else 0x6a40b0, thick=0.01, surf='2', glow=True)
    # ---- the cape: tattered strips down the cape chain
    cape = [p.n['cape']]
    while bt.child(cape[-1]) is not None:
        cape.append(bt.child(cape[-1]))
    cp = [p.B[k] for k in cape]
    for i in range(7):
        x = (i - 3) * 0.075
        drop = 1.0 - 0.12 * ((i * 7) % 3)
        pts = [c + G(x * (1 + 0.25 * t), 0, -0.012 * abs(i - 3)) for t, c in enumerate(cp)]
        tip = pts[-1] + (pts[-1] - pts[-2]) * (0.55 * drop)
        F.ribbon(bt, pts + [tip], [0.085] * len(pts) + [0.03], G(1, 0, 0), cape, 0x120d1a)
    # ---- wings of night: a jointed spar and long black feathers, violet at the edge
    for root, tip in ((20, 21), (22, 23)):
        R, T = Vector(bt.B[root]), Vector(bt.B[tip])
        sdw = 1 if T.x > R.x else -1
        elbow = R.lerp(T, 0.45) + G(0, 0.12, -0.05)
        F.chain(bt, [R, elbow, T, T + (T - elbow).normalized() * 0.25], [0.035, 0.03, 0.02, 0.006], [root, tip], PD, sides=6)
        tipx = T + (T - elbow).normalized() * 0.2
        # Secondaries hang from the inner spar; primaries fan out from the outer one, longest at the tip.
        for i in range(7):
            t = i / 6
            base = R.lerp(elbow, 0.15 + 0.85 * t)
            L = 0.52 + 0.12 * t
            F.blade(bt, base, base + G(sdw * 0.04 * t, -L, -0.05), 0.15, [root, tip], 0x1b1724 if i % 2 else 0x221c2c, thick=0.014, side=G(sdw, 0, 0.25), belly=0.55)
        for i in range(8):
            t = i / 7
            base = elbow.lerp(tipx, t)
            phi = 0.15 + 1.05 * t
            L = 0.66 + 0.34 * t
            d = G(sdw * math.sin(phi), -math.cos(phi), -0.12)
            F.blade(bt, base, base + d * L, 0.15 - 0.03 * t, [root, tip], 0x221c2c if i % 2 else 0x1b1724, thick=0.014, side=G(math.cos(phi) * sdw, math.sin(phi), 0.2), belly=0.55)
            if i % 2 == 1:
                e = base + d * L
                F.blade(bt, e - d * 0.14, e + d * 0.02, 0.05, [root, tip], TRIM, thick=0.008, surf='2', glow=True, side=G(math.cos(phi) * sdw, math.sin(phi), 0.2))
        # Coverts over the bones of the wing.
        for i in range(9):
            t = i / 8
            base = R.lerp(elbow, t * 2) if t < 0.5 else elbow.lerp(tipx, (t - 0.5) * 2)
            F.blade(bt, base + G(0, 0.03, 0.01), base + G(sdw * 0.06 * t, -0.3 - 0.06 * t, -0.02), 0.13, [root, tip], PL, thick=0.016, side=G(sdw, 0, 0.25), belly=0.5)
    bt.ao_floor = 0.6
    return bt.build(0.01, 4000, surface='0'), ['0', '1', '2']


CREATURE_SURFACES = ['fur', 'shell', 'glow', 'scale', 'membrane', 'ghost']


@builder('stag', 0x4a4232)
def stag(bt):
    """Cernunna, the Antlered Shade: a gaunt spirit stag of dark bark, a bone skull for a face, vast antlers hung with moss."""
    n, B = bt.n, bt.B
    hips, chest, head, jaw = n['hips'], n['chest'], n['head'], n['jaw']
    nk = n['neck']
    BARK, BARK2, BELLY, BONE, HOOF, MOSS, GREEN = 0x3b3328, 0x2c261e, 0x5a4e3c, 0xe2d8bf, 0x161210, 0x3e5c2a, 0x6affc0
    P = lambda i: Vector(B[i])
    # ---- the body: a deep chest, a lean waist, high haunches
    body = [(0, 1.33, -0.76), (0, 1.32, -0.64), (0, 1.3, -0.44), (0, 1.27, -0.18), (0, 1.27, 0.1), (0, 1.27, 0.33), (0, 1.36, 0.5), (0, 1.44, 0.57)]
    F.loft(bt, [G(*q) for q in body], [0.05, 0.13, 0.17, 0.145, 0.17, 0.185, 0.15, 0.1], [0.06, 0.16, 0.2, 0.165, 0.215, 0.24, 0.19, 0.12], [hips, chest], BARK, sides=10)
    # A paler belly and throat, and the haunches and shoulders standing out.
    F.loft(bt, [G(0, 1.13, -0.3), G(0, 1.1, 0.0), G(0, 1.1, 0.3)], [0.1, 0.11, 0.12], [0.05, 0.06, 0.07], [hips, chest], BELLY, sides=8)
    for sd in (-1, 1):
        F.loft(bt, [G(sd * 0.11, 1.42, -0.62), G(sd * 0.13, 1.27, -0.47), G(sd * 0.13, 1.08, -0.38)], [0.06, 0.1, 0.07], [0.08, 0.12, 0.08], [hips], BARK2, sides=8)
        F.loft(bt, [G(sd * 0.12, 1.44, 0.32), G(sd * 0.14, 1.28, 0.4), G(sd * 0.13, 1.08, 0.38)], [0.06, 0.09, 0.065], [0.08, 0.1, 0.07], [chest], BARK2, sides=8)
        # Runes of green light on the flanks.
        for k in range(3):
            z = -0.25 + k * 0.22
            a = G(sd * 0.168, 1.32 - k * 0.02, z)
            F.blade(bt, a, a + G(sd * 0.01, -0.13, 0.05), 0.016, [hips, chest], GREEN, thick=0.005, surf='glow', glow=True, side=G(0, 0, 1))
    # ---- the neck and mane
    F.loft(bt, [G(0, 1.38, 0.5), P(nk[0]), P(nk[1]), P(head) + G(0, -0.02, -0.02)], [0.13, 0.115, 0.09, 0.07], [0.16, 0.14, 0.1, 0.08], [chest] + nk + [head], BARK, sides=9)
    for i in range(11):
        t = i / 10
        a = G(0, 1.5, 0.44).lerp(P(head) + G(0, 0.05, -0.06), t)
        for sd in (-1, 1):
            L = 0.2 - 0.08 * t + 0.04 * ((i * 5 + (sd > 0)) % 3)
            F.blade(bt, a + G(sd * 0.04, 0.02, 0), a + G(sd * (0.08 + 0.05 * ((i + (sd > 0)) % 2)), -0.1, -L), 0.09, [chest] + nk if t < 0.5 else nk + [head], 0x221c15 if (i + (sd > 0)) % 2 else BARK2, thick=0.014, side=G(0, 1, 0.3))
    for i in range(10):
        t = i / 9
        a = G(0, 1.18, 0.5).lerp(P(nk[1]) + G(0, -0.08, 0.02), t)
        F.blade(bt, a, a + G(((i % 3) - 1) * 0.04, -0.3 + 0.12 * t, -0.02), 0.07, [chest] + nk, 0x221c15 if i % 2 else BARK2, thick=0.01, side=G(1, 0, 0))
    # ---- the skull: bone-white, long and narrow, deep sockets, eyes of green fire
    Hd = P(head)
    F.loft(bt, [Hd + G(0, 0.04, -0.07), Hd + G(0, 0.04, 0.02), Hd + G(0, 0.01, 0.13), Hd + G(0, -0.04, 0.25), Hd + G(0, -0.08, 0.33)], [0.085, 0.1, 0.082, 0.056, 0.034], [0.09, 0.095, 0.072, 0.05, 0.032], [head], BONE, sides=8, surf='shell')
    F.loft(bt, [P(jaw) + G(0, -0.04, -0.02), P(jaw) + G(0, -0.06, 0.12), P(jaw) + G(0, -0.075, 0.19)], [0.05, 0.035, 0.022], [0.025, 0.02, 0.015], [jaw], BONE, sides=6, surf='shell')
    for sd in (-1, 1):
        F.gem(bt, Hd + G(sd * 0.06, 0.04, 0.06), 0.034, [head], 0x0a0806, surf='shell', glow=False, stretch=0.8)
        F.gem(bt, Hd + G(sd * 0.072, 0.04, 0.07), 0.016, [head], GREEN)
        F.gem(bt, Hd + G(sd * 0.018, -0.05, 0.27), 0.012, [head], 0x0a0806, surf='shell', glow=False)
        # Ears: long leaves, laid back.
        F.blade(bt, P(n['ears'][0 if sd < 0 else 1]), P(n['ears'][0 if sd < 0 else 1]) + G(sd * 0.14, 0.04, -0.06), 0.06, [n['ears'][0 if sd < 0 else 1]], BARK2, thick=0.012, side=G(0, 1, 0))
        # ---- antlers: a great beam sweeping back and out, tines forward and up, moss trailing, the tips alight
        beam = [Hd + G(sd * 0.05, 0.08, 0.0), Hd + G(sd * 0.13, 0.18, -0.04), Hd + G(sd * 0.24, 0.36, -0.1), Hd + G(sd * 0.31, 0.56, -0.18), Hd + G(sd * 0.35, 0.78, -0.24), Hd + G(sd * 0.31, 0.98, -0.28)]
        F.chain(bt, beam, [0.034, 0.03, 0.025, 0.02, 0.014, 0.006], [head], BONE, sides=6, surf='shell')
        tines = [(1, (sd * 0.04, 0.16, 0.16)), (2, (sd * 0.1, 0.2, 0.12)), (2, (-sd * 0.02, 0.22, 0.1)), (3, (sd * 0.14, 0.18, 0.04)), (3, (-sd * 0.04, 0.24, 0.08)), (4, (sd * 0.12, 0.16, -0.02)), (4, (-sd * 0.05, 0.2, 0.05))]
        for k, (bi, (dx, dy, dz)) in enumerate(tines):
            b0 = beam[bi].lerp(beam[bi + 1], 0.35 if k % 2 else 0.7)
            b1 = b0 + G(dx * 0.6, dy * 0.6, dz * 0.6)
            b2 = b0 + G(dx, dy, dz)
            F.chain(bt, [b0, b1, b2], [0.016, 0.011, 0.003], [head], BONE, sides=5, surf='shell')
            F.gem(bt, b2, 0.012, [head], GREEN, surf='glow', stretch=1.8)
        for k in range(5):
            b0 = beam[1 + k % 4].lerp(beam[2 + k % 4], 0.5)
            L = 0.16 + 0.08 * (k % 3)
            F.ribbon(bt, [b0, b0 + G(0, -L * 0.5, 0.01), b0 + G(sd * 0.01, -L, 0.02)], [0.03, 0.025, 0.01], G(1, 0, 0), [head], MOSS)
    # ---- legs: long and jointed, a tuft at each fetlock, cloven hooves
    for limb in n['limbs']:
        up, mid, low, side, front = limb['up'], limb['mid'], limb['low'], limb['side'], limb['front']
        U, M, L = P(up), P(mid), P(low)
        Ft = G(*limb['foot'])
        top = 0.11 if front else 0.135
        F.prism(bt, U + G(0, 0.06, 0), M, top, 0.06, [up, mid], BARK, sides=8, surf='fur')
        F.prism(bt, M, L, 0.056, 0.04, [mid, low], BARK, sides=7, surf='fur')
        F.prism(bt, L, Ft + G(0, 0.06, 0), 0.04, 0.034, [low], BARK2, sides=6, surf='fur')
        F.gem(bt, M, 0.05, [mid], BARK2, surf='fur', glow=False, stretch=1.1)
        for k in range(4):
            a = (k / 4) * math.tau
            F.blade(bt, Ft + G(math.sin(a) * 0.03, 0.14, math.cos(a) * 0.03), Ft + G(math.sin(a) * 0.045, 0.05, math.cos(a) * 0.045), 0.035, [low], 0x221c15, thick=0.008)
        for sd in (-1, 1):
            F.plate(bt, Ft + G(sd * 0.016, 0.025, 0.015), (0.03, 0.06, 0.07), [low], HOOF, bevel=0.35, taper=0.8, surf='shell')
    # ---- a short tail, a flick of dark fur
    tl = n['tail']
    F.blade(bt, P(tl[0]), P(tl[1]) + G(0, -0.12, -0.06), 0.09, tl, 0x221c15, thick=0.015, side=G(1, 0, 0))
    bt.ao_floor = 0.55
    return bt.build(0.01, 3000, surface='fur'), CREATURE_SURFACES




# forged:crab
@builder('crab', 0x3e5f66)
def crab(bt):
    """Thalassor, the Tide Tyrant: a serrated dome of a shell crusted with barnacles and weed, one crushing claw far bigger than the other."""
    n, B = bt.n, bt.B
    body, jaw = n['body'], n['jaw']
    P = lambda i: Vector(B[i])
    SHELL, SHELL2, RIM, UNDER, SPIKE, BARN, WEED, EYE = 0x30525a, 0x264450, 0x6a8a84, 0x9aa894, 0x1c2a2c, 0xb0b6a6, 0x3a6a3a, 0x60f0ff
    # ---- the carapace: a faceted dome with a serrated rim, ridge plates down the middle
    rim = lambda a, i: 1 + 0.045 * math.cos(a * 9) if i <= 1 else 1
    F.hull(bt, [(G(0, 0.86, -0.02), 1.12, 0.9), (G(0, 1.12, 0.0), 1.34, 1.06), (G(0, 1.42, -0.04), 1.18, 0.92), (G(0, 1.62, -0.08), 0.82, 0.62), (G(0, 1.74, -0.1), 0.36, 0.28)], [body], SHELL, sides=18, wave=rim)
    F.hull(bt, [(G(0, 0.7, -0.02), 0.85, 0.66), (G(0, 0.88, -0.02), 1.1, 0.88)], [body], UNDER, sides=18)
    for k in range(4):
        z = 0.42 - k * 0.32
        F.plate(bt, G(0, 1.72 - abs(z + 0.1) * 0.22, z), (0.5 - 0.06 * abs(k - 1.5), 0.08, 0.3), [body], SHELL2, rot=(-z * 0.4, 0, 0), bevel=0.4, taper=0.8)
    for sd in (-1, 1):
        for k in range(3):
            a = 0.5 + k * 0.5
            F.plate(bt, G(sd * math.sin(a) * 0.95, 1.5, math.cos(a) * 0.72 - 0.05), (0.32, 0.07, 0.26), [body], SHELL2, rot=(0, sd * a, sd * 0.45), bevel=0.4, taper=0.8)
    # Spikes round the rim, longest at the front corners.
    for i in range(15):
        a = -1.45 + (i / 14) * 2.9
        d = G(math.sin(a), 0.12, math.cos(a)).normalized()
        b = G(math.sin(a) * 1.38, 1.12, math.cos(a) * 1.1)
        L = 0.22 + 0.12 * abs(math.sin(a * 1.4))
        F.spike(bt, b - d * 0.05, b + d * L, 0.07, [body], SPIKE)
    # Barnacles crusting the dome, weed hanging off the back.
    for i in range(22):
        a = i * 2.39996
        r = 0.18 + 0.75 * math.sqrt((i + 0.5) / 22)
        x, z = math.cos(a) * r * 1.1, math.sin(a) * r * 0.8 - 0.1
        y = 1.78 - (x * x / 1.4 + (z + 0.1) ** 2 / 0.9) * 0.6
        w = 0.06 + (i % 3) * 0.02
        F.prism(bt, G(x, y - 0.03, z), G(x, y + 0.09, z), w, w * 0.6, [body], BARN, sides=6)
        F.gem(bt, G(x, y + 0.09, z), w * 0.42, [body], 0x2a2c28, surf='1', glow=False, stretch=0.4)
    for st in n['strands']:
        F.ribbon(bt, [P(b) for b in st] + [P(st[-1]) + (P(st[-1]) - P(st[-2])) * 0.8], 0.09, G(1, 0, 0), st, WEED)
    # ---- the face: stalked eyes, mandibles
    for k, st in enumerate(n['stalks']):
        sd = -1 if k == 0 else 1
        F.prism(bt, G(sd * 0.22, 1.2, 0.78), P(st), 0.06, 0.045, [body, st], SHELL2, sides=6)
        F.gem(bt, P(st) + G(0, 0.06, 0.02), 0.075, [st], EYE, stretch=1.1)
        F.dome(bt, P(st) + G(0, 0.06, 0), 0.085, [st], SHELL2, axis=(0, 0.3, -1), theta=1.2, thick=0.012)
    J = P(jaw)
    for sd in (-1, 1):
        F.plate(bt, J + G(sd * 0.1, -0.02, 0.08), (0.14, 0.18, 0.06), [jaw], SHELL2, rot=(0.2, sd * 0.3, 0), bevel=0.4, taper=0.6)
        F.spike(bt, J + G(sd * 0.08, -0.1, 0.1), J + G(sd * 0.02, -0.22, 0.18), 0.03, [jaw], SPIKE)
    # ---- claws: the left a cutter, the right a great crusher
    for pc in n['pincers']:
        arm, fore, hand, finger, sd = pc['arm'], pc['fore'], pc['hand'], pc['finger'], pc['side']
        big = 1.25 if sd > 0 else 0.95
        A, Fo, H, Fi = P(arm), P(fore), P(hand), P(finger)
        F.prism(bt, A, Fo, 0.17 * big, 0.14 * big, [arm, fore], SHELL, sides=7)
        F.prism(bt, Fo, H, 0.16 * big, 0.17 * big, [fore, hand], SHELL, sides=7)
        for t in (0.3, 0.6):
            b = Fo.lerp(H, t)
            F.spike(bt, b + G(0, 0.12 * big, 0), b + G(0, 0.3 * big, -0.05), 0.04 * big, [fore], SPIKE)
        # The palm: a swollen hull from the wrist, the fixed finger beyond it, the hinged finger above.
        d = (Fi - H).normalized()
        palm_end = H + d * 0.55 * big
        F.loft(bt, [H, H.lerp(palm_end, 0.5), palm_end], [0.2 * big, 0.26 * big, 0.2 * big], [0.17 * big, 0.22 * big, 0.16 * big], [hand], SHELL, sides=9, surf='1')
        tip = palm_end + d * 0.55 * big + G(0, -0.08, 0)
        F.loft(bt, [palm_end + G(0, -0.06 * big, 0), palm_end.lerp(tip, 0.5) + G(0, -0.08 * big, 0), tip], [0.11 * big, 0.08 * big, 0.015], [0.09 * big, 0.06 * big, 0.012], [hand], RIM, sides=6, surf='1')
        top = palm_end + G(0, 0.12 * big, 0)
        ftip = top + d * 0.6 * big + G(0, -0.06, 0)
        F.loft(bt, [top, top.lerp(ftip, 0.5) + G(0, 0.05 * big, 0), ftip], [0.1 * big, 0.08 * big, 0.015], [0.09 * big, 0.06 * big, 0.012], [finger], RIM, sides=6, surf='1')
        for t in (0.25, 0.5, 0.75):
            q = palm_end.lerp(tip, t) + G(0, -0.02, 0)
            F.spike(bt, q, q + G(0, 0.07 * big, 0), 0.025 * big, [hand], 0xd8d0b8)
    # ---- legs: jointed, spiked at the knee, ending in a point
    for limb in n['limbs']:
        up, mid, low = limb['up'], limb['mid'], limb['low']
        U, M, L = P(up), P(mid), P(low)
        Ft = G(*limb['foot'])
        F.prism(bt, U, M, 0.1, 0.085, [up, mid], SHELL, sides=6)
        F.prism(bt, M, L, 0.085, 0.06, [mid, low], SHELL2, sides=6)
        F.prism(bt, L, Ft, 0.06, 0.008, [low], SHELL, sides=6)
        F.gem(bt, M, 0.1, [mid], SHELL2, surf='1', glow=False)
        F.spike(bt, M + G(0, 0.06, 0), M + G(0, 0.24, -0.04), 0.035, [mid], SPIKE)
    bt.ao_floor = 0.55
    return bt.build(0.01, 3000, surface='fur'), CREATURE_SURFACES
# end:crab


# forged:h-6ad1895d
def stone_giant(bt, p, rock, rock2, glow, seed, bulk=1.0, lava=False):
    """A forged stone giant: a blocky chest and pelvis, a small heavy head between boulder shoulders, chunky limbs, huge fists. Light (crystal or lava) shows in its seams."""
    import random
    r = random.Random(seed)
    C, Hp, Sp, Hd = p.C, p.Hp, p.Sp, p.Hd
    ch, hip, sp, hd = p.chest, p.hips, p.spine, p.head
    k = bulk
    jit = lambda c: c if r.random() < 0.5 else rock2
    # Chest: a faceted barrel, a slab over each pectoral; belly blocks; a heavy pelvis.
    F.hull(bt, [(gv(C, 0, -0.16, 0), 0.2 * k, 0.15 * k), (gv(C, 0, 0.0, 0.01), 0.27 * k, 0.19 * k), (gv(C, 0, 0.14, 0.0), 0.29 * k, 0.19 * k), (gv(C, 0, 0.24, -0.02), 0.2 * k, 0.15 * k), (gv(C, 0, 0.29, -0.03), 0.1 * k, 0.09 * k)], [ch], rock, sides=7, surf='0')
    for sd in (-1, 1):
        F.plate(bt, gv(C, sd * 0.12 * k, 0.1, 0.17 * k), (0.2 * k, 0.17, 0.08), [ch], rock2, rot=(0.1, sd * 0.25, sd * 0.06), bevel=0.35, surf='0')
    for i in range(3):
        F.plate(bt, gv(Sp, (i - 1) * 0.11 * k, 0.03 + 0.03 * (i % 2), 0.12 * k), (0.12 * k, 0.13, 0.1), [sp], jit(rock), rot=(0.05, (i - 1) * 0.3, 0.05 * (i - 1)), bevel=0.35, surf='0')
    F.hull(bt, [(gv(Sp, 0, 0.06, 0), 0.19 * k, 0.14 * k), (gv(Hp, 0, 0.0, 0), 0.22 * k, 0.15 * k), (gv(Hp, 0, -0.1, 0), 0.18 * k, 0.13 * k)], [sp, hip], rock2, sides=7, surf='0')
    # Back slabs.
    for i in range(4):
        F.plate(bt, gv(C, (r.random() - 0.5) * 0.2 * k, 0.2 - i * 0.12, -0.17 * k), (0.2 * k, 0.14, 0.1), [ch] if i < 3 else [sp], jit(rock), rot=(-0.15, (r.random() - 0.5) * 0.5, (r.random() - 0.5) * 0.3), bevel=0.35, surf='0')
    # The head: a small heavy block, sunk forward, a brow ridge over burning eyes.
    F.plate(bt, gv(Hd, 0, 0.1, 0.04), (0.2, 0.2, 0.22), [hd], rock2, bevel=0.3, taper=0.85, surf='0')
    F.plate(bt, gv(Hd, 0, 0.17, 0.12), (0.22, 0.05, 0.08), [hd], rock, rot=(0.25, 0, 0), bevel=0.3, surf='0')
    F.plate(bt, gv(Hd, 0, 0.0, 0.1), (0.15, 0.08, 0.12), [hd], rock, bevel=0.3, surf='0')
    for sd in (-1, 1):
        F.plate(bt, gv(Hd, sd * 0.05, 0.12, 0.155), (0.06, 0.02, 0.02), [hd], glow, surf='2', glow=True, bevel=0)
    F.plate(bt, gv(Hd, 0, 0.04, 0.165), (0.07, 0.015, 0.02), [hd], glow, surf='2', glow=True, bevel=0)
    for sd, j in p.sides:
        A, Fo, W = p.P(j['arm']), p.P(j['fore']), p.P(j['hand'])
        arm, fore, hand = j['arm'], j['fore'], j['hand']
        L, S, Ft = p.P(j['leg']), p.P(j['shin']), p.P(j['foot'])
        leg, shin, foot = j['leg'], j['shin'], j['foot']
        # Shoulders: two great boulders.
        F.plate(bt, gv(A, sd * 0.06, 0.08, 0), (0.3 * k, 0.24, 0.3 * k), [arm, ch], rock, rot=(0.1, 0.3, sd * 0.35), bevel=0.4, taper=0.8, surf='0')
        F.plate(bt, gv(A, sd * 0.12, -0.02, 0.02), (0.22 * k, 0.2, 0.24 * k), [arm], rock2, rot=(-0.2, -0.4, sd * 0.6), bevel=0.4, surf='0')
        # Arms: a thick upper arm in plates, a flaring forearm, a fist of blocks.
        F.prism(bt, gv(A, 0, -0.05, 0), Fo, 0.11 * k, 0.1 * k, [arm, fore], rock2, sides=6, surf='0')
        F.plate(bt, A.lerp(Fo, 0.55) + G(sd * 0.06, 0, 0), (0.12, 0.18, 0.16 * k), [arm], rock, rot=(0, 0, sd * 0.12), bevel=0.35, surf='0')
        F.prism(bt, Fo, W.lerp(Fo, 0.15), 0.11 * k, 0.14 * k, [fore], rock, sides=6, surf='0')
        F.plate(bt, Fo.lerp(W, 0.5) + G(sd * 0.08 * k, 0, 0), (0.1, 0.2, 0.18 * k), [fore], rock2, rot=(0, 0, sd * 0.1), bevel=0.35, surf='0')
        F.plate(bt, gv(W, 0, -0.07, 0.03), (0.2 * k, 0.2, 0.2 * k), [hand], rock2, bevel=0.3, surf='0')
        for f in range(3):
            F.plate(bt, gv(W, (f - 1) * 0.065 * k, -0.15, 0.08), (0.06 * k, 0.07, 0.08), [hand], rock, bevel=0.35, surf='0')
        # Legs: thick columns of stone, a knee slab, a block foot.
        F.prism(bt, gv(L, 0, 0.04, 0), S, 0.13 * k, 0.11 * k, [hip, leg], rock2, sides=6, surf='0')
        F.plate(bt, L.lerp(S, 0.5) + G(sd * 0.03, 0, 0.06), (0.18 * k, 0.24, 0.12), [leg], rock, rot=(0.08, 0, 0), bevel=0.35, surf='0')
        F.plate(bt, gv(S, 0, 0.02, 0.07), (0.16 * k, 0.14, 0.1), [leg, shin], rock2, rot=(0.2, 0, 0), bevel=0.35, surf='0')
        F.prism(bt, S, gv(Ft, 0, 0.06, 0), 0.11 * k, 0.12 * k, [shin], rock, sides=6, surf='0')
        F.plate(bt, gv(Ft, 0, -0.02, 0.06), (0.2 * k, 0.12, 0.3), [foot], rock2, bevel=0.3, taper=0.85, surf='0')
        # Light in the cracks of the limbs.
        for a, b, bones in ((A.lerp(Fo, 0.2), A.lerp(Fo, 0.75), [arm]), (Fo.lerp(W, 0.15), Fo.lerp(W, 0.7), [fore]), (L.lerp(S, 0.15), L.lerp(S, 0.75), [leg]), (S.lerp(Ft, 0.1), S.lerp(Ft, 0.6), [shin])):
            off = G(sd * 0.115 * k, 0, 0.05 * k)
            F.blade(bt, a + off, b + off + G(0, 0, 0.02), 0.025, bones, glow, thick=0.006, surf='2', glow=True, side=G(0, 0, 1))
            off = G(-sd * 0.02, 0, 0.12 * k)
            F.blade(bt, a.lerp(b, 0.3) + off, b + off, 0.02, bones, glow, thick=0.006, surf='2', glow=True, side=G(1, 0, 0))
    # Cracks of light over the chest and back.
    for x, y, rz in ((0.1, 0.05, 0.6), (-0.12, 0.1, -0.5), (0.02, -0.08, 0.2), (0.16, 0.18, -0.9), (-0.07, 0.2, 0.9)):
        q = gv(C, x * k, y, 0.205 * k)
        F.blade(bt, q, q + G(math.sin(rz) * 0.14, math.cos(rz) * 0.14, 0), 0.022, [ch], glow, thick=0.006, surf='2', glow=True, side=G(0, 0, 1))
        q = gv(C, -x * k, y, -0.2 * k)
        F.blade(bt, q, q + G(math.sin(rz) * 0.14, math.cos(rz) * 0.14, 0), 0.022, [ch], glow, thick=0.006, surf='2', glow=True, side=G(0, 0, 1))


@builder('h-6ad1895d', 0x9a8a6a)
def colossus(bt):
    """Zephyron, the Storm Colossus: a sandstone giant shot through with storm-blue crystal, a crystal crown, a storm in its chest."""
    p = Body(bt)
    SAND, SAND2, CRYS = 0xa08e6a, 0x7c6c50, 0x58b4ff
    stone_giant(bt, p, SAND, SAND2, CRYS, seed=3, bulk=1.1)
    C, Hd = p.C, p.Hd
    # The storm core: a crystal heart in a ring of light.
    core = gv(C, 0, 0.06, 0.23)
    F.gem(bt, core, 0.08, [p.chest], 0x9ad8ff, stretch=1.3)
    F.ring(bt, core, 0.11, [p.chest], CRYS, width=0.02, thick=0.014, axis=(0, 0, 1), glow=True, surf='2')
    # A crown of crystal on the head, crystal spines out of shoulders, back and forearms.
    for k in range(7):
        a = (k - 3) * 0.42
        b = gv(Hd, math.sin(a) * 0.08, 0.2, math.cos(a) * 0.06 - 0.02)
        F.blade(bt, b, b + G(math.sin(a) * 0.06, 0.16 + 0.08 * (1 - abs(k - 3) / 3), math.cos(a) * 0.02 - 0.04), 0.05, [p.head], CRYS, thick=0.025, surf='2', glow=True)
    for sd, j in p.sides:
        A, Fo, W = p.P(j['arm']), p.P(j['fore']), p.P(j['hand'])
        for dx, dy, dz, L in ((0.12, 0.2, 0.0, 0.32), (0.2, 0.12, -0.08, 0.24), (0.06, 0.22, -0.1, 0.22)):
            b = gv(A, sd * dx, dy, dz)
            F.blade(bt, b, b + G(sd * L * 0.6, L, dz * 1.5), 0.08, [j['arm']], CRYS, thick=0.04, surf='2', glow=True)
        b = Fo.lerp(W, 0.4) + G(sd * 0.13, 0, -0.02)
        F.blade(bt, b, b + G(sd * 0.2, 0.08, -0.08), 0.06, [j['fore']], CRYS, thick=0.03, surf='2', glow=True)
    for k in range(5):
        b = gv(C, (k - 2) * 0.09, 0.18 - abs(k - 2) * 0.05, -0.22)
        F.blade(bt, b, b + G((k - 2) * 0.06, 0.3 - abs(k - 2) * 0.05, -0.18), 0.08, [p.chest], CRYS, thick=0.035, surf='2', glow=True)
    bt.ao_floor = 0.6
    return bt.build(0.01, 3000, surface='0'), ['0', '1', '2']
# end:h-6ad1895d


# forged:h-8277b566
@builder('h-8277b566', 0x2a1c18)
def golem(bt):
    """Ignaroth, the Molten Forge: black basalt with molten seams, slag spikes on the back, a furnace burning in the chest."""
    p = Body(bt)
    BAS, BAS2, LAVA = 0x2e2420, 0x463630, 0xff6a20
    stone_giant(bt, p, BAS2, BAS, LAVA, seed=9, bulk=1.2, lava=True)
    C, Hd = p.C, p.Hd
    core = gv(C, 0, 0.04, 0.25)
    F.gem(bt, core, 0.09, [p.chest], 0xffc060, stretch=1.1)
    F.ring(bt, core, 0.12, [p.chest], LAVA, width=0.03, thick=0.016, axis=(0, 0, 1), glow=True, surf='2')
    for k in range(8):
        a = k / 8 * math.tau
        F.blade(bt, core + G(math.sin(a) * 0.13, math.cos(a) * 0.13, -0.01), core + G(math.sin(a) * 0.25, math.cos(a) * 0.23, -0.04), 0.02, [p.chest], LAVA, thick=0.005, surf='2', glow=True, side=G(0, 0, 1))
    # Slag spikes down the back and on the shoulders, glowing at the root.
    for k in range(6):
        b = gv(C, ((k % 2) - 0.5) * 0.18, 0.24 - k * 0.09, -0.24)
        F.spike(bt, b, b + G(((k % 2) - 0.5) * 0.1, 0.12, -0.26 + 0.02 * k), 0.06, [p.chest] if k < 4 else [p.spine], 0x1a1412, surf='0')
        F.gem(bt, b, 0.04, [p.chest] if k < 4 else [p.spine], LAVA)
    for sd, j in p.sides:
        A = p.P(j['arm'])
        for dz in (-0.1, 0.05):
            b = gv(A, sd * 0.12, 0.2, dz)
            F.spike(bt, b, b + G(sd * 0.12, 0.26, dz), 0.05, [j['arm']], 0x1a1412, surf='0')
    # A molten mouth under the brow.
    F.plate(bt, gv(Hd, 0, 0.03, 0.17), (0.11, 0.025, 0.02), [p.head], 0xffa040, surf='2', glow=True, bevel=0)
    bt.ao_floor = 0.55
    return bt.build(0.01, 3000, surface='0'), ['0', '1', '2']
# end:h-8277b566




# forged:h-416c43fb
@builder('h-416c43fb', 0x6a2018)
def champion(bt):
    """Aresios, Champion of Mars: ornate bronze with gold trim over red cloth, a closed crested helm, a golden sun on the breastplate."""
    p = Body(bt)
    C, Hp, Sp, Hd = p.C, p.Hp, p.Sp, p.Hd
    ch, hip, sp, hd = p.chest, p.hips, p.spine, p.head
    BR, BR2, GOLD, RED, RED2, LEATHER, SKIN, SLIT = 0x9a6430, 0x7a4c22, 0xe0b860, 0x8a1c14, 0x6a140e, 0x4a2c16, 0xb08a6a, 0x07060a
    # ---- cuirass: a keeled, muscled breastplate, gold at the edges; belly bands
    keel = lambda a, i: 1 + 0.06 * max(0.0, math.cos(a)) ** 6 if 1 <= i <= 3 else 1
    F.hull(bt, [(gv(C, 0, -0.17, 0.0), 0.16, 0.115), (gv(C, 0, -0.07, 0.012), 0.185, 0.13), (gv(C, 0, 0.04, 0.018), 0.205, 0.14), (gv(C, 0, 0.14, 0.01), 0.21, 0.135), (gv(C, 0, 0.22, -0.006), 0.165, 0.115), (gv(C, 0, 0.26, -0.01), 0.09, 0.08)], [ch], BR, sides=14, wave=keel)
    F.ring(bt, gv(C, 0, 0.215, -0.006), 0.158, [ch], GOLD, width=0.016, thick=0.01, segs=18)
    F.ring(bt, gv(C, 0, -0.17, 0.0), 0.165, [ch, sp], GOLD, width=0.018, thick=0.01, segs=18)
    for k in range(3):
        y = 0.06 - k * 0.065
        F.hull(bt, [(gv(Sp, 0, y + 0.032, 0.008), 0.15 + 0.005 * k, 0.11), (gv(Sp, 0, y - 0.028, 0.01), 0.156 + 0.005 * k, 0.114)], [sp, hip] if k == 2 else [sp], BR2 if k % 2 else BR, sides=14)
    # The golden sun.
    sun = gv(C, 0, 0.05, 0.165)
    F.gem(bt, sun, 0.05, [ch], GOLD, surf='1', glow=False, stretch=0.4)
    F.ring(bt, sun, 0.055, [ch], GOLD, width=0.012, thick=0.014, axis=(0, 0, 1))
    for k in range(10):
        a = k / 10 * math.tau
        F.blade(bt, sun + G(math.sin(a) * 0.06, math.cos(a) * 0.06, 0), sun + G(math.sin(a) * 0.12, math.cos(a) * 0.12, -0.01), 0.03, [ch], GOLD, thick=0.008, surf='1', side=G(0, 0, 1))
    # ---- shoulders: layered bronze, gilt spikes; red cloth sleeves; bronze bracers; gloves
    for sd, j in p.sides:
        A, Fo, W = p.P(j['arm']), p.P(j['fore']), p.P(j['hand'])
        arm, fore, hand = j['arm'], j['fore'], j['hand']
        for k in range(3):
            F.dome(bt, gv(A, sd * (0.015 + 0.01 * k), 0.04 - 0.055 * k, 0), 0.14 - 0.018 * k, [arm, ch] if k == 0 else [arm], BR if k % 2 == 0 else BR2, axis=(sd * 0.5, 1, 0), theta=1.2, thick=0.012, squash=(1.05, 0.85, 1.1))
        F.ring(bt, gv(A, sd * 0.015, 0.04, 0), 0.135, [arm, ch], GOLD, width=0.012, thick=0.008, axis=(sd * 0.5, 1, 0), arc=(0.5, math.tau - 0.5))
        for v in (-0.06, 0.06):
            b = gv(A, sd * 0.06, 0.15, v)
            F.spike(bt, b, b + G(sd * 0.09, 0.15, v * 0.8), 0.022, [arm], GOLD)
        F.prism(bt, gv(A, 0, -0.04, 0), Fo, 0.06, 0.05, [arm, fore], RED, sides=8, surf='0')
        F.prism(bt, Fo, W.lerp(Fo, 0.1), 0.045, 0.038, [fore, hand], SKIN, sides=8, surf='0')
        F.hull(bt, [(Fo.lerp(W, 0.3), 0.05, 0.05), (Fo.lerp(W, 0.85), 0.058, 0.058)], [fore], BR, sides=8)
        F.ring(bt, Fo.lerp(W, 0.85), 0.06, [fore], GOLD, width=0.012, thick=0.006, segs=12)
        F.plate(bt, gv(W, 0, -0.05, 0.02), (0.07, 0.09, 0.05), [hand], LEATHER, bevel=0.3, surf='0')
        for f in range(4):
            k0 = gv(W, (f - 1.5) * 0.016, -0.09, 0.035)
            F.prism(bt, k0, k0 + G(0, -0.06, 0.03), 0.01, 0.008, [hand], LEATHER, sides=5, surf='0')
    # ---- hips: a red tunic skirt under studded leather strips; greaves over red-wrapped legs; sandal-boots
    F.hull(bt, [(gv(Hp, 0, 0.05, 0), 0.17, 0.125), (gv(Hp, 0, -0.08, 0), 0.2, 0.15), (gv(Hp, 0, -0.27, 0), 0.24, 0.18)], [hip], RED, sides=16, surf='0')
    F.ring(bt, gv(Hp, 0, 0.06, 0), 0.165, [hip, sp], GOLD, width=0.03, thick=0.012, segs=18)
    for k in range(14):
        a = (k + 0.5) / 14 * math.tau
        b = gv(Hp, math.sin(a) * 0.185, 0.02, math.cos(a) * 0.14)
        d = G(math.sin(a), 0, math.cos(a))
        F.ribbon(bt, [b, b + d * 0.025 + G(0, -0.13, 0), b + d * 0.045 + G(0, -0.24, 0)], 0.045, G(math.cos(a), 0, -math.sin(a)), [hip], LEATHER if k % 2 else RED2, thick=0.006)
        F.gem(bt, b + d * 0.05 + G(0, -0.22, 0), 0.01, [hip], GOLD, surf='1', glow=False)
    for sd, j in p.sides:
        L, S, Ft = p.P(j['leg']), p.P(j['shin']), p.P(j['foot'])
        leg, shin, foot = j['leg'], j['shin'], j['foot']
        F.prism(bt, gv(L, 0, 0.02, 0), S, 0.08, 0.06, [hip, leg], RED2, sides=8, surf='0')
        F.dome(bt, gv(S, 0, 0.0, 0.03), 0.055, [leg, shin], GOLD, axis=(0, 0.2, 1), theta=1.2, thick=0.01)
        ridge = lambda a, i: 1 + 0.15 * max(0.0, math.cos(a)) ** 10
        F.hull(bt, [(gv(S, 0, -0.03, 0), 0.062, 0.066), (S.lerp(Ft, 0.55), 0.055, 0.06), (gv(Ft, 0, 0.05, 0), 0.05, 0.054)], [shin], BR, sides=10, wave=ridge)
        F.plate(bt, gv(Ft, 0, -0.02, 0.045), (0.1, 0.11, 0.21), [foot], LEATHER, bevel=0.35, taper=0.8, surf='0')
    # ---- the helm: a closed Corinthian helm with a T of darkness, cheek flares, a towering red crest
    F.hull(bt, [(gv(Hd, 0, 0.0, 0.01), 0.105, 0.12), (gv(Hd, 0, 0.1, 0.015), 0.125, 0.14), (gv(Hd, 0, 0.2, 0.0), 0.13, 0.14), (gv(Hd, 0, 0.28, -0.01), 0.1, 0.11), (gv(Hd, 0, 0.32, -0.015), 0.04, 0.045)], [hd], BR, sides=14, wave=lambda a, i: 1 + 0.06 * max(0.0, math.cos(a)) ** 8 if i in (1, 2) else 1)
    F.plate(bt, gv(Hd, 0, 0.16, 0.135), (0.15, 0.024, 0.02), [hd], SLIT, bevel=0, surf='0')
    F.plate(bt, gv(Hd, 0, 0.09, 0.14), (0.026, 0.11, 0.02), [hd], SLIT, bevel=0, surf='0')
    F.plate(bt, gv(Hd, 0, 0.2, 0.135), (0.018, 0.07, 0.02), [hd], GOLD, bevel=0.3, rot=(-0.2, 0, 0))
    F.ring(bt, gv(Hd, 0, 0.0, 0.01), 0.11, [hd], GOLD, width=0.015, thick=0.008, segs=14)
    for k in range(17):
        t = k / 16
        a = math.pi * (0.08 + 0.86 * t)
        root = gv(Hd, 0, 0.2, 0) + G(0, math.sin(a) * 0.13, math.cos(a) * 0.13)
        tip = root + G(0, 0.09 + 0.07 * math.sin(a), math.cos(a) * 0.08 - (0.1 if t > 0.8 else 0))
        F.blade(bt, root, tip, 0.06, [hd], RED if k % 3 else 0xb02a1c, thick=0.03, surf='0', side=G(0, 0, 1))
    # ---- the cape
    cape = [p.n['cape']]
    while bt.child(cape[-1]) is not None:
        cape.append(bt.child(cape[-1]))
    cp = [p.B[k] for k in cape]
    for i in range(5):
        x = (i - 2) * 0.1
        pts = [c + G(x * (1 + 0.3 * t), 0, -0.01 * abs(i - 2)) for t, c in enumerate(cp)]
        tip = pts[-1] + (pts[-1] - pts[-2]) * 0.5
        F.ribbon(bt, pts + [tip], [0.11] * len(pts) + [0.09], G(1, 0, 0), cape, RED2 if i % 2 else RED)
    for sd in (-1, 1):
        F.gem(bt, gv(C, sd * 0.1, 0.22, 0.09), 0.022, [ch], GOLD, surf='1', glow=False)
    bt.ao_floor = 0.6
    return bt.build(0.01, 3000, surface='0'), ['0', '1', '2']
# end:h-416c43fb


def rag(bt, st, P, centre, width, rgb, reach=0.6, thick=0.01):
    """A torn strip of cloth down a strand: it curves with the hem around `centre` and narrows to a ragged point."""
    pts = [P(b) for b in st]
    pts = pts + [pts[-1] + (pts[-1] - pts[-2]) * reach]
    out = pts[0] - Vector(centre)
    out.z = 0
    side = Vector((-out.y, out.x, 0)).normalized() if out.length > 1e-4 else Vector((1, 0, 0))
    n = len(pts)
    F.ribbon(bt, pts, [width * (1 - 0.8 * i / (n - 1)) for i in range(n)], side, st, rgb, thick=thick)


# forged:witch
@builder('witch', 0x2a2440)
def witch(bt):
    """The Shade of Hecate: three masked faces under a crown of moons, a fan collar, a scalloped gown torn to tatters, crescent staff and violet torch."""
    n, B = bt.n, bt.B
    body, chest, head = n['body'], n['chest'], n['head']
    P = lambda i: Vector(B[i])
    C, Hd = P(chest), P(head)
    GOWN, GOWN2, TATTER, GOLD, MASK, CRONE, VIOLET, SKIN = 0x2c2440, 0x3a3054, 0x18121f, 0xd8b060, 0xe6e0d4, 0x8a8478, 0xb080ff, 0xb8b0c0
    # ---- the gown: a flared bell, scalloped at the hem; a fitted bodice; a gold girdle
    scal = lambda a, i: 1 + 0.06 * math.cos(a * 8) if i >= 3 else 1
    F.hull(bt, [(gv(C, 0, -0.12, 0), 0.15, 0.13), (gv(C, 0, -0.32, 0), 0.2, 0.17), (gv(C, 0, -0.56, 0), 0.3, 0.26), (gv(C, 0, -0.76, 0), 0.4, 0.35), (gv(C, 0, -0.92, 0), 0.44, 0.39)], [chest, body], GOWN, sides=16, surf='fur', wave=scal)
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        F.hull(bt, [(gv(C, 0, -0.3, 0), 0.205, 0.175), (gv(C, 0, -0.9, 0), 0.45, 0.4)], [chest, body], GOWN2, sides=16, surf='fur', arc=(a - 0.3, a + 0.3))
    F.hull(bt, [(gv(C, 0, -0.14, 0), 0.15, 0.13), (gv(C, 0, 0.05, 0.01), 0.17, 0.14), (gv(C, 0, 0.2, 0), 0.15, 0.12), (gv(C, 0, 0.28, -0.01), 0.08, 0.07)], [chest], GOWN2, sides=14, surf='fur')
    F.ring(bt, gv(C, 0, -0.14, 0), 0.155, [chest], GOLD, width=0.035, thick=0.012, segs=18, surf='shell')
    F.gem(bt, gv(C, 0, -0.14, 0.17), 0.03, [chest], VIOLET)
    for st in n['strands'][:12]:
        rag(bt, st, P, P(body), 0.15, TATTER, reach=0.4, thick=0.008)
    # A standing fan collar behind the head, gold-edged.
    for k in range(11):
        a = math.pi + (k - 5) * 0.26
        b = gv(C, math.sin(a) * 0.1, 0.24, math.cos(a) * 0.08)
        tip = b + G(math.sin(a) * 0.16, 0.3 - abs(k - 5) * 0.03, math.cos(a) * 0.12)
        F.blade(bt, b, tip, 0.08, [chest], GOWN2 if k % 2 else TATTER, thick=0.012, side=G(math.cos(a), 0, -math.sin(a)))
        F.spike(bt, tip - (tip - b) * 0.2, tip + (tip - b) * 0.08, 0.008, [chest], GOLD, surf='shell')
    # ---- the head: a veil, three masks (maiden ahead, mother and crone to the sides), slits of violet light
    F.hull(bt, [(gv(Hd, 0, -0.06, -0.01), 0.1, 0.1), (gv(Hd, 0, 0.05, -0.01), 0.125, 0.125), (gv(Hd, 0, 0.16, -0.02), 0.12, 0.12), (gv(Hd, 0, 0.22, -0.03), 0.06, 0.06)], [head], TATTER, sides=12, surf='fur')
    for ang, col in ((0.0, MASK), (math.pi / 2, MASK), (-math.pi / 2, CRONE)):
        f = G(math.sin(ang), 0, math.cos(ang))
        s_ = G(math.cos(ang), 0, -math.sin(ang))
        c = gv(Hd, 0, 0.06, 0) + f * 0.115
        F.plate(bt, c, (0.11, 0.15, 0.03), [head], col, rot=(0.0, ang, 0), bevel=0.35, taper=0.8, surf='shell')
        for sd in (-1, 1):
            F.plate(bt, c + s_ * (sd * 0.025) + G(0, 0.025, 0) + f * 0.018, (0.03, 0.009, 0.01), [head], VIOLET, rot=(0, ang, -sd * 0.25), surf='glow', glow=True, bevel=0)
        F.plate(bt, c + G(0, -0.04, 0) + f * 0.018, (0.035, 0.006, 0.01), [head], 0x1a1020, rot=(0, ang, 0), bevel=0, surf='fur')
    # The crown: a gold band, spikes, three crescent moons of light.
    F.ring(bt, gv(Hd, 0, 0.14, -0.01), 0.13, [head], GOLD, width=0.03, thick=0.012, segs=18, surf='shell')
    for k in range(9):
        a = k / 9 * math.tau
        b = gv(Hd, math.sin(a) * 0.13, 0.15, math.cos(a) * 0.13 - 0.01)
        F.spike(bt, b, b + G(math.sin(a) * 0.03, 0.09 + 0.04 * (k % 3 == 0), math.cos(a) * 0.03), 0.02, [head], GOLD, surf='shell')
    for ang in (0.0, 2.1, -2.1):
        c = gv(Hd, math.sin(ang) * 0.1, 0.3, math.cos(ang) * 0.1 - 0.01)
        pts = [c + G(math.cos(ang) * math.sin(t) * 0.09, math.cos(t) * 0.09, -math.sin(ang) * math.sin(t) * 0.09) for t in [-2.2, -1.5, -0.8, 0.0, 0.8, 1.5, 2.2]]
        F.chain(bt, pts, [0.004, 0.012, 0.018, 0.02, 0.018, 0.012, 0.004], [head], VIOLET, sides=5, surf='glow', glow=True)
    for st in n['strands'][12:]:
        pts = [P(b) for b in st]
        F.ribbon(bt, pts + [pts[-1] + (pts[-1] - pts[-2]) * 0.8], 0.05, G(1, 0, 0), st, 0x120c16, thick=0.01)
    # ---- arms: wide sleeves, pale clawed hands
    for arm in n['arms']:
        up, mid, low = arm['up'], arm['mid'], arm['low']
        U, M, L = P(up), P(mid), P(low)
        F.loft(bt, [U, M, L.lerp(M, 0.1)], [0.07, 0.08, 0.13], [0.07, 0.08, 0.13], [up, mid, low], GOWN2, sides=8, surf='fur')
        F.ring(bt, L.lerp(M, 0.1), 0.13, [low], GOLD, width=0.02, thick=0.008, axis=(0, 1, 0), segs=12, surf='shell')
        for f in range(4):
            k0 = L + G((f - 1.5) * 0.02, -0.03, 0.03)
            F.chain(bt, [k0, k0 + G((f - 1.5) * 0.01, -0.08, 0.03), k0 + G((f - 1.5) * 0.012, -0.15, 0.08)], [0.012, 0.009, 0.002], [low], SKIN, sides=5, surf='shell')
    # ---- the staff (right): a dark shaft, a gold crescent cradling a violet orb
    right, left = n['arms'][0], n['arms'][1]
    W, rl = P(right['low']), right['low']
    F.prism(bt, W + G(0, -1.1, 0.04), W + G(0, 1.05, -0.02), 0.03, 0.03, [rl], 0x221830, sides=7, surf='fur')
    for y in (-0.6, 0.0, 0.6):
        F.ring(bt, W + G(0, y, 0.02 - y * 0.03), 0.034, [rl], GOLD, width=0.03, thick=0.008, segs=10, surf='shell')
    top = W + G(0, 1.12, -0.02)
    arc = [top + G(math.sin(t) * 0.2, -math.cos(t) * 0.16 + 0.04, 0) for t in [-1.9, -1.3, -0.65, 0.0, 0.65, 1.3, 1.9]]
    F.chain(bt, arc, [0.006, 0.02, 0.028, 0.03, 0.028, 0.02, 0.006], [rl], GOLD, sides=6, surf='shell')
    F.gem(bt, top + G(0, 0.06, 0), 0.075, [rl], VIOLET, stretch=1.0)
    # ---- the torch (left): a wrapped haft and a tongue of violet flame
    Wl, ll = P(left['low']), left['low']
    F.prism(bt, Wl + G(0, -0.14, 0.04), Wl + G(0, 0.28, 0.06), 0.022, 0.032, [ll], 0x2a1c12, sides=6, surf='fur')
    F.ring(bt, Wl + G(0, 0.26, 0.06), 0.04, [ll], GOLD, width=0.04, thick=0.01, segs=10, surf='shell')
    for k in range(5):
        a = k / 5 * math.tau
        b = Wl + G(math.sin(a) * 0.025, 0.3, 0.06 + math.cos(a) * 0.025)
        F.blade(bt, b, b + G(math.sin(a) * 0.02, 0.2 + 0.06 * (k % 2), math.cos(a) * 0.02), 0.07, [ll], VIOLET if k % 2 else 0x6a40d0, thick=0.02, surf='glow', glow=True)
    bt.ao_floor = 0.6
    return bt.build(0.01, 3000, surface='fur'), CREATURE_SURFACES
# end:witch


# forged:reaper
@builder('reaper', 0x15131a)
def reaper(bt):
    """The Reaper: a towering hooded void with cold green eyes, a ragged robe, a mantle of ribs, bony hands, a great scythe and a soul lantern."""
    n, B = bt.n, bt.B
    body, chest, head = n['body'], n['chest'], n['head']
    P = lambda i: Vector(B[i])
    C, Hd = P(chest), P(head)
    ROBE, ROBE2, RAG, BONE, VOID, SOUL, IRON, WOOD = 0x17151c, 0x221e28, 0x0e0c12, 0xd0c6aa, 0x020203, 0x70ffb0, 0x3a3a40, 0x241a14
    # ---- the robe: a long bell to the ground, torn into rags below
    F.hull(bt, [(gv(C, 0, 0.1, 0), 0.22, 0.18), (gv(C, 0, -0.3, 0), 0.27, 0.22), (gv(C, 0, -0.8, 0), 0.38, 0.32), (gv(C, 0, -1.2, 0), 0.48, 0.42), (gv(C, 0, -1.45, 0), 0.52, 0.46)], [chest, body], ROBE, sides=14, surf='fur', wave=lambda a, i: 1 + 0.07 * math.cos(a * 7) if i >= 3 else 1)
    for k in range(6):
        a = k / 6 * math.tau
        F.hull(bt, [(gv(C, 0, -0.2, 0), 0.26, 0.215), (gv(C, 0, -1.43, 0), 0.53, 0.47)], [chest, body], ROBE2, sides=14, surf='fur', arc=(a - 0.18, a + 0.18))
    for st in n['strands']:
        rag(bt, st, P, P(n['body']), 0.17, RAG, reach=0.45)
    # ---- a mantle of ribs over the shoulders, a rope of bone at the waist
    F.hull(bt, [(gv(C, 0, 0.2, 0), 0.3, 0.24), (gv(C, 0, 0.36, -0.01), 0.24, 0.2), (gv(C, 0, 0.44, -0.02), 0.13, 0.12)], [chest], ROBE2, sides=12, surf='fur')
    for k in range(9):
        a = math.pi + (k - 4) * 0.36
        b = gv(C, math.sin(a) * 0.16, 0.38, math.cos(a) * 0.13)
        pts = [b, b + G(math.sin(a) * 0.15, -0.08, math.cos(a) * 0.12), b + G(math.sin(a) * 0.24, -0.26, math.cos(a) * 0.18)]
        F.chain(bt, pts, [0.022, 0.02, 0.006], [chest], BONE, sides=5, surf='shell')
    for k in range(7):
        a = (k - 3) * 0.32
        b = gv(C, math.sin(a) * 0.2, 0.0, math.cos(a) * 0.17)
        F.gem(bt, b, 0.04, [chest], BONE if k % 2 else 0xa89c80, surf='shell', glow=False)
    # ---- the hood: tall and peaked, a void inside, two cold eyes
    F.hull(bt, [(gv(Hd, 0, -0.18, -0.03), 0.16, 0.16), (gv(Hd, 0, -0.02, -0.02), 0.17, 0.18), (gv(Hd, 0, 0.14, -0.04), 0.15, 0.16), (gv(Hd, 0, 0.28, -0.09), 0.09, 0.1), (gv(Hd, 0, 0.38, -0.18), 0.02, 0.02)], [head], ROBE2, sides=12, surf='fur', arc=(0.75, math.tau - 0.75))
    F.hull(bt, [(gv(Hd, 0, -0.14, 0.0), 0.12, 0.12), (gv(Hd, 0, 0.12, -0.02), 0.12, 0.12)], [head], VOID, sides=10, surf='fur')
    for sd in (-1, 1):
        F.gem(bt, gv(Hd, sd * 0.045, 0.02, 0.11), 0.022, [head], SOUL, stretch=0.6)
    F.plate(bt, gv(Hd, 0, -0.1, 0.1), (0.1, 0.05, 0.05), [head], BONE, bevel=0.35, taper=0.8, surf='shell')
    for k in range(5):
        F.spike(bt, gv(Hd, (k - 2) * 0.018, -0.08, 0.125), gv(Hd, (k - 2) * 0.018, -0.12, 0.125), 0.007, [head], 0xe8e0c8, surf='shell')
    # ---- sleeves and long bony hands
    for arm in n['arms']:
        up, mid, low = arm['up'], arm['mid'], arm['low']
        U, M, L = P(up), P(mid), P(low)
        F.loft(bt, [U, M, L.lerp(M, 0.12)], [0.09, 0.1, 0.17], [0.09, 0.1, 0.17], [up, mid, low], ROBE, sides=8, surf='fur')
        for st in range(3):
            q = L.lerp(M, 0.12) + G((st - 1) * 0.08, -0.04, 0)
            F.ribbon(bt, [q, q + G(0, -0.16, 0), q + G(0.01, -0.3, -0.02)], 0.07, G(1, 0, 0), [low], RAG, thick=0.008)
        F.plate(bt, L + G(0, -0.02, 0.02), (0.06, 0.06, 0.04), [low], BONE, bevel=0.35, surf='shell')
        for f in range(4):
            k0 = L + G((f - 1.5) * 0.022, -0.04, 0.03)
            F.chain(bt, [k0, k0 + G((f - 1.5) * 0.012, -0.1, 0.05), k0 + G((f - 1.5) * 0.014, -0.18, 0.11)], [0.012, 0.009, 0.002], [low], BONE, sides=5, surf='shell')
    # ---- the scythe: a long black haft bound in iron, a great curved blade with a ghostly edge
    rl = n['arms'][0]['low']
    W = P(rl)
    F.prism(bt, W + G(0.02, -1.5, -0.14), W + G(-0.03, 2.1, 0.12), 0.036, 0.036, [rl], WOOD, sides=7, surf='fur')
    for y in (-1.2, -0.4, 0.6, 1.5):
        F.ring(bt, W + G(0, y, y * 0.06), 0.04, [rl], IRON, width=0.07, thick=0.012, segs=10, surf='shell')
    T0 = W + G(-0.03, 2.12, 0.12)
    F.plate(bt, T0, (0.11, 0.2, 0.11), [rl], IRON, bevel=0.3, surf='shell')
    F.spike(bt, T0 + G(0, 0.02, -0.04), T0 + G(0, 0.18, -0.36), 0.035, [rl], IRON, surf='shell')
    spine = curve([T0 + G(0, 0.04, 0.04), T0 + G(0, 0.3, 0.7), T0 + G(0, 0.1, 1.4), T0 + G(0, -0.34, 1.85)], 4)
    wid = [0.2 * (1 - i / (len(spine) - 1)) ** 0.7 + 0.006 for i in range(len(spine))]
    mid = [p + G(0, -w * 0.5, 0) for p, w in zip(spine, wid)]
    F.ribbon(bt, mid, wid, G(0, 1, 0), [rl], 0xa8b0b8, thick=0.012, surf='shell')
    edge = [p + G(0, -w, 0) for p, w in zip(spine, wid)]
    F.chain(bt, edge, [0.012 * (1 - i / (len(edge) - 1)) + 0.003 for i in range(len(edge))], [rl], SOUL, sides=4, surf='glow', glow=True)
    # ---- the soul lantern at the left hip
    lp = G(0.42, 1.45, 0.16)
    F.prism(bt, G(0.34, 1.95, 0.08), lp + G(0, 0.16, 0), 0.008, 0.008, [body], IRON, sides=4, surf='shell')
    F.plate(bt, lp + G(0, 0.13, 0), (0.14, 0.03, 0.14), [body], IRON, bevel=0.3, surf='shell')
    F.plate(bt, lp + G(0, -0.13, 0), (0.14, 0.03, 0.14), [body], IRON, bevel=0.3, surf='shell')
    F.spike(bt, lp + G(0, 0.14, 0), lp + G(0, 0.24, 0), 0.06, [body], IRON, sides=4, surf='shell')
    for i in range(4):
        a = (i / 4) * math.tau + math.pi / 4
        F.prism(bt, lp + G(math.sin(a) * 0.065, 0.13, math.cos(a) * 0.065), lp + G(math.sin(a) * 0.065, -0.13, math.cos(a) * 0.065), 0.009, 0.009, [body], IRON, sides=4, surf='shell')
    F.gem(bt, lp, 0.06, [body], SOUL, stretch=1.3)
    bt.ao_floor = 0.6
    return bt.build(0.01, 3000, surface='fur'), CREATURE_SURFACES
# end:reaper


# end:siren


# forged:siren
# forged:siren
@builder('siren', 0x2f8a96)
def siren(bt):
    """
    Queen Nerissa, cut in crisp facets: a fine face under a crown of coral and
    pearls, sea-green hair falling in long locks, a bodice of leaf scales and
    layered shell pauldrons; a gold belt frilled with fins, and below it a long
    scaled tail curling along the ground to a great fluke. She bears a golden trident.
    """
    n, B = bt.n, bt.B
    body, chest, head, tail = n['body'], n['chest'], n['head'], n['tail']
    P = lambda i: Vector(B[i])
    Bo, C, Hd = P(body), P(chest), P(head)
    SKIN, SKIN2, HAIR, HAIR2, GOLD, PEARL, CORAL, CORAL2 = 0xcdeee6, 0xb0d8d2, 0x22606c, 0x2c7480, 0xe0bc64, 0xf2eee2, 0xf07a88, 0xf8a0a8
    SCALE, SCALE2, TAIL, BELLY, FIN, FIN2, EYE = 0x4cbcc4, 0x3696a4, 0x3a9cac, 0x9ad8d0, 0x68cad2, 0x48aab6, 0x60fff0
    bt.ao_floor = 0.68
    # ---- the torso: a slender waist rising to the ribs, shoulders, a long neck
    F.hull(bt, [(gv(Bo, 0, 0.08, 0), 0.14, 0.12), (gv(Bo, 0, 0.3, 0.005), 0.125, 0.105), (gv(C, 0, -0.12, 0.01), 0.15, 0.12), (gv(C, 0, 0.06, 0.01), 0.18, 0.13), (gv(C, 0, 0.2, 0), 0.2, 0.11), (gv(C, 0, 0.25, -0.005), 0.1, 0.07)], [body, chest], SKIN, sides=12, surf='fur')
    F.hull(bt, [(gv(C, 0, 0.19, 0), 0.19, 0.1), (gv(C, 0, 0.26, -0.01), 0.1, 0.07), (gv(C, 0, 0.3, -0.005), 0.05, 0.045)], [chest], SKIN, sides=10, surf='fur')
    F.prism(bt, gv(C, 0, 0.26, 0), gv(Hd, 0, -0.04, 0), 0.042, 0.036, [chest, head], SKIN, sides=7, surf='fur')
    for sd in (-1, 1):
        F.prism(bt, gv(C, sd * 0.02, 0.215, 0.09), gv(C, sd * 0.15, 0.225, 0.05), 0.012, 0.01, [chest], SKIN2, sides=4, surf='fur')
    # ---- the head: a faceted skull, narrow at the chin, a fine nose, coral lips, glowing almond eyes
    F.hull(bt, [(gv(Hd, 0, -0.085, 0.07), 0.02, 0.02), (gv(Hd, 0, -0.06, 0.04), 0.06, 0.07), (gv(Hd, 0, -0.01, 0.01), 0.088, 0.1), (gv(Hd, 0, 0.06, -0.005), 0.1, 0.112), (gv(Hd, 0, 0.13, -0.01), 0.088, 0.1), (gv(Hd, 0, 0.18, -0.015), 0.04, 0.05)], [head], SKIN, sides=10, surf='fur')
    F.prism(bt, gv(Hd, 0, 0.045, 0.105), gv(Hd, 0, 0.0, 0.125), 0.012, 0.016, [head], SKIN, sides=4, surf='fur')
    F.plate(bt, gv(Hd, 0, -0.035, 0.103), (0.036, 0.012, 0.012), [head], CORAL, bevel=0.4, surf='fur')
    for sd in (-1, 1):
        e = gv(Hd, sd * 0.042, 0.035, 0.095)
        F.plate(bt, e, (0.034, 0.016, 0.012), [head], 0x0a2a30, rot=(0, sd * 0.35, sd * 0.12), bevel=0.3, surf='fur')
        F.plate(bt, e + G(0, 0, 0.005), (0.024, 0.01, 0.01), [head], EYE, rot=(0, sd * 0.35, sd * 0.12), bevel=0.3, surf='glow', glow=True)
        F.plate(bt, e + G(sd * 0.004, 0.026, 0.0), (0.04, 0.007, 0.01), [head], HAIR, rot=(0, sd * 0.35, -sd * 0.18), bevel=0, surf='fur')
        F.plate(bt, gv(Hd, sd * 0.058, -0.005, 0.07), (0.03, 0.03, 0.02), [head], SKIN2, rot=(0, sd * 0.6, 0), bevel=0.4, surf='fur')
        # Fin ears swept back, ribbed in dark rods.
        ear = gv(Hd, sd * 0.095, 0.04, -0.005)
        for tip, w in ((gv(Hd, sd * 0.2, 0.17, -0.1), 0.06), (gv(Hd, sd * 0.23, 0.06, -0.13), 0.07), (gv(Hd, sd * 0.18, -0.04, -0.09), 0.05)):
            F.blade(bt, ear, tip, w, [head], FIN, thick=0.006, surf='membrane', side=G(0, 1, 0), belly=0.6)
            F.spike(bt, ear, tip, 0.005, [head], 0x1e5058, surf='shell')
    # ---- the hair: a cap over the crown, locks framing the face, long locks down each strand
    F.hull(bt, [(gv(Hd, 0, 0.0, -0.06), 0.1, 0.06), (gv(Hd, 0, 0.08, -0.02), 0.112, 0.12), (gv(Hd, 0, 0.15, -0.015), 0.095, 0.105), (gv(Hd, 0, 0.2, -0.02), 0.04, 0.05)], [head], HAIR, sides=10, surf='fur')
    for sd in (-1, 1):
        run = [gv(Hd, sd * 0.03, 0.16, 0.09), gv(Hd, sd * 0.1, 0.1, 0.075), gv(Hd, sd * 0.12, 0.0, 0.05), gv(Hd, sd * 0.125, -0.12, 0.04), gv(C, sd * 0.12, 0.22, 0.08), gv(C, sd * 0.14, 0.1, 0.09)]
        F.ribbon(bt, run, [0.05, 0.06, 0.06, 0.055, 0.045, 0.012], G(0, 0, 1), [head, chest], HAIR2, thick=0.012)
    for si, st in enumerate(n['strands']):
        pts = [P(b) for b in st]
        out = pts[0] - Hd
        out.z = 0
        side = Vector((-out.y, out.x, 0)).normalized() if out.length > 1e-4 else Vector((1, 0, 0))
        tip = pts[-1] + (pts[-1] - pts[-2]) * 0.9
        root = Hd + (pts[0] - Hd) * 0.6
        wv = lambda k: side * 0.025 * math.sin(k * 2.0 + si)
        run = [root, pts[0], pts[1] + wv(1), pts[2] + wv(2), pts[2].lerp(tip, 0.5) + wv(3), tip]
        F.ribbon(bt, run, [0.07, 0.09, 0.1, 0.085, 0.06, 0.012], side, [head] + st, HAIR if si % 3 else HAIR2, thick=0.014)
    # ---- the crown: a gold band, branching coral, pearls, a burning gem at the brow
    F.ring(bt, gv(Hd, 0, 0.135, -0.01), 0.113, [head], GOLD, width=0.03, thick=0.012, segs=14, surf='shell')
    for i in range(9):
        a = -1.5 + i * 0.375
        out = G(math.sin(a), 0, math.cos(a))
        side = G(math.cos(a), 0, -math.sin(a))
        b0 = gv(Hd, math.sin(a) * 0.11, 0.14, -0.01 + math.cos(a) * 0.1)
        h = 0.22 if i == 4 else 0.12 + 0.035 * (i % 2) - 0.012 * abs(i - 4)
        p1 = b0 + out * 0.03 + G(0, h * 0.55, 0)
        p2 = b0 + out * 0.06 + G(0, h, 0)
        F.chain(bt, [b0, p1, p2], [0.016, 0.011, 0.004], [head], CORAL, sides=5, surf='fur')
        for sgn in (-1, 1):
            q = b0.lerp(p1, 0.7 + 0.2 * sgn)
            F.chain(bt, [q, q + side * sgn * 0.035 + out * 0.02 + G(0, 0.035, 0), q + side * sgn * 0.045 + out * 0.035 + G(0, 0.065, 0)], [0.008, 0.005, 0.002], [head], CORAL2, sides=4, surf='fur')
        if i == 4:
            F.gem(bt, p2 + G(0, 0.03, 0), 0.026, [head], 0xa0fff8, stretch=1.5)
        else:
            F.gem(bt, p2 + G(0, 0.01, 0), 0.014, [head], PEARL, surf='shell', glow=False)
    F.gem(bt, gv(Hd, 0, 0.135, 0.125), 0.02, [head], EYE, stretch=1.4)
    # ---- the bodice: rows of leaf scales over breast and ribs, a gold rim, a pearl necklace, a gem at the heart
    F.hull(bt, [(gv(C, 0, -0.15, 0.012), 0.155, 0.125), (gv(C, 0, 0.06, 0.012), 0.185, 0.135), (gv(C, 0, 0.19, 0.004), 0.2, 0.115)], [chest], SCALE2, sides=12, surf='shell', arc=(-1.75, 1.75))
    for r in range(6):
        y = 0.18 - r * 0.06
        rx, rz = 0.195 - abs(r - 1.5) * 0.008 - (0.03 if r > 3 else 0), 0.125 + (0.012 if r in (1, 2) else 0)
        for k in range(9):
            a = -1.4 + 2.8 * (k + 0.5 * (r % 2)) / 8.5
            b = gv(C, math.sin(a) * rx, y, 0.01 + math.cos(a) * rz)
            F.blade(bt, b + G(0, 0.012, 0), b + G(math.sin(a) * 0.01, -0.07, math.cos(a) * 0.012), 0.052, [chest], SCALE if (r + k) % 2 else SCALE2, thick=0.007, surf='shell', side=G(math.cos(a), 0, -math.sin(a)), belly=0.55)
    for k in range(13):
        a = -1.4 + k * 2.8 / 12
        F.gem(bt, gv(C, math.sin(a) * 0.2, 0.2 - 0.02 * math.cos(a), 0.008 + math.cos(a) * 0.118), 0.013, [chest], GOLD, surf='shell', glow=False)
    for k in range(15):
        a = -1.2 + k * 2.4 / 14
        F.gem(bt, gv(C, math.sin(a) * 0.1, 0.285 - 0.08 * math.cos(a), 0.01 + math.cos(a) * 0.105), 0.012, [chest], PEARL, surf='shell', glow=False)
    F.gem(bt, gv(C, 0, 0.165, 0.14), 0.028, [chest], EYE, stretch=1.3)
    # ---- the arms: slender, gold-banded, finned at the elbow; layered shell pauldrons with gold spines
    for arm in n['arms']:
        up, mid, low = arm['up'], arm['mid'], arm['low']
        S, E, W = P(up), P(mid), P(low)
        sd = 1 if W.x > 0 else -1
        F.prism(bt, gv(S, -sd * 0.02, 0.01, 0), E, 0.05, 0.037, [up, mid], SKIN, sides=7, surf='fur')
        F.prism(bt, E, W, 0.037, 0.027, [mid, low], SKIN, sides=7, surf='fur')
        F.plate(bt, gv(W, 0, -0.055, 0.02), (0.06, 0.07, 0.025), [low], SKIN, bevel=0.4, taper=0.8, surf='fur')
        for f in range(4):
            k0 = gv(W, (f - 1.5) * 0.016, -0.09, 0.03)
            F.chain(bt, [k0, k0 + G((f - 1.5) * 0.005, -0.04, 0.012), k0 + G((f - 1.5) * 0.008, -0.075, 0.03)], [0.009, 0.007, 0.004], [low], SKIN, sides=4, surf='fur')
        F.chain(bt, [gv(W, -sd * 0.03, -0.05, 0.035), gv(W, -sd * 0.045, -0.09, 0.065)], [0.009, 0.005], [low], SKIN, sides=4, surf='fur')
        for t in (0.12, 0.22):
            F.prism(bt, W.lerp(E, t), W.lerp(E, t + 0.05), 0.033, 0.033, [low], GOLD, sides=8, surf='shell')
        F.prism(bt, S.lerp(E, 0.55), S.lerp(E, 0.62), 0.046, 0.044, [up], GOLD, sides=8, surf='shell')
        for k, (r, dy) in enumerate(((0.105, 0.03), (0.09, 0.0), (0.075, -0.03))):
            F.dome(bt, gv(S, sd * (0.025 + k * 0.012), dy, 0), r, [up], SCALE if k % 2 else SCALE2, axis=G(sd * 0.7, 1, 0).normalized(), theta=1.0, thick=0.012, segs=10, rings=3, surf='shell', squash=(1, 0.7, 1))
        for k in range(3):
            q = gv(S, sd * (0.05 + k * 0.025), 0.1 - k * 0.025, -0.03 + k * 0.03)
            F.spike(bt, q, q + G(sd * 0.05, 0.09, -0.02), 0.013, [up], GOLD, surf='shell')
        base = E + G(sd * 0.02, 0.0, -0.03)
        for tip, w in ((E + G(sd * 0.16, 0.06, -0.13), 0.07), (E + G(sd * 0.15, -0.12, -0.13), 0.08), (W + G(sd * 0.07, 0.06, -0.09), 0.05)):
            F.blade(bt, base, tip, w, [mid], FIN, thick=0.006, surf='membrane', side=(tip - base).cross(G(1, 0, 0)), belly=0.6)
            F.spike(bt, base, tip, 0.005, [mid], 0x1e5058, surf='shell')
    # ---- the waist: a frill of fins where skin turns to scale, a gold belt strung with pearls
    for k in range(16):
        a = k / 16 * math.tau
        d = G(math.sin(a), 0, math.cos(a))
        side = G(math.cos(a), 0, -math.sin(a))
        b0 = gv(Bo, 0, 0.12, 0) + d * 0.13
        F.blade(bt, b0, b0 + d * 0.15 + G(0, -0.24, 0), 0.11, [body], FIN if k % 2 else FIN2, thick=0.006, surf='membrane', side=side, belly=0.4)
    F.hull(bt, [(gv(Bo, 0, 0.1, 0), 0.15, 0.13), (gv(Bo, 0, 0.15, 0), 0.15, 0.13)], [body], GOLD, sides=14, surf='shell')
    for k in range(12):
        a = k / 12 * math.tau
        F.gem(bt, gv(Bo, math.sin(a) * 0.155, 0.125, math.cos(a) * 0.135), 0.015, [body], PEARL, surf='shell', glow=False)
    F.gem(bt, gv(Bo, 0, 0.125, 0.15), 0.026, [body], EYE, stretch=1.3)
    # ---- the tail: swelling from the hips, then tapering as it curls along the ground; a pale belly keel, a fin crest
    pts = [gv(Bo, 0, 0.08, 0)] + [P(t) for t in tail]
    end = pts[-1] + (pts[-1] - pts[-2]) * 0.9
    run = pts + [end]
    rr = [0.14, 0.195, 0.185, 0.165, 0.14, 0.112, 0.085, 0.06, 0.04, 0.026]
    tb = [[body]] + [[tail[max(0, i - 1)], tail[i], tail[min(i + 1, len(tail) - 1)]] for i in range(len(tail))]

    def dorsal(d):
        """The tail's back at a segment: up where it lies along the ground, behind where it hangs from the hips."""
        up = Vector((0, 0, 1)) - d * d.z
        if up.length < 0.5:
            back = G(0, 0, -1)
            up = up.normalized() * up.length + (back - d * d.dot(back)) * (0.5 - up.length) * 2
        return up.normalized()

    for i in range(len(run) - 1):
        a_, b_ = run[i], run[i + 1]
        F.loft(bt, [a_, b_], [rr[i], rr[i + 1]], [rr[i], rr[i + 1]], tb[i], TAIL, sides=10, surf='fur')
        d = (b_ - a_).normalized()
        up = dorsal(d)
        side = d.cross(up).normalized()
        # Overlapping leaf scales in staggered rows over the back and flanks.
        L = (b_ - a_).length
        rows = max(2, int(L / 0.09))
        for r in range(rows):
            t = (r + 0.5) / rows
            q = a_.lerp(b_, t)
            rad = rr[i] + (rr[i + 1] - rr[i]) * t
            for k in range(7):
                ang = (k - 3 + 0.5 * (r % 2)) * 0.42
                nrm = up * math.cos(ang) + side * math.sin(ang)
                c = q + nrm * rad * 1.01
                F.blade(bt, c - d * rad * 0.35, c + d * rad * 0.45, rad * 0.55, tb[i], SCALE if (r + k) % 2 else SCALE2, thick=0.006, surf='shell', side=d.cross(nrm), belly=0.35)
        # The pale keel of the belly.
        if i >= 1:
            F.loft(bt, [a_ - up * rr[i] * 0.55, b_ - up * rr[i + 1] * 0.55], [rr[i] * 0.75, rr[i + 1] * 0.75], [rr[i] * 0.5, rr[i + 1] * 0.5], tb[i], BELLY, sides=8, surf='fur')
        if 2 <= i <= 6:
            base_ = a_.lerp(b_, 0.5) + up * rr[i] * 0.9
            hgt = 0.12 + 0.05 * math.sin((i - 2) / 4 * math.pi)
            F.blade(bt, base_ - d * 0.09, base_ + d * 0.03 + up * hgt, 0.16, tb[i], FIN, thick=0.006, surf='membrane', side=d, belly=0.3)
            F.spike(bt, base_ - d * 0.04, base_ + d * 0.02 + up * hgt, 0.006, tb[i], 0x1e5058, surf='shell')
    # Hip fins.
    for sd in (-1, 1):
        h = G(sd * 0.17, 1.42, -0.06)
        for tip, w in ((G(sd * 0.48, 1.4, -0.22), 0.16), (G(sd * 0.44, 1.12, -0.32), 0.14), (G(sd * 0.3, 1.0, -0.22), 0.1)):
            F.blade(bt, h, tip, w, [body, tail[0]], FIN, thick=0.006, surf='membrane', side=(tip - h).cross(G(1, 0, 0)), belly=0.55)
            F.spike(bt, h, tip, 0.006, [body, tail[0]], 0x1e5058, surf='shell')
    # The fluke: two great lobes, ribbed.
    te, last = end, tail[-1]
    for sd in (-1, 1):
        for tip, w in ((te + G(sd * 0.12, 0.62, -0.06), 0.22), (te + G(sd * 0.5, 0.56, -0.4), 0.3), (te + G(sd * 0.8, 0.16, -0.6), 0.3), (te + G(sd * 0.6, -0.15, -0.36), 0.22)):
            F.blade(bt, te, tip, w, [last, tail[-2]], FIN if sd > 0 else FIN2, thick=0.008, surf='membrane', side=(tip - te).cross(G(0, 0, 1) if abs((tip - te).normalized().z) < 0.9 else G(1, 0, 0)), belly=0.6)
            F.spike(bt, te, tip, 0.01, [last, tail[-2]], 0x1e5058, surf='shell')
    # ---- the trident: a gilded shaft wound with gold, three barbed prongs, a burning gem where they meet
    rl = n['arms'][0]['low']
    W = P(rl)
    F.prism(bt, W + G(0, -1.0, 0.03), W + G(0, 1.35, -0.03), 0.026, 0.026, [rl], 0xb8903a, sides=7, surf='shell')
    for k in range(9):
        y = -0.85 + k * 0.26
        F.prism(bt, W + G(0, y, 0.0), W + G(0, y + 0.04, 0.0), 0.033, 0.033, [rl], GOLD, sides=7, surf='shell')
    F.spike(bt, W + G(0, -1.0, 0.03), W + G(0, -1.16, 0.035), 0.032, [rl], GOLD, sides=5, surf='shell')
    tp = W + G(0, 1.38, -0.03)
    F.chain(bt, [tp + G(-0.19, 0.12, 0), tp + G(-0.1, -0.04, 0), tp + G(0, -0.08, 0), tp + G(0.1, -0.04, 0), tp + G(0.19, 0.12, 0)], [0.012, 0.024, 0.03, 0.024, 0.012], [rl], GOLD, sides=6, surf='shell')
    for dx, h in ((0, 0.5), (-0.18, 0.38), (0.18, 0.38)):
        base_ = tp + G(dx, 0.1 if dx else 0, 0)
        tip_ = base_ + G(dx * 0.08, h, 0)
        F.chain(bt, [base_, base_.lerp(tip_, 0.6), tip_], [0.022, 0.016, 0.001], [rl], GOLD, sides=4, surf='shell')
        F.blade(bt, tip_ + G(0, -0.1, 0), tip_ + G(0.05 if dx >= 0 else -0.05, -0.2, 0), 0.03, [rl], GOLD, thick=0.008, surf='shell', side=G(0, 0, 1))
        F.gem(bt, tip_ + G(0, -0.05, 0), 0.016, [rl], 0x80fff0, stretch=2.4)
    F.gem(bt, tp + G(0, 0.0, 0.02), 0.04, [rl], EYE, stretch=1.3)
    return bt.build(0.005, 6000, surface='fur'), CREATURE_SURFACES
# end:siren
# end:siren


# end:serpent


# forged:serpent
# forged:serpent
@builder('serpent', 0x24525e)
def serpent(bt):
    """The Leviathan, cut in crisp facets: a sea serpent rearing from the waves, a webbed sail down its back, an armoured horned head with glowing eyes, ivory scutes up its throat, two coils and a finned tail behind."""
    n, B = bt.n, bt.B
    neck, head, jaw, tail, coils = n['neck'], n['head'], n['jaw'], n['tail'], n['coils']
    BACK, BACK2, BELLY, SPINE, WEB, IVORY, HORN, GLOW, DARK = 0x1e4e5a, 0x173e48, 0xd6d0b8, 0x0c2226, 0x2a8a96, 0xeae4d0, 0xd0c8a8, 0x50fff0, 0x061012
    nb = neck + [head]
    N = [B[k] for k in neck] + [B[head]]
    path = curve(N + [G(0, 9.9, 4.6)], 3)
    m = len(path)

    def rad(i):
        u = i / (m - 1)
        sst = lambda a, b, x: max(0.0, min(1.0, (x - a) / (b - a))) ** 2 * (3 - 2 * max(0.0, min(1.0, (x - a) / (b - a))))
        return 1.65 - 0.95 * sst(0, 1, u) - 0.25 * sst(0.85, 1, u)

    def bone_at(p):
        return sorted(nb, key=lambda b: (B[b] - p).length)[:2]

    def body(pts, radii, bones_for, belly_dir, sail=True, glow_every=2, sail_h=None):
        """A faceted run of body: hide, a pale keel of scutes under it, scale rows on the flanks, glowing spots, a webbed sail on top."""
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            bn = bones_for(a.lerp(b, 0.5))
            T = (b - a).normalized()
            D = (belly_dir(a.lerp(b, 0.5)) - T * T.dot(belly_dir(a.lerp(b, 0.5)))).normalized()
            S = T.cross(D).normalized()
            r0, r1 = radii[i], radii[i + 1]
            ov = (r0 + r1) * 0.12
            F.loft(bt, [a - T * (ov if i else 0), b + T * ov], [r0, r1], [r0, r1], bn, BACK if i % 2 else BACK2, sides=10, surf='fur', roll=0.31)
            # Scutes: overlapping ivory plates under the belly.
            c = a.lerp(b, 0.5)
            r = (r0 + r1) / 2
            L = (b - a).length
            for k in range(max(1, round(L / (r * 0.7)))):
                q = a.lerp(b, (k + 0.5) / max(1, round(L / (r * 0.7))))
                F.blade(bt, q + D * r * 0.92 - T * r * 0.35, q + D * r * 0.92 + T * r * 0.4, r * 1.25, bn, BELLY, thick=r * 0.08, surf='shell', side=S, belly=0.3)
            # Leaf scales in a row down each flank.
            for sd in (-1, 1):
                for k, ang in enumerate((0.55, 1.05)):
                    nrm = (S * sd * math.sin(ang * 1.4) - D * math.cos(ang * 1.4)).normalized()
                    q = c + nrm * r * 0.97
                    F.blade(bt, q - T * L * 0.4, q + T * L * 0.45, r * 0.4, bn, BACK2 if (i + k) % 2 else BACK, thick=r * 0.018, surf='fur', side=T.cross(nrm), belly=0.35)
                if glow_every and i % glow_every == 0:
                    F.gem(bt, c + (S * sd * 0.94 + D * 0.3).normalized() * r, r * 0.11, bn, GLOW, stretch=0.7)
            if sail:
                h = sail_h(i) if sail_h else r * 0.8
                top = c - D * r * 0.92
                F.spike(bt, top + D * 0.1, top - D * h - T * h * 0.35, r * 0.09, bn, SPINE, sides=5)
                nxt = b - D * r1 * 0.92
                F.ribbon(bt, [top - D * h * 0.04, top - D * h * 0.5 - T * h * 0.17 + T * L * 0.1, top - D * h * 0.92 - T * h * 0.32], [L * 0.95, L * 0.7, 0.04], -T, bn, WEB, thick=0.02, surf='membrane')

    throat = G(0, -0.45, 1).normalized()
    nrad = [rad(i) for i in range(m)]
    body(path[:-1], nrad[:-1], bone_at, lambda p: throat, sail_h=lambda i: 0.5 + 0.9 * math.sin(i / m * math.pi) if i >= 2 else 0.3)
    # ---- the head: an armoured skull, a long snout, heavy brows over glowing eyes, horns swept back, a fan at each cheek
    hd, J = [head], [jaw]
    F.loft(bt, [G(0, 9.7, 3.2), G(0, 9.85, 4.1), G(0, 9.82, 5.0), G(0, 9.6, 6.0), G(0, 9.4, 7.0)], [0.75, 0.95, 0.78, 0.5, 0.24], [0.6, 0.78, 0.66, 0.42, 0.2], hd, BACK, sides=10, surf='fur', roll=0.31)
    F.loft(bt, [G(0, 9.5, 5.0), G(0, 9.3, 6.0), G(0, 9.2, 6.9)], [0.62, 0.45, 0.22], [0.3, 0.24, 0.13], hd, DARK, sides=8, surf='fur')
    # Armour plates down the crown of the skull and snout.
    for k in range(5):
        z = 3.6 + k * 0.62
        F.plate(bt, G(0, 10.55 - k * 0.14 - (k > 2) * 0.12 * (k - 2), z), (0.7 - k * 0.1, 0.12, 0.55), hd, BACK2, rot=(0.12 + k * 0.03, 0, 0), bevel=0.45, taper=0.7, surf='shell')
    for sd in (-1, 1):
        # Brow ridge, the eye socket, a glowing eye, a nostril.
        F.plate(bt, G(sd * 0.6, 10.3, 4.9), (0.42, 0.16, 0.75), hd, SPINE, rot=(0.15, sd * 0.25, -sd * 0.35), bevel=0.4, taper=0.6, surf='shell')
        F.gem(bt, G(sd * 0.7, 10.0, 5.05), 0.24, hd, DARK, surf='fur', glow=False, stretch=0.8)
        F.gem(bt, G(sd * 0.78, 10.02, 5.12), 0.16, hd, GLOW, stretch=0.75)
        F.gem(bt, G(sd * 0.18, 9.62, 6.95), 0.07, hd, 0x40d0e0, stretch=0.6)
        # Horns swept back, ridged.
        F.chain(bt, [G(sd * 0.45, 10.35, 4.1), G(sd * 0.85, 11.05, 3.55), G(sd * 1.1, 11.3, 2.6), G(sd * 1.05, 11.2, 1.6)], [0.26, 0.2, 0.12, 0.01], hd, HORN, sides=6, surf='shell')
        for k in range(4):
            F.spike(bt, G(sd * (0.5 - k * 0.06), 10.2 - k * 0.12, 3.7 - k * 0.32), G(sd * (0.8 - k * 0.06), 10.75 - k * 0.12, 3.25 - k * 0.34), 0.08, hd, SPINE)
        # The cheek fan: spines webbed together.
        base = G(sd * 0.82, 9.6, 3.75)
        tips = [G(sd * 2.1, 10.7, 2.9), G(sd * 2.6, 9.8, 2.6), G(sd * 2.3, 8.8, 2.9), G(sd * 1.5, 8.3, 3.4)]
        for t in tips:
            F.blade(bt, base, t, 0.5, hd, WEB, thick=0.02, surf='membrane', side=(t - base).cross(G(1, 0, 0)), belly=0.6)
            F.spike(bt, base, t + (t - base) * 0.1, 0.05, hd, SPINE, sides=4)
        # Upper teeth, a whisker, glowing gills.
        for k in range(8):
            z, x = 5.0 + k * 0.27, sd * (0.58 - k * 0.045)
            F.spike(bt, G(x, 9.36, z), G(x, 8.95, z + 0.06), 0.055, hd, IVORY, sides=4)
        F.chain(bt, [G(sd * 0.5, 9.28, 6.5), G(sd * 0.95, 8.55, 6.7), G(sd * 1.15, 7.65, 6.4), G(sd * 1.05, 6.9, 6.0)], [0.08, 0.06, 0.035, 0.008], hd, SPINE, sides=5, surf='fur')
        for g in range(3):
            pts = [G(sd * 0.98, 8.0 - g * 0.32, 2.25 - g * 0.18), G(sd * 1.04, 7.82 - g * 0.32, 1.95 - g * 0.18), G(sd * 0.98, 7.6 - g * 0.32, 1.7 - g * 0.18)]
            q = [p + G(sd * 0.04, 0, 0) for p in pts]
            F.chain(bt, q, [0.04, 0.05, 0.04], [neck[4]], 0x40e8ff, sides=4, surf='glow', glow=True)
    # ---- the jaw: a pale underjaw, lower teeth, barbels
    F.loft(bt, [G(0, 9.05, 4.4), G(0, 9.02, 5.6), G(0, 8.98, 6.9)], [0.6, 0.42, 0.18], [0.26, 0.2, 0.1], J, BELLY, sides=8, surf='fur')
    for sd in (-1, 1):
        for k in range(6):
            z, x = 5.15 + k * 0.28, sd * (0.48 - k * 0.05)
            F.spike(bt, G(x, 9.05, z), G(x, 9.36, z + 0.05), 0.05, J, IVORY, sides=4)
    for sd in (-1, 0, 1):
        F.spike(bt, G(sd * 0.25, 8.85, 5.2 + abs(sd) * 0.3), G(sd * 0.32, 8.3, 5.0 + abs(sd) * 0.3), 0.07, J, SPINE)
    # ---- two coils arching out of the sea, sailed along their crests
    for root, (z0, top, r0) in zip(coils, ((-10.5, 3.7, 1.45), (-19.5, 3.1, 1.25))):
        pts = [G(0, -2.8 + (top + 2.8) * math.sin(i / 10 * math.pi), z0 + 4.4 * math.cos(i / 10 * math.pi)) for i in range(11)]
        mid = G(0, -2.8, z0)
        body(pts, [r0] * 11, lambda p, root=root: [root], lambda p, mid=mid: (mid - p).normalized(), sail_h=lambda i, r0=r0: r0 * (0.5 + 0.4 * math.sin(i / 10 * math.pi)))
    # ---- the tail standing up out of the water, a webbed paddle at the tip
    tp = [G(0, -3.4, -27), G(0, -0.8, -27.3), G(0, 1.8, -27.6), G(0, 4.2, -27.9), G(0, 6.2, -28.2), G(0, 7.7, -28.5)]
    rr = [1.1, 0.92, 0.74, 0.54, 0.34, 0.12]
    body(tp, rr, lambda p: sorted(tail, key=lambda b: (B[b] - p).length)[:2], lambda p: G(0, 0, 1), sail_h=lambda i: rr[i] * 0.9, glow_every=0)
    base = G(0, 6.9, -28.35)
    last = sorted(tail, key=lambda b: (B[b] - base).length)[0]
    for t in (G(0, 10.4, -28.9), G(0, 10.0, -30.2), G(0, 8.6, -31.0), G(0, 6.8, -30.6), G(0, 5.6, -29.6)):
        F.blade(bt, base, t, 1.0, [last], WEB, thick=0.03, surf='membrane', side=G(1, 0, 0).cross(t - base), belly=0.6)
        F.spike(bt, base, t, 0.08, [last], SPINE, sides=4)
    bt.ao_floor = 0.6
    return bt.build(0.06, 4000, surface='fur'), CREATURE_SURFACES
# end:serpent
# end:serpent


# end:dragon




# forged:dragon
# forged:dragon
@builder('dragon', 0x5a1a12)
def dragon(bt):
    """
    Pyrrhax, the elder dragon, cut in crisp facets: a deep chest armoured in
    scutes down the spine, tan belly plates with fire glowing between them,
    an angular horned head with a burning maw, clawed legs, horned wing arms
    (the game stretches the membrane between the fingers) and a tail ending
    in a spiked club with two blades.
    """
    n, B = bt.n, bt.B
    hips, chest, neck, head, jaw, tail = n['hips'], n['chest'], n['neck'], n['head'], n['jaw'], n['tail']
    P = lambda i: Vector(B[i])
    H, C, Hd, J = P(hips), P(chest), P(head), P(jaw)
    HIDE, HIDE2, BELLY, SPINE, HORN, IVORY, FIRE, EYE, DARK = 0x5a1a12, 0x45140e, 0xc08a50, 0x1c1210, 0x3a2a1c, 0xe2d6b8, 0xff5a14, 0xffb020, 0x120806
    torso = [hips, chest]
    ridge = []
    # ---- the body: a heavy belly, a deep chest, scutes down the spine, plates and fire beneath
    tp = [gv(H, 0, 0.04, -0.45), gv(H, 0, 0.0, -0.05), H.lerp(C, 0.5) + G(0, -0.02, 0), gv(C, 0, 0.0, 0.0), gv(C, 0, 0.12, 0.35)]
    trx, try_ = [0.36, 0.47, 0.53, 0.55, 0.4], [0.36, 0.47, 0.54, 0.57, 0.42]
    F.loft(bt, tp, trx, try_, torso, HIDE, sides=12, surf='fur', roll=math.pi / 12)
    for i in range(9):
        t = i / 8
        q = gv(C, 0, 0, 0.3).lerp(gv(H, 0, 0, -0.25), t)
        ry = lerp(0.57, 0.47, t)
        F.plate(bt, q + G(0, -ry * 0.94, 0), (0.54 - 0.06 * abs(t - 0.4), 0.07, 0.17), torso, BELLY, bevel=0.4, taper=1.0, surf='shell')
        if i < 8:
            F.plate(bt, q + G(0, -ry * 0.9 - 0.01, -0.07), (0.36, 0.03, 0.03), torso, FIRE, bevel=0, surf='glow', glow=True)
    for i in range(8):
        t = i / 7
        q = gv(C, 0, 0, 0.25).lerp(gv(H, 0, 0, -0.35), t)
        ry = lerp(0.57, 0.47, t)
        F.plate(bt, q + G(0, ry * 0.97, 0), (0.24, 0.07, 0.19), torso, HIDE2, rot=(0.12, 0, 0), bevel=0.4, taper=0.6, surf='shell')
        ridge.append((q + G(0, ry * 1.0, 0), 0.26 if t < 0.2 or t > 0.8 else 0.2, torso))
    # Molten cracks over the flanks, glowing through the hide.
    for sd in (-1, 1):
        crack = [gv(C, sd * 0.54, -0.05 + 0.1 * math.sin(k * 2.3), 0.2 - k * 0.22) for k in range(6)]
        crack = [p + G(sd * (-0.02 * abs(k - 2.5)), 0, 0) for k, p in enumerate(crack)]
        F.chain(bt, crack, [0.03, 0.025, 0.022, 0.02, 0.016, 0.01], torso, FIRE, sides=4, surf='glow', glow=True)
        for k in range(3):
            q = gv(C, sd * 0.46, 0.2 - k * 0.12, 0.25 - k * 0.3)
            F.plate(bt, q, (0.2, 0.05, 0.22), torso, HIDE2, rot=(0, 0, -sd * 0.9), bevel=0.4, taper=0.7, surf='shell')
    # ---- the neck: long and thick at the shoulders, plated beneath, scuted above
    path = [gv(C, 0, 0.12, 0.3)] + [P(k) for k in neck] + [Hd]
    radii = [lerp(0.4, 0.2, i / (len(path) - 1)) for i in range(len(path))]
    nbones = [[chest, neck[0]]] + [[neck[i], neck[min(i + 1, len(neck) - 1)]] for i in range(len(neck))]
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        T = (b - a).normalized()
        ov = (radii[i] + radii[i + 1]) * 0.1
        F.loft(bt, [a - T * (ov if i else 0), b + T * ov], [radii[i], radii[i + 1]], [radii[i], radii[i + 1]], nbones[i], HIDE if i % 2 else HIDE2, sides=10, surf='fur', roll=math.pi / 10)
        down = (Vector((0, 0, -1)) - T * T.z).normalized()
        up = -down
        c = a.lerp(b, 0.5)
        r = (radii[i] + radii[i + 1]) / 2
        F.blade(bt, c + down * r * 0.9 - T * r * 0.7, c + down * r * 0.9 + T * r * 0.9, r * 1.3, nbones[i], BELLY, thick=r * 0.1, surf='shell', side=T.cross(down), belly=0.3)
        ridge.append((c + up * r * 0.95, 0.14 + 0.06 * (i < 2), nbones[i]))
    # ---- the head: an angular skull, heavy brows, a long snout, eyes of fire, a crown of horns
    hy = Hd + G(0, 0.03, 0)
    hd = [head]
    F.loft(bt, [gv(hy, 0, 0.0, -0.2), gv(hy, 0, 0.02, 0.06), gv(hy, 0, 0.0, 0.3), gv(hy, 0, -0.05, 0.56), gv(hy, 0, -0.08, 0.8)], [0.17, 0.23, 0.18, 0.13, 0.07], [0.17, 0.2, 0.15, 0.1, 0.06], hd, HIDE, sides=8, surf='fur', roll=math.pi / 8)
    F.plate(bt, gv(hy, 0, 0.17, 0.12), (0.22, 0.06, 0.4), hd, HIDE2, rot=(0.1, 0, 0), bevel=0.4, taper=0.6, surf='shell')
    F.plate(bt, gv(hy, 0, 0.09, 0.48), (0.16, 0.05, 0.4), hd, HIDE2, rot=(0.16, 0, 0), bevel=0.4, taper=0.6, surf='shell')
    F.spike(bt, gv(hy, 0, 0.06, 0.6), gv(hy, 0, 0.2, 0.55), 0.035, hd, HORN, sides=5)
    F.plate(bt, gv(hy, 0, -0.11, 0.42), (0.18, 0.03, 0.5), hd, FIRE, bevel=0, surf='glow', glow=True)
    for sd in (-1, 1):
        F.plate(bt, gv(hy, sd * 0.13, 0.12, 0.22), (0.12, 0.06, 0.32), hd, SPINE, rot=(0.25, sd * 0.2, -sd * 0.4), bevel=0.4, taper=0.5, surf='shell')
        F.gem(bt, gv(hy, sd * 0.16, 0.07, 0.27), 0.04, hd, DARK, surf='fur', glow=False, stretch=0.7)
        F.plate(bt, gv(hy, sd * 0.165, 0.07, 0.28), (0.012, 0.03, 0.07), hd, EYE, rot=(0.0, sd * 0.35, -sd * 0.2), bevel=0.2, surf='glow', glow=True)
        F.gem(bt, gv(hy, sd * 0.045, -0.03, 0.79), 0.018, hd, DARK, surf='fur', glow=False)
        # A great pair of horns sweeping back, a lesser pair below, spikes down the cheeks.
        F.chain(bt, [gv(hy, sd * 0.12, 0.13, -0.02), gv(hy, sd * 0.3, 0.36, -0.2), gv(hy, sd * 0.38, 0.32, -0.6), gv(hy, sd * 0.32, 0.42, -0.88)], [0.08, 0.06, 0.035, 0.004], hd, HORN, sides=6, surf='shell')
        F.chain(bt, [gv(hy, sd * 0.17, 0.03, -0.06), gv(hy, sd * 0.37, 0.07, -0.22), gv(hy, sd * 0.46, -0.03, -0.48)], [0.05, 0.03, 0.003], hd, HORN, sides=5, surf='shell')
        for k in range(4):
            a = gv(hy, sd * 0.19, -0.06, 0.04 - k * 0.07)
            F.spike(bt, a, a + G(sd * 0.12, -0.03, -0.11), 0.026, hd, SPINE)
        for k in range(6):
            a = gv(hy, sd * (0.12 - k * 0.012), -0.08, 0.34 + k * 0.075)
            F.spike(bt, a, a + G(0, -0.075, 0.005), 0.015, hd, IVORY)
    # ---- the jaw: tan underside, teeth, chin spikes
    F.loft(bt, [gv(J, 0, -0.02, 0.0), gv(J, 0, -0.04, 0.32), gv(J, 0, -0.05, 0.64)], [0.15, 0.12, 0.05], [0.07, 0.06, 0.035], [jaw], BELLY, sides=8, surf='fur')
    for sd in (-1, 1):
        for k in range(5):
            a = gv(J, sd * (0.1 - k * 0.012), -0.03, 0.28 + k * 0.075)
            F.spike(bt, a, a + G(0, 0.07, 0.005), 0.014, [jaw], IVORY)
    for sd in (-1, 0, 1):
        a = gv(J, sd * 0.06, -0.08, 0.18)
        F.spike(bt, a, a + G(sd * 0.03, -0.13, -0.1), 0.022, [jaw], SPINE)
    # ---- legs: heavy thighs, scaled shins, hooked ivory claws, a spur at the knee
    for leg in n['limbs']:
        up, mid, low_, Ft = leg['up'], leg['mid'], leg['low'], G(*leg['foot'])
        U, M, L = P(up), P(mid), P(low_)
        sd, front = leg['side'], leg['front']
        F.loft(bt, [gv(U, -sd * 0.03, 0.08, 0.0), gv(U, 0, -0.18, 0.02 if front else 0.06), M.lerp(U, 0.2)], [0.23, 0.23 if front else 0.27, 0.15], [0.27, 0.3 if front else 0.34, 0.16], [chest if front else hips, up, mid], HIDE, sides=8, surf='fur')
        F.prism(bt, M, L, 0.13, 0.09, [mid, low_], HIDE2, sides=7, surf='fur')
        F.prism(bt, L, Ft + G(0, 0.07, 0.02), 0.09, 0.085, [low_], HIDE2, sides=7, surf='fur')
        F.plate(bt, Ft + G(0, 0.06, 0.07), (0.22, 0.11, 0.3), [low_], HIDE2, bevel=0.4, taper=0.7, surf='fur')
        F.dome(bt, gv(U, sd * 0.06, 0.02, 0), 0.2, [up], HIDE2, axis=G(sd * 0.8, 1, 0).normalized(), theta=1.0, thick=0.03, segs=8, rings=2, surf='shell')
        for dx in (-0.08, 0, 0.08):
            a = Ft + G(dx, 0.07, 0.17)
            F.chain(bt, [a, a + G(dx * 0.4, 0.0, 0.12), a + G(dx * 0.5, -0.07, 0.2)], [0.035, 0.022, 0.002], [low_], IVORY, sides=4, surf='shell')
        a = Ft + G(0, 0.09, -0.06)
        F.spike(bt, a, a + G(0, -0.06, -0.14), 0.03, [low_], IVORY)
        a = M + G(0, 0.02, -0.08 if front else 0.06)
        F.spike(bt, a, a + G(sd * 0.04, 0.06, -0.3 if front else 0.28), 0.05, [mid], SPINE, sides=5)
    # ---- wings: horned arm, forearm and hand; finger bones out to each tip; a thumb claw
    tips = [(1.5, -0.38, -0.37), (1.2, -0.64, -1.42), (0.6, -0.76, -2.17), (-0.25, -0.82, -2.57)]
    for w in n['wings']:
        root, fore, hand, fingers = w['root'], w['fore'], w['hand'], w['fingers']
        S, E, W = P(root), P(fore), P(hand)
        sd = 1 if W.x > 0 else -1
        F.prism(bt, gv(S, -sd * 0.05, -0.05, 0), E, 0.15, 0.1, [root, fore], HIDE, sides=7, surf='fur')
        F.prism(bt, E, W, 0.1, 0.065, [fore, hand], HIDE, sides=7, surf='fur')
        F.gem(bt, W, 0.09, [hand], HIDE2, surf='fur', glow=False)
        for f, t in zip(fingers, tips):
            tip = W + G(sd * t[0], t[1], t[2])
            F.chain(bt, [W, W.lerp(tip, 0.5) + G(0, 0.04, 0), tip], [0.048, 0.03, 0.006], [f], SPINE, sides=5, surf='fur')
        a = W + G(0, 0.02, 0)
        F.chain(bt, [a, a + G(sd * 0.05, 0.12, 0.2), a + G(sd * 0.02, 0.06, 0.34)], [0.05, 0.03, 0.003], [hand], IVORY, sides=4, surf='shell')
        for f in (0.3, 0.6):
            p = S.lerp(E, f)
            F.spike(bt, p + G(0, 0.06, 0), p + G(sd * 0.05, 0.3, -0.15), 0.04, [root], SPINE)
        F.spike(bt, E + G(0, 0.05, 0), E + G(sd * 0.1, 0.36, -0.12), 0.05, [fore], SPINE, sides=5)
    # ---- the tail: tapering, scuted, ending in a spiked club and two blades
    pts = [gv(H, 0, 0.02, -0.3)] + [P(t) for t in tail]
    end = pts[-1] + (pts[-1] - pts[-2]) * 0.6
    pts.append(end)
    tb = [[hips, tail[0]]] + [[tail[i], tail[min(i + 1, len(tail) - 1)]] for i in range(len(tail))]
    rr = [lerp(0.34, 0.035, (i / (len(pts) - 1)) ** 0.9) for i in range(len(pts))]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        T = (b - a).normalized()
        ov = (rr[i] + rr[i + 1]) * 0.1
        F.loft(bt, [a - T * (ov if i else 0), b + T * ov], [rr[i], rr[i + 1]], [rr[i], rr[i + 1]], tb[i], HIDE if i % 2 else HIDE2, sides=8, surf='fur', roll=math.pi / 8)
        c = a.lerp(b, 0.5)
        r = (rr[i] + rr[i + 1]) / 2
        F.plate(bt, c + G(0, -r * 0.9, 0), (r * 1.3, 0.04, (b - a).length * 0.8), tb[i], BELLY, bevel=0.4, surf='shell')
        ridge.append((c + G(0, r * 0.95, 0), 0.22 * (1 - i / len(pts)) + 0.06, tb[i]))
    last = tail[-1]
    F.gem(bt, end + G(0, 0.02, 0.05), 0.17, [last], SPINE, surf='fur', glow=False, stretch=0.75)
    for dy, dz, dx in ((0.12, 0.08, 0), (0.14, -0.08, 0), (-0.1, 0.02, 0), (0.0, 0.0, 0.12), (0.0, 0.0, -0.12)):
        a = end + G(dx * 0.5, dy * 0.5, dz)
        F.spike(bt, a, a + G(dx * 2.4, dy * 2.6, dz - 0.12), 0.045, [last], SPINE, sides=5)
    for sd in (-1, 1):
        F.blade(bt, end + G(0, 0, 0.1), end + G(sd * 0.42, 0.0, -0.2), 0.22, [last], IVORY, thick=0.02, surf='shell', side=G(0, 0, 1), belly=0.5)
    # ---- spines down the back: neck, body and tail
    for p, L, bn in ridge:
        F.spike(bt, p - G(0, 0.04, 0), p + G(0, L, -L * 0.55), L * 0.25, bn, SPINE, sides=4)
    bt.ao_floor = 0.55
    return bt.build(0.012, 4000, surface='fur'), ['fur', 'shell', 'glow', 'scale', 'ghost']
# end:dragon
# end:dragon


# forged:dragon
# forged:dragon
@builder('dragon', 0x5a1a12)
def dragon(bt):
    """
    Pyrrhax, the elder dragon, cut in crisp facets: a deep chest armoured in
    scutes down the spine, tan belly plates with fire glowing between them,
    an angular horned head with a burning maw, clawed legs, horned wing arms
    (the game stretches the membrane between the fingers) and a tail ending
    in a spiked club with two blades.
    """
    n, B = bt.n, bt.B
    hips, chest, neck, head, jaw, tail = n['hips'], n['chest'], n['neck'], n['head'], n['jaw'], n['tail']
    P = lambda i: Vector(B[i])
    H, C, Hd, J = P(hips), P(chest), P(head), P(jaw)
    HIDE, HIDE2, BELLY, SPINE, HORN, IVORY, FIRE, EYE, DARK = 0x5a1a12, 0x45140e, 0xc08a50, 0x1c1210, 0x3a2a1c, 0xe2d6b8, 0xff5a14, 0xffb020, 0x120806
    torso = [hips, chest]
    ridge = []
    # ---- the body: a heavy belly, a deep chest, scutes down the spine, plates and fire beneath
    tp = [gv(H, 0, 0.04, -0.45), gv(H, 0, 0.0, -0.05), H.lerp(C, 0.5) + G(0, -0.02, 0), gv(C, 0, 0.0, 0.0), gv(C, 0, 0.12, 0.35)]
    trx, try_ = [0.36, 0.47, 0.53, 0.55, 0.4], [0.36, 0.47, 0.54, 0.57, 0.42]
    F.loft(bt, tp, trx, try_, torso, HIDE, sides=12, surf='fur', roll=math.pi / 12)
    for i in range(9):
        t = i / 8
        q = gv(C, 0, 0, 0.08).lerp(gv(H, 0, 0, -0.25), t)
        ry = lerp(0.57, 0.47, t)
        F.plate(bt, q + G(0, -ry * 0.94, 0), (0.54 - 0.06 * abs(t - 0.4), 0.07, 0.17), torso, BELLY, bevel=0.4, taper=1.0, surf='shell')
        if i < 8:
            F.plate(bt, q + G(0, -ry * 0.9 - 0.01, -0.07), (0.36, 0.03, 0.03), torso, FIRE, bevel=0, surf='glow', glow=True)
    for i in range(8):
        t = i / 7
        q = gv(C, 0, 0, 0.25).lerp(gv(H, 0, 0, -0.35), t)
        ry = lerp(0.57, 0.47, t)
        F.plate(bt, q + G(0, ry * 0.97, 0), (0.24, 0.07, 0.19), torso, HIDE2, rot=(0.12, 0, 0), bevel=0.4, taper=0.6, surf='shell')
        ridge.append((q + G(0, ry * 1.0, 0), 0.26 if t < 0.2 or t > 0.8 else 0.2, torso))
    # Molten cracks over the flanks, glowing through the hide.
    for sd in (-1, 1):
        crack = [gv(C, sd * 0.54, -0.05 + 0.1 * math.sin(k * 2.3), 0.2 - k * 0.22) for k in range(6)]
        crack = [p + G(sd * (-0.02 * abs(k - 2.5)), 0, 0) for k, p in enumerate(crack)]
        F.chain(bt, crack, [0.03, 0.025, 0.022, 0.02, 0.016, 0.01], torso, FIRE, sides=4, surf='glow', glow=True)
        for k in range(3):
            q = gv(C, sd * 0.46, 0.2 - k * 0.12, 0.25 - k * 0.3)
            F.plate(bt, q, (0.2, 0.05, 0.22), torso, HIDE2, rot=(0, 0, -sd * 0.9), bevel=0.4, taper=0.7, surf='shell')
    # ---- the neck: long and thick at the shoulders, plated beneath, scuted above
    path = [gv(C, 0, 0.12, 0.3)] + [P(k) for k in neck] + [Hd]
    radii = [lerp(0.4, 0.2, i / (len(path) - 1)) for i in range(len(path))]
    nbones = [[chest, neck[0]]] + [[neck[i], neck[min(i + 1, len(neck) - 1)]] for i in range(len(neck))]
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        T = (b - a).normalized()
        ov = (radii[i] + radii[i + 1]) * 0.1
        F.loft(bt, [a - T * (ov if i else 0), b + T * ov], [radii[i], radii[i + 1]], [radii[i], radii[i + 1]], nbones[i], HIDE if i % 2 else HIDE2, sides=10, surf='fur', roll=math.pi / 10)
        down = (Vector((0, 0, -1)) - T * T.z).normalized()
        up = -down
        c = a.lerp(b, 0.5)
        r = (radii[i] + radii[i + 1]) / 2
        F.blade(bt, c + down * r * 0.9 - T * r * 0.7, c + down * r * 0.9 + T * r * 0.9, r * 1.3, nbones[i], BELLY, thick=r * 0.1, surf='shell', side=T.cross(down), belly=0.3)
        ridge.append((c + up * r * 0.95, 0.14 + 0.06 * (i < 2), nbones[i]))
    # ---- the head: an angular skull, heavy brows, a long snout, eyes of fire, a crown of horns
    hy = Hd + G(0, 0.03, 0)
    hd = [head]
    F.loft(bt, [gv(hy, 0, 0.0, -0.2), gv(hy, 0, 0.02, 0.06), gv(hy, 0, 0.0, 0.3), gv(hy, 0, -0.05, 0.56), gv(hy, 0, -0.08, 0.8)], [0.17, 0.23, 0.18, 0.13, 0.07], [0.17, 0.2, 0.15, 0.1, 0.06], hd, HIDE, sides=8, surf='fur', roll=math.pi / 8)
    F.plate(bt, gv(hy, 0, 0.17, 0.12), (0.22, 0.06, 0.4), hd, HIDE2, rot=(0.1, 0, 0), bevel=0.4, taper=0.6, surf='shell')
    F.plate(bt, gv(hy, 0, 0.09, 0.48), (0.16, 0.05, 0.4), hd, HIDE2, rot=(0.16, 0, 0), bevel=0.4, taper=0.6, surf='shell')
    F.spike(bt, gv(hy, 0, 0.06, 0.6), gv(hy, 0, 0.2, 0.55), 0.035, hd, HORN, sides=5)
    F.plate(bt, gv(hy, 0, -0.11, 0.42), (0.18, 0.03, 0.5), hd, FIRE, bevel=0, surf='glow', glow=True)
    for sd in (-1, 1):
        F.plate(bt, gv(hy, sd * 0.13, 0.12, 0.22), (0.12, 0.06, 0.32), hd, SPINE, rot=(0.25, sd * 0.2, -sd * 0.4), bevel=0.4, taper=0.5, surf='shell')
        F.gem(bt, gv(hy, sd * 0.16, 0.07, 0.27), 0.04, hd, DARK, surf='fur', glow=False, stretch=0.7)
        F.plate(bt, gv(hy, sd * 0.165, 0.07, 0.28), (0.012, 0.03, 0.07), hd, EYE, rot=(0.0, sd * 0.35, -sd * 0.2), bevel=0.2, surf='glow', glow=True)
        F.gem(bt, gv(hy, sd * 0.045, -0.03, 0.79), 0.018, hd, DARK, surf='fur', glow=False)
        # A great pair of horns sweeping back, a lesser pair below, spikes down the cheeks.
        F.chain(bt, [gv(hy, sd * 0.12, 0.13, -0.02), gv(hy, sd * 0.3, 0.36, -0.2), gv(hy, sd * 0.38, 0.32, -0.6), gv(hy, sd * 0.32, 0.42, -0.88)], [0.08, 0.06, 0.035, 0.004], hd, HORN, sides=6, surf='shell')
        F.chain(bt, [gv(hy, sd * 0.17, 0.03, -0.06), gv(hy, sd * 0.37, 0.07, -0.22), gv(hy, sd * 0.46, -0.03, -0.48)], [0.05, 0.03, 0.003], hd, HORN, sides=5, surf='shell')
        for k in range(4):
            a = gv(hy, sd * 0.19, -0.06, 0.04 - k * 0.07)
            F.spike(bt, a, a + G(sd * 0.12, -0.03, -0.11), 0.026, hd, SPINE)
        for k in range(6):
            a = gv(hy, sd * (0.12 - k * 0.012), -0.08, 0.34 + k * 0.075)
            F.spike(bt, a, a + G(0, -0.075, 0.005), 0.015, hd, IVORY)
    # ---- the jaw: tan underside, teeth, chin spikes
    F.loft(bt, [gv(J, 0, -0.02, 0.0), gv(J, 0, -0.04, 0.32), gv(J, 0, -0.05, 0.64)], [0.15, 0.12, 0.05], [0.07, 0.06, 0.035], [jaw], BELLY, sides=8, surf='fur')
    for sd in (-1, 1):
        for k in range(5):
            a = gv(J, sd * (0.1 - k * 0.012), -0.03, 0.28 + k * 0.075)
            F.spike(bt, a, a + G(0, 0.07, 0.005), 0.014, [jaw], IVORY)
    for sd in (-1, 0, 1):
        a = gv(J, sd * 0.06, -0.08, 0.18)
        F.spike(bt, a, a + G(sd * 0.03, -0.13, -0.1), 0.022, [jaw], SPINE)
    # ---- legs: heavy thighs, scaled shins, hooked ivory claws, a spur at the knee
    for leg in n['limbs']:
        up, mid, low_, Ft = leg['up'], leg['mid'], leg['low'], G(*leg['foot'])
        U, M, L = P(up), P(mid), P(low_)
        sd, front = leg['side'], leg['front']
        F.loft(bt, [gv(U, -sd * 0.03, 0.08, 0.0), gv(U, 0, -0.18, 0.02 if front else 0.06), M.lerp(U, 0.2)], [0.23, 0.23 if front else 0.27, 0.15], [0.27, 0.3 if front else 0.34, 0.16], [chest if front else hips, up, mid], HIDE, sides=8, surf='fur')
        F.prism(bt, M, L, 0.13, 0.09, [mid, low_], HIDE2, sides=7, surf='fur')
        F.prism(bt, L, Ft + G(0, 0.07, 0.02), 0.09, 0.085, [low_], HIDE2, sides=7, surf='fur')
        F.plate(bt, Ft + G(0, 0.06, 0.07), (0.22, 0.11, 0.3), [low_], HIDE2, bevel=0.4, taper=0.7, surf='fur')
        F.dome(bt, gv(U, sd * 0.06, 0.02, 0), 0.2, [up], HIDE2, axis=G(sd * 0.8, 1, 0).normalized(), theta=1.0, thick=0.03, segs=8, rings=2, surf='shell')
        for dx in (-0.08, 0, 0.08):
            a = Ft + G(dx, 0.07, 0.17)
            F.chain(bt, [a, a + G(dx * 0.4, 0.0, 0.12), a + G(dx * 0.5, -0.07, 0.2)], [0.035, 0.022, 0.002], [low_], IVORY, sides=4, surf='shell')
        a = Ft + G(0, 0.09, -0.06)
        F.spike(bt, a, a + G(0, -0.06, -0.14), 0.03, [low_], IVORY)
        a = M + G(0, 0.02, -0.08 if front else 0.06)
        F.spike(bt, a, a + G(sd * 0.04, 0.06, -0.3 if front else 0.28), 0.05, [mid], SPINE, sides=5)
    # ---- wings: horned arm, forearm and hand; finger bones out to each tip; a thumb claw
    tips = [(1.5, -0.38, -0.37), (1.2, -0.64, -1.42), (0.6, -0.76, -2.17), (-0.25, -0.82, -2.57)]
    for w in n['wings']:
        root, fore, hand, fingers = w['root'], w['fore'], w['hand'], w['fingers']
        S, E, W = P(root), P(fore), P(hand)
        sd = 1 if W.x > 0 else -1
        F.prism(bt, gv(S, -sd * 0.05, -0.05, 0), E, 0.15, 0.1, [root, fore], HIDE, sides=7, surf='fur')
        F.prism(bt, E, W, 0.1, 0.065, [fore, hand], HIDE, sides=7, surf='fur')
        F.gem(bt, W, 0.09, [hand], HIDE2, surf='fur', glow=False)
        for f, t in zip(fingers, tips):
            tip = W + G(sd * t[0], t[1], t[2])
            F.chain(bt, [W, W.lerp(tip, 0.5) + G(0, 0.04, 0), tip], [0.048, 0.03, 0.006], [f], SPINE, sides=5, surf='fur')
        a = W + G(0, 0.02, 0)
        F.chain(bt, [a, a + G(sd * 0.05, 0.12, 0.2), a + G(sd * 0.02, 0.06, 0.34)], [0.05, 0.03, 0.003], [hand], IVORY, sides=4, surf='shell')
        for f in (0.3, 0.6):
            p = S.lerp(E, f)
            F.spike(bt, p + G(0, 0.06, 0), p + G(sd * 0.05, 0.3, -0.15), 0.04, [root], SPINE)
        F.spike(bt, E + G(0, 0.05, 0), E + G(sd * 0.1, 0.36, -0.12), 0.05, [fore], SPINE, sides=5)
    # ---- the tail: tapering, scuted, ending in a spiked club and two blades
    pts = [gv(H, 0, 0.02, -0.3)] + [P(t) for t in tail]
    end = pts[-1] + (pts[-1] - pts[-2]) * 0.6
    pts.append(end)
    tb = [[hips, tail[0]]] + [[tail[i], tail[min(i + 1, len(tail) - 1)]] for i in range(len(tail))]
    rr = [lerp(0.34, 0.035, (i / (len(pts) - 1)) ** 0.9) for i in range(len(pts))]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        T = (b - a).normalized()
        ov = (rr[i] + rr[i + 1]) * 0.1
        F.loft(bt, [a - T * (ov if i else 0), b + T * ov], [rr[i], rr[i + 1]], [rr[i], rr[i + 1]], tb[i], HIDE if i % 2 else HIDE2, sides=8, surf='fur', roll=math.pi / 8)
        c = a.lerp(b, 0.5)
        r = (rr[i] + rr[i + 1]) / 2
        F.plate(bt, c + G(0, -r * 0.9, 0), (r * 1.3, 0.04, (b - a).length * 0.8), tb[i], BELLY, bevel=0.4, surf='shell')
        ridge.append((c + G(0, r * 0.95, 0), 0.22 * (1 - i / len(pts)) + 0.06, tb[i]))
    last = tail[-1]
    F.gem(bt, end + G(0, 0.02, 0.05), 0.17, [last], SPINE, surf='fur', glow=False, stretch=0.75)
    for dy, dz, dx in ((0.12, 0.08, 0), (0.14, -0.08, 0), (-0.1, 0.02, 0), (0.0, 0.0, 0.12), (0.0, 0.0, -0.12)):
        a = end + G(dx * 0.5, dy * 0.5, dz)
        F.spike(bt, a, a + G(dx * 2.4, dy * 2.6, dz - 0.12), 0.045, [last], SPINE, sides=5)
    for sd in (-1, 1):
        F.blade(bt, end + G(0, 0, 0.1), end + G(sd * 0.42, 0.0, -0.2), 0.22, [last], IVORY, thick=0.02, surf='shell', side=G(0, 0, 1), belly=0.5)
    # ---- spines down the back: neck, body and tail
    for p, L, bn in ridge:
        F.spike(bt, p - G(0, 0.04, 0), p + G(0, L, -L * 0.55), L * 0.25, bn, SPINE, sides=4)
    bt.ao_floor = 0.55
    return bt.build(0.012, 4000, surface='fur'), ['fur', 'shell', 'glow', 'scale', 'ghost']
# end:dragon
# end:dragon


# end:spider


# forged:spider
# forged:spider
@builder('spider', 0x2a221c)
def spider(bt):
    """
    The Broodmother (and her spiderlings and tangle spiders, in their own
    colours), cut in crisp facets: a plated head with eight burning eyes,
    venom-tipped fangs, a great armoured abdomen with a glowing hourglass,
    and eight high-kneed legs, banded and bristled.
    """
    n, B = bt.n, bt.B
    head, fangs, abdomen = n['head'], n['fangs'], n['abdomen']
    P = lambda i: Vector(B[i])
    Hd = P(head)
    MARK, EYE, VENOM, FANG = 0xff3a18, 0xff2a10, 0x9aff40, 0x1a1410
    # ---- the head: a faceted dome, a ridged carapace, eight eyes, palps
    F.hull(bt, [(gv(Hd, 0, -0.09, -0.2), 0.12, 0.1), (gv(Hd, 0, -0.1, -0.05), 0.21, 0.22), (gv(Hd, 0, -0.06, 0.12), 0.19, 0.18), (gv(Hd, 0, 0.02, 0.22), 0.12, 0.1)], [head], 'main', sides=10, surf='fur')
    F.hull(bt, [(gv(Hd, 0, 0.0, -0.15), 0.16, 0.13), (gv(Hd, 0, 0.08, -0.02), 0.17, 0.2), (gv(Hd, 0, 0.1, 0.12), 0.12, 0.13), (gv(Hd, 0, 0.08, 0.2), 0.06, 0.05)], [head], 'dark', sides=10, surf='shell')
    F.plate(bt, gv(Hd, 0, 0.13, 0.0), (0.05, 0.04, 0.3), [head], 'main', bevel=0.4, taper=0.5, surf='shell')
    for sd in (-1, 1):
        for x, y, z, r in ((0.045, 0.08, 0.2, 0.032), (0.1, 0.06, 0.17, 0.022), (0.06, 0.12, 0.15, 0.018), (0.13, 0.09, 0.1, 0.016)):
            F.gem(bt, gv(Hd, sd * x, y, z), r, [head], EYE, stretch=0.9)
        F.chain(bt, [gv(Hd, sd * 0.1, -0.04, 0.2), gv(Hd, sd * 0.16, 0.02, 0.3), gv(Hd, sd * 0.13, -0.1, 0.38)], [0.025, 0.02, 0.008], [head], 'main', sides=5, surf='fur')
    for f in fangs:
        Fg = P(f)
        sd = 1 if Fg.x > 0 else -1
        F.plate(bt, gv(Fg, 0, -0.02, 0.0), (0.08, 0.1, 0.08), [f], 'main', bevel=0.4, taper=0.7, surf='fur')
        F.chain(bt, [gv(Fg, 0, -0.06, 0.03), gv(Fg, sd * 0.01, -0.15, 0.08), gv(Fg, -sd * 0.04, -0.2, 0.05)], [0.025, 0.016, 0.002], [f], FANG, sides=5, surf='shell')
        F.gem(bt, gv(Fg, -sd * 0.035, -0.19, 0.055), 0.012, [f], VENOM)
    # ---- the abdomen: a great faceted sac, plated along the back, an hourglass of fire, spots down the flanks
    A = gv(P(abdomen), 0, 0.12, -0.36)
    F.prism(bt, gv(Hd, 0, -0.02, -0.18), A + G(0, -0.05, 0.3), 0.08, 0.12, [head, abdomen], 'dark', sides=6, surf='fur')
    F.loft(bt, [A + G(0, -0.04, 0.42), A + G(0, 0.0, 0.3), A + G(0, 0.02, 0.06), A + G(0, 0.0, -0.2), A + G(0, -0.04, -0.38), A + G(0, -0.07, -0.47)], [0.12, 0.27, 0.35, 0.32, 0.18, 0.04], [0.1, 0.24, 0.31, 0.29, 0.16, 0.04], [abdomen], 'main', sides=12, surf='fur', roll=math.pi / 12)
    for k in range(5):
        z = 0.26 - k * 0.15
        rr = [0.24, 0.31, 0.31, 0.27, 0.18][k]
        F.plate(bt, A + G(0, rr * 0.97, z), (0.2 - abs(k - 2) * 0.03, 0.05, 0.13), [abdomen], 'dark', rot=(0.25 - k * 0.12, 0, 0), bevel=0.4, taper=0.7, surf='shell')
    top = A + G(0, 0.33, 0.0)
    for dz in (1, -1):
        F.blade(bt, top + G(0, 0.0, 0.0), top + G(0, -0.01, dz * 0.13), 0.13, [abdomen], MARK, thick=0.012, surf='glow', glow=True, side=G(1, 0, 0), belly=0.92)
    for sd in (-1, 1):
        for i in range(3):
            F.gem(bt, A + G(sd * (0.33 - i * 0.02), 0.08 - i * 0.05, 0.05 - i * 0.14), 0.035 - i * 0.005, [abdomen], MARK, stretch=0.6)
        F.spike(bt, A + G(sd * 0.04, -0.05, -0.42), A + G(sd * 0.05, -0.08, -0.53), 0.025, [abdomen], 'dark')
    for i in range(22):
        a = i * 2.39996
        u = 0.12 + 0.5 * ((i + 0.5) / 22)
        dx, dy, dz = math.cos(a) * math.sin(u * math.pi), math.cos(u * math.pi), math.sin(a) * math.sin(u * math.pi)
        p = A + G(dx * 0.33, 0.01 + dy * 0.3, -0.04 + dz * 0.42)
        F.spike(bt, p - G(dx, dy, dz) * 0.02, p + G(dx, dy, dz) * 0.07, 0.012, [abdomen], 'dark', sides=3)
    # ---- legs: high knees, long shins, banded, bristled, a hooked claw
    for leg in n['limbs']:
        up, mid, low = leg['up'], leg['mid'], leg['low']
        U, K, Fo, T = P(up), P(mid), P(low), G(*leg['foot'])
        sd = leg['side']
        F.prism(bt, U, K, 0.05, 0.045, [up], 'main', sides=6, surf='fur')
        F.prism(bt, K, Fo, 0.045, 0.03, [mid], 'main', sides=6, surf='fur')
        F.prism(bt, Fo, T, 0.03, 0.006, [low], 'dark', sides=5, surf='fur')
        F.gem(bt, K, 0.058, [up, mid], 'dark', surf='shell', glow=False)
        F.gem(bt, Fo, 0.04, [mid, low], 'dark', surf='shell', glow=False)
        for t in (0.35, 0.7):
            F.prism(bt, U.lerp(K, t), U.lerp(K, t + 0.06), 0.053, 0.05, [up], 'dark', sides=6, surf='shell')
            F.prism(bt, K.lerp(Fo, t), K.lerp(Fo, t + 0.06), 0.044, 0.04, [mid], 'dark', sides=6, surf='shell')
        for f in (0.3, 0.6):
            p = U.lerp(K, f)
            F.spike(bt, p, p + G(sd * 0.02, 0.08, 0), 0.01, [up], 'dark', sides=3)
            q = K.lerp(Fo, f)
            F.spike(bt, q, q + G(sd * 0.06, 0.03, 0), 0.008, [mid], 'dark', sides=3)
    bt.ao_floor = 0.6
    return bt.build(0.0065, 3000, surface='fur'), CREATURE_SURFACES
# end:spider
# end:spider


# -------------------------------------------------------------------- main --


def palette(colour, slot, rgb):
    """The colour a slot takes for a creature's colour (as the game works it out)."""
    c = [((colour >> s) & 255) / 255 for s in (16, 8, 0)]
    if slot == MAIN:
        return c
    if slot == LIGHT:
        return [lerp(x, y, 0.6) for x, y in zip(c, (0.92, 0.87, 0.78))]
    if slot == DARK:
        return [x * 0.42 for x in c]
    return [((rgb >> s) & 255) / 255 for s in (16, 8, 0)]


def preview(kind, surfaces):
    """Renders the new model (in its default colour) side on and three-quarter, with Cycles."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    colour = COLOURS[kind]
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    objs = []
    for surf, rec in surfaces.items():
        me = bpy.data.meshes.new(surf)
        me.from_pydata(rec['verts'], [], rec['tris'])
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        from kit import Beast as _B  # noqa: F401
        for i in range(len(rec['verts'])):
            slot, sh, rgb = rec['shades'][i]
            col = palette(colour, slot, rgb)
            k = 1.0 if slot == GLOW else sh
            attr.data[i].color = (col[0] ** 2.2 * k, col[1] ** 2.2 * k, col[2] ** 2.2 * k, 1)
        for p in me.polygons:
            p.use_smooth = True
        m = bpy.data.materials.new(surf)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes['Principled BSDF']
        ca = nt.nodes.new('ShaderNodeVertexColor')
        ca.layer_name = 'Col'
        nt.links.new(ca.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.4 if surf == 'shell' else 0.85
        if surf == 'glow':
            nt.links.new(ca.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 4
        me.materials.append(m)
        ob = bpy.data.objects.new(surf, me)
        scene.collection.objects.link(ob)
        objs.append(ob)
        for v in rec['verts']:
            lo = Vector(map(min, lo, v))
            hi = Vector(map(max, hi, v))
    size = max(hi - lo)
    mid = (lo + hi) / 2
    # --focus=x,y,z,size (game axes): a close-up instead of the whole creature.
    for a in sys.argv:
        if a.startswith('--focus='):
            fx, fy, fz, fs = map(float, a[8:].split(','))
            mid, size = G(fx, fy, fz), fs
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size * 1.25
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(45), 0, math.radians(35))
    scene.collection.objects.link(sun)
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.32, 0.3, 0.28, 1)
    scene.world = w
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    os.makedirs(os.path.join(HERE, 'preview', 'new'), exist_ok=True)
    for tag, (yaw, pitch) in (('side', (90, 82)), ('three', (35, 70))):
        r = size * 3
        a = math.radians(yaw)
        cam.location = mid + Vector((math.sin(a) * r, -math.cos(a) * r, r * math.cos(math.radians(pitch))))
        cam.rotation_euler = (mid - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(HERE, 'preview', 'new', f'{kind}-{tag}.png')
        bpy.ops.render.render(write_still=True)


def read(path):
    with gzip.open(path, 'rb') as fh:
        raw = fh.read()
    if raw[:4] != b'MBC3':
        return [], []
    hl = struct.unpack('<I', raw[4:8])[0]
    heads = json.loads(raw[8:8 + hl])
    off = 8 + hl
    blobs = []
    for h in heads:
        n = sum(s['bytes'] for s in h['surfaces'])
        blobs.append(raw[off:off + n])
        off += n
    return heads, blobs


def write(heads, blobs):
    header = json.dumps(heads).encode()
    # Gzipped (the game unpacks it as it loads); no timestamp, so the same models make the same file.
    with open(OUT, 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=9, mtime=0) as fh:
        fh.write(b'MBC3')
        fh.write(struct.pack('<I', len(header)))
        fh.write(header)
        fh.write(b''.join(blobs))
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')


def main():
    kinds = [a for a in sys.argv[1:] if not a.startswith('--')] or list(BUILDERS)
    heads, blobs = read(OUT) if os.path.exists(OUT) else ([], [])
    keep = [(h, b) for h, b in zip(heads, blobs) if h['kind'] not in kinds]
    heads, blobs = [h for h, _ in keep], [b for _, b in keep]
    for kind in kinds:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        data = json.load(open(os.path.join(RIGS, f'{kind}.json')))
        bt = Beast(data)
        surfaces, replace = BUILDERS[kind](bt)
        head, blob = pack(bt, surfaces, replace)
        for rec in surfaces.values():
            rec['shades'] = [bt.shade(rec, i) for i in range(len(rec['verts']))]
        heads.append(head)
        blobs.append(blob)
        print(kind, ', '.join(f"{s['surf']} {s['verts']}v/{s['tris']}t" for s in head['surfaces']), flush=True)
        if '--preview' in sys.argv:
            preview(kind, surfaces)
    write(heads, blobs)


if __name__ == '__main__':
    main()
