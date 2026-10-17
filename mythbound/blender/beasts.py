"""Mythbound's creatures and great foes, modelled anew in Blender over their own skeletons.

    npx vite-node scripts/dump-creatures.ts      # the skeletons (and the old bodies, for sizes)
    python blender/beasts.py [kind ...] [--preview]

Each builder sculpts its creature from metaball clay around the skeleton the
game animates (so every animation still plays), adds hard parts (claws,
teeth, horns, eyes), and paints it with colour slots the game fills from the
creature's own colour (so a frost wolf and a grey wolf share one model). The
result goes into src/assets/creatures.bin beside whatever else is there.
"""

import json
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402,I001
from mathutils import Vector  # noqa: E402

from kit import DARK, FIXED, GLOW, LIGHT, MAIN, Beast, G, Part, lerp, look, pack  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RIGS = os.path.join(HERE, 'rigs')
OUT = os.path.join(HERE, '..', 'src', 'assets', 'creatures.bin')
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


@builder('stag', 0x4a4232)
def stag(bt):
    """Cernunna: a tall spirit stag with a bone-white skull for a face, a shaggy mane and vast glowing antlers."""
    n, B = bt.n, bt.B
    hips, chest, neck, head, jaw = n['hips'], n['chest'], n['neck'], n['head'], n['jaw']
    H, C, Hd, J = B[hips], B[chest], B[head], B[jaw]
    torso = [hips, chest]
    coat = dict(belly=-0.5, back=0.65, mottle=0.35)
    bone = 0xe6dcc2
    # A deep chest, a lean waist, strong haunches.
    bt.blob(gv(C, 0, -0.03, 0.04), 0.17, 0.23, 0.26, bones=[chest], **coat)
    bt.capsule(gv(C, 0, -0.02, -0.15), gv(H, 0, 0.02, 0.08), 0.15, 0.135, bones=torso, **coat)
    bt.blob(gv(H, 0, 0.01, -0.06), 0.16, 0.18, 0.2, bones=[hips], **coat)
    # The neck rising high and thick, then the head.
    N0, N1 = B[neck[0]], B[neck[1]]
    bt.chain([gv(C, 0, 0.04, 0.14), N0, N1, gv(Hd, 0, 0.0, -0.04)], [0.17, 0.15, 0.12, 0.095], [[chest, neck[0]], [neck[0], neck[1]], [neck[1], head]], **coat)
    # The mane: shaggy locks hanging under the neck and chest, shorter ones along the crest.
    for i in range(16):
        t = i / 15
        sd = (i % 3) - 1
        a = gv(C, sd * 0.09, -0.08, 0.2).lerp(gv(N1, sd * 0.06, -0.06, 0.02), t)
        L = 0.36 - t * 0.2
        bt.capsule(a, a + G(sd * 0.04, -L, 0.03 - t * 0.05), 0.07 - t * 0.02, 0.012, bones=[chest] + neck if t < 0.5 else neck, slot=DARK, mottle=0.3)
    for i in range(8):
        t = i / 7
        for sd in (-1, 1):
            a = gv(C, sd * 0.05, 0.16, 0.12).lerp(gv(N1, sd * 0.04, 0.08, -0.04), t)
            bt.capsule(a, a + G(sd * 0.08, -0.06, -0.14), 0.05, 0.01, bones=neck, slot=DARK, mottle=0.3)
    # The head: a furred crown behind a bone-white skull face with dark sockets and glowing eyes.
    hy = Hd + G(0, 0.04, 0)
    bt.blob(gv(hy, 0, 0.0, 0.01), 0.095, 0.095, 0.1, bones=[head], **coat)
    face = curve([gv(hy, 0, 0.01, 0.03), gv(hy, 0, 0.0, 0.13), gv(hy, 0, -0.04, 0.27), gv(hy, 0, -0.08, 0.39), gv(hy, 0, -0.09, 0.44)], 3)
    radii = [0.09, 0.085, 0.06, 0.038, 0.022]
    for k in range(4):
        bt.capsule(face[k * 3], face[(k + 1) * 3], radii[k], radii[k + 1], bones=[head], slot=FIXED, rgb=bone)
    for sd in (-1, 1):
        bt.blob(gv(hy, sd * 0.062, 0.02, 0.14), 0.032, 0.028, 0.03, bones=[head], slot=FIXED, rgb=0x0e0a08)
        bt.eye(gv(hy, sd * 0.07, 0.02, 0.15), 0.016, [head], rgb=0x70ffc0)
        bt.blob(gv(hy, sd * 0.016, -0.085, 0.43), 0.009, 0.011, 0.008, bones=[head], slot=FIXED, rgb=0x0e0a08)
        # Cheekbones.
        bt.blob(gv(hy, sd * 0.07, -0.03, 0.17), 0.025, 0.02, 0.06, bones=[head], slot=FIXED, rgb=bone)
    bt.tube([gv(hy, 0, 0.065, 0.12), gv(hy, 0, 0.045, 0.24), gv(hy, 0, 0.0, 0.36)], 0.008, [head], surface='glow', slot=GLOW, rgb=0x50e0a0, n=5)
    # The jaw: a bare bone mandible with a dark mouth line.
    bt.capsule(gv(J, 0, -0.01, -0.02), gv(J, 0, -0.06, 0.27), 0.05, 0.022, bones=[jaw], slot=FIXED, rgb=0xcfc4a8)
    # Ears: long, drooping a little, set out sideways.
    for e in n['ears']:
        E = B[e]
        sd = 1 if E.x > 0 else -1
        base, tip = gv(E, -sd * 0.03, -0.03, 0.0), gv(E, sd * 0.2, 0.04, -0.06)
        bt.tube([base, base.lerp(tip, 0.4) + G(0, 0.03, 0), tip], lambda t: 0.05 * math.sin(math.pi * min(1, 0.25 + t * 0.85)) + 0.004, [e], surface='fur', slot=DARK, n=10, squash=0.3)
    # The antlers: beams sweeping up and out, tines along them, glowing tips and hanging moss.
    for sd in (-1, 1):
        beam = curve([gv(hy, sd * 0.06, 0.07, -0.01), gv(hy, sd * 0.22, 0.36, -0.13), gv(hy, sd * 0.42, 0.7, -0.11), gv(hy, sd * 0.46, 1.06, -0.23), gv(hy, sd * 0.36, 1.36, -0.35)], 3)
        bt.tube(beam, lambda t: 0.048 * (1 - t) + 0.014, [head], rgb=0xd8cbb0, n=8)
        bt.blob(beam[0], 0.05, 0.03, 0.05, bones=[head], slot=FIXED, rgb=0x8a7a60)
        tines = [(0.12, (0.05, 0.12, 0.3), 0.3), (0.3, (0.12, 0.25, 0.25), 0.36), (0.5, (0.02, 0.3, 0.26), 0.42),
                 (0.62, (0.2, 0.22, -0.08), 0.36), (0.78, (-0.1, 0.32, 0.18), 0.32), (0.9, (0.16, 0.3, -0.12), 0.28), (1.0, (-0.04, 0.28, -0.04), 0.22)]
        for f, d, L in tines:
            p0 = beam[round(f * (len(beam) - 1))]
            dv = G(d[0] * sd, d[1], d[2]).normalized()
            p1 = p0 + dv * L * 0.55 + G(0, L * 0.08, 0)
            p2 = p0 + dv * L + G(0, L * 0.25, 0)
            bt.tube([p0, p1, p2], lambda t: 0.028 * (1 - t) + 0.006, [head], rgb=0xd8cbb0, n=6)
            bt.tube([p1.lerp(p2, 0.5), p2, p2 + dv * 0.06], lambda t: 0.017 * (1 - t) + 0.002, [head], surface='glow', slot=GLOW, rgb=0x80ffc8, n=6)
        for f in (0.3, 0.5, 0.72):
            p0 = beam[round(f * (len(beam) - 1))]
            for k in range(3):
                q = p0 + G(sd * 0.02 * (k - 1), -0.01, 0.02 * (k - 1))
                bt.tube([q, q + G(sd * 0.02, -0.14 - 0.06 * k, 0.01), q + G(sd * 0.03, -0.28 - 0.08 * k, 0.03)], lambda t: 0.018 * (1 - t) + 0.003, [head], rgb=0x3e5a2a, n=5, squash=0.6)
    # Legs: long and slender, with powerful upper legs and small dark hooves.
    for leg in n['limbs']:
        up, mid, low = leg['up'], leg['mid'], leg['low']
        U, M, L = B[up], B[mid], B[low]
        F = G(*leg['foot'])
        sd = leg['side']
        if leg['front']:
            bt.blob(gv(U, -sd * 0.03, -0.08, 0.0), 0.09, 0.2, 0.13, bones=[chest, up], **coat)
            bt.capsule(gv(U, 0, -0.1, 0), M, 0.08, 0.05, bones=[up, mid], mottle=0.3)
        else:
            bt.blob(gv(U, -sd * 0.03, -0.1, 0.04), 0.1, 0.22, 0.16, rot=(-0.25, 0, 0), bones=[hips, up], **coat)
            bt.capsule(gv(U, 0, -0.14, 0.05), M, 0.1, 0.06, bones=[up, mid], mottle=0.3)
        bt.capsule(M, L, 0.045, 0.032, bones=[mid, low], mottle=0.3)
        bt.capsule(L, F + G(0, 0.07, 0), 0.032, 0.028, bones=[low], slot=DARK)
        bt.blob(L, 0.04, 0.04, 0.045, bones=[mid, low], slot=DARK)
        hoof(bt, L, F + G(0, -0.01, 0.0), [low], 0.04)
    # A short pale tail.
    tail = n['tail']
    T0, T1 = B[tail[0]], B[tail[1]]
    bt.capsule(gv(T0, 0, 0.02, 0.06), T1 + (T1 - T0) * 0.2, 0.045, 0.025, bones=tail, belly=0.2)
    # Spirit whorls on the flanks, laid on the skin.
    for sd in (-1, 1):
        for z0, y0, cnt in ((-0.5, 1.32, 6), (0.0, 1.22, 6), (0.32, 1.35, 4)):
            pts = []
            for i in range(cnt):
                z = z0 + i * 0.08
                y = y0 + 0.07 * math.sin(i * 1.7)
                p = bt.surface(G(sd * 0.6, y, z), G(-sd, 0, 0))
                pts.append(p + G(sd * 0.006, 0, 0))
            bt.tube(pts, lambda t: 0.012 * (1 - t) + 0.002, [hips, chest], surface='glow', slot=GLOW, rgb=0x30c890, n=4)
    return bt.build(0.008, 12000, ('CLOUDS', 0.025, 0.006)), ['fur', 'glow']


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


@builder('dragon', 0x5a1a12)
def dragon(bt):
    wyrm(bt, 1.0, [(1.5, -0.38, -0.37), (1.2, -0.64, -1.42), (0.6, -0.76, -2.17), (-0.25, -0.82, -2.57)], 0xc08a50, horn_rgb=0x3a2a1c, embers=True, club=True)
    return bt.build(0.012, 18000, ('VORONOI', 0.035, 0.008), surface='scale'), ['scale', 'fur', 'glow']


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


@builder('spider', 0x2a221c)
def spider(bt):
    """A great hairy spider: a domed head with eight red eyes, venom fangs, a vast marked abdomen and high-kneed legs."""
    n, B = bt.n, bt.B
    head, abdomen, fangs = n['head'], n['abdomen'], n['fangs']
    Hd = B[head]
    hair = dict(belly=-0.4, under=DARK, mottle=0.35)
    # Head and thorax: a domed plate, hairy round its rim.
    bt.blob(gv(Hd, 0, 0.02, 0.0), 0.22, 0.13, 0.27, bones=[head], **hair)
    bt.blob(gv(Hd, 0, 0.09, -0.02), 0.15, 0.07, 0.2, bones=[head], slot=DARK)
    bt.blob(gv(Hd, 0, 0.06, 0.17), 0.11, 0.08, 0.09, bones=[head], **hair)
    for sd in (-1, 1):
        for x, y, r in ((0.035, 0.06, 0.032), (0.09, 0.05, 0.022), (0.05, 0.11, 0.018), (0.12, 0.09, 0.016)):
            p = bt.surface(gv(Hd, sd * x, y, 0.8), G(0, 0, -1))
            bt.eye(p + G(0, 0, r * 0.6), r * 1.2, [head], rgb=0xff2a10)
        # Palps.
        jointed(bt, [gv(Hd, sd * 0.1, -0.04, 0.2), gv(Hd, sd * 0.16, 0.02, 0.3), gv(Hd, sd * 0.13, -0.1, 0.38)], [0.025, 0.02, 0.012], [head, head], slot=MAIN, surface='fur')
    for f in fangs:
        F = B[f]
        sd = 1 if F.x > 0 else -1
        bt.blob(gv(F, 0, -0.01, 0.01), 0.05, 0.07, 0.05, bones=[f], **hair)
        fang = curve([gv(F, 0, -0.06, 0.03), gv(F, sd * 0.01, -0.15, 0.08), gv(F, -sd * 0.04, -0.19, 0.05)], 3)
        bt.tube(fang, lambda t: 0.024 * (1 - t) + 0.002, [f], rgb=0x1a1410, n=7)
        bt.eye(fang[-1], 0.011, [f], rgb=0x9aff40)
    # The abdomen: a great round sac, bristling, with a glowing hourglass and side spots.
    A = gv(B[abdomen], 0, 0.12, -0.36)
    bt.blob(A, 0.34, 0.3, 0.42, bones=[abdomen], **hair)
    bt.capsule(gv(Hd, 0, 0.0, -0.18), A, 0.08, 0.15, bones=[head, abdomen], **hair)
    top = bt.surface(A + G(0, 1, 0.05), Vector((0, 0, -1)))
    bt.blob(top + G(0, -0.01, 0.07), 0.07, 0.02, 0.1, bones=[abdomen], slot=GLOW, rgb=0xff3a18)
    bt.blob(top + G(0, -0.02, -0.13), 0.1, 0.02, 0.08, bones=[abdomen], slot=GLOW, rgb=0xff3a18)
    for sd in (-1, 1):
        for i in range(3):
            p = bt.surface(A + G(sd * 0.6, 0.18 - i * 0.06, -0.05 - i * 0.12), G(-sd, 0, 0))
            bt.eye(p, 0.03 - i * 0.004, [abdomen], rgb=0xff3a18, squash=0.6)
    for i in range(26):
        a = i * 2.39996
        u = 0.1 + 0.8 * ((i + 0.5) / 26)
        d = G(math.cos(a) * math.sin(u * math.pi), math.cos(u * math.pi) * 0.3 + 0.45, -math.sin(a) * math.sin(u * math.pi) * 0.6 - 0.45).normalized()
        p = bt.surface(A + d * 0.8, -d)
        bt.cone(p - d * 0.01, p + d * 0.07, 0.01, [abdomen], slot=DARK)
    for sd in (-1, 1):
        bt.cone(A + G(sd * 0.04, -0.05, -0.38), A + G(sd * 0.05, -0.08, -0.48), 0.025, [abdomen], slot=DARK)
    # Legs: high knees, long shins, a bristle or two on each.
    for leg in n['limbs']:
        up, mid, low = leg['up'], leg['mid'], leg['low']
        U, K, Fo, T = B[up], B[mid], B[low], G(*leg['foot'])
        jointed(bt, [U, K, Fo, T], [0.05, 0.042, 0.028, 0.006], [up, mid, low], slot=MAIN, surface='fur', n=8)
        sd = leg['side']
        for f in (0.3, 0.6):
            p = U.lerp(K, f)
            bt.cone(p, p + G(sd * 0.02, 0.07, 0), 0.01, [up], slot=DARK)
            q = K.lerp(Fo, f)
            bt.cone(q, q + G(sd * 0.05, 0.03, 0), 0.008, [mid], slot=DARK)
    return bt.build(0.0065, 9000, ('CLOUDS', 0.02, 0.004), surface='fur'), ['fur', 'shell', 'glow']


@builder('crab', 0x3e5f66)
def crab(bt):
    """Thalassor: a giant crab, its domed shell crusted with barnacles and weed, one claw bigger than the other."""
    n, B = bt.n, bt.B
    body, jaw = n['body'], n['jaw']
    Bo = B[body]
    ty = Bo.z
    shell = dict(belly=-0.35, under=LIGHT, mottle=0.25)
    spike_rgb = 0x23302f
    # The carapace: broad and domed, a raised crown, a pale underside.
    bt.blob(gv(Bo, 0, 0.08, 0.0), 1.3, 0.5, 1.0, bones=[body], **shell)
    bt.blob(gv(Bo, 0, 0.3, -0.1), 0.85, 0.3, 0.62, bones=[body], **shell)
    bt.blob(gv(Bo, 0, -0.16, 0.0), 1.12, 0.3, 0.86, bones=[body], slot=LIGHT)
    for sd in (-1, 1):
        bt.blob(gv(Bo, sd * 0.45, 0.28, 0.25), 0.3, 0.18, 0.32, bones=[body], **shell)
    # Spikes round the front rim.
    for i in range(11):
        a = -1.2 + (i / 10) * 2.4
        p = bt.surface(gv(Bo, math.sin(a) * 3, 0.08, math.cos(a) * 3), G(-math.sin(a), 0, -math.cos(a)))
        d = G(math.sin(a), 0.15, math.cos(a)).normalized()
        bt.cone(p - d * 0.05, p + d * 0.24, 0.07, [body], rgb=spike_rgb)
    # Barnacles crusting the dome.
    for i in range(18):
        a = i * 2.39996
        r = 0.2 + 0.7 * math.sqrt((i + 0.5) / 18)
        x, z = math.cos(a) * r * 1.1, math.sin(a) * r * 0.8 - 0.1
        p = bt.top(x, z)
        w = 0.07 + (i % 3) * 0.02
        bt.tube([p - G(0, 0.04, 0), p + G(0, 0.07, 0), p + G(0, 0.09, 0)], lambda t, w=w: w * (1 - 0.45 * t), [body], rgb=0xa8b0a2, n=7)
        bt.hard.append(('shell', _ball(p + G(0, 0.09, 0), w * 0.42, (1, 1, 0.4)), _part([body], FIXED, 0x30302c)))
    # Weed trailing off the back on its own strands.
    for st in n['strands']:
        pts = [B[k] for k in st]
        tip = pts[-1] + (pts[-1] - pts[-2]) * 0.8
        for k in range(len(pts)):
            a, b = pts[k], pts[k + 1] if k + 1 < len(pts) else tip
            bt.tube([a, a.lerp(b, 0.5) + G(0.03 * math.sin(k * 2.0), 0, 0), b], lambda t, k=k: 0.075 * (1 - (k + t) / len(pts)) + 0.01, [st[k]], surface='fur', rgb=0x2e5030 if k % 2 else 0x3e6034, n=5, squash=0.25)
    # Eye stalks, glowing eyes, and mouthparts.
    for sk_ in n['stalks']:
        S = B[sk_]
        sd = 1 if S.x > 0 else -1
        bt.tube([gv(S, 0, -0.08, 0), gv(S, sd * 0.03, 0.22, 0.04), gv(S, sd * 0.05, 0.42, 0.05)], lambda t: 0.055 - 0.015 * t, [sk_], slot=MAIN, n=8)
        bt.eye(gv(S, sd * 0.05, 0.47, 0.06), 0.08, [sk_], rgb=0x60ffe0)
    J = B[jaw]
    for sd in (-1, 1):
        bt.blob(gv(J, sd * 0.1, -0.03, 0.03), 0.1, 0.16, 0.05, bones=[jaw], slot=LIGHT)
    # Two huge claws, the left the larger: a spined arm, a ridged palm, a serrated fixed finger, a hinged one.
    for pc in n['pincers']:
        arm, fore, hand, finger = pc['arm'], pc['fore'], pc['hand'], pc['finger']
        A, E, Wr, Fj = B[arm], B[fore], B[hand], B[finger]
        sd = 1 if Wr.x > 0 else -1
        k = 1.18 if sd < 0 else 1.0
        bt.capsule(A, E, 0.17, 0.2, bones=[arm, fore], **shell)
        bt.capsule(E, Wr, 0.19, 0.22, bones=[fore, hand], **shell)
        for t in (0.3, 0.7):
            p = A.lerp(E, t) + G(0, 0.17, 0)
            bt.cone(p - G(0, 0.04, 0), p + G(0, 0.17, -0.05), 0.05, [arm], rgb=spike_rgb)
        palm = G(sd * 1.4, ty + 0.2, 2.2)
        bt.blob(palm, 0.28 * k, 0.4 * k, 0.6 * k, bones=[hand], **shell)
        for dz in (-0.25, 0.05, 0.3):
            p = palm + G(0, 0.37 * k, dz * k)
            bt.cone(p - G(0, 0.04, 0), p + G(sd * 0.04, 0.15 * k, -0.06), 0.05 * k, [hand], rgb=spike_rgb)
        fixed = curve([palm + G(0, -0.14 * k, 0.4 * k), palm + G(-sd * 0.05, -0.2 * k, 0.85 * k), palm + G(-sd * 0.1, -0.1 * k, 1.25 * k)], 3)
        bt.tube(fixed, lambda t: 0.15 * k * (1 - t) ** 0.8 + 0.01, [hand], slot=MAIN, n=10, squash=0.75)
        dact = curve([Fj, Fj + G(-sd * 0.03, 0.05 * k, 0.42 * k), Fj + G(-sd * 0.09, -0.12 * k, 0.82 * k)], 3)
        bt.tube(dact, lambda t: 0.14 * k * (1 - t) ** 0.8 + 0.01, [finger], slot=MAIN, n=10, squash=0.75)
        for i in range(4):
            p = Fj + G(-sd * 0.03, -0.1 * k, (0.12 + i * 0.15) * k)
            bt.cone(p, p + G(0, -0.1 * k, 0.02), 0.035, [finger], rgb=0xd8d0b8)
            q = palm + G(-sd * 0.04, -0.06 * k, (0.5 + i * 0.16) * k)
            bt.cone(q, q + G(0, 0.1 * k, 0.02), 0.035, [hand], rgb=0xd8d0b8)
    # Eight spiny walking legs.
    for leg in n['limbs']:
        up, mid, low = leg['up'], leg['mid'], leg['low']
        U, K, Fo, T = B[up], B[mid], B[low], G(*leg['foot'])
        jointed(bt, [U, K, Fo, T], [0.16, 0.13, 0.09, 0.012], [up, mid, low], slot=MAIN, n=9)
        bt.cone(K, K + G(0, 0.16, 0), 0.045, [mid], rgb=spike_rgb)
        q = K.lerp(Fo, 0.4)
        bt.cone(q, q + G(0, 0.06, 0.08), 0.03, [mid], rgb=spike_rgb)
    return bt.build(0.016, 11000, ('VORONOI', 0.06, 0.012), surface='shell'), ['shell', 'fur', 'glow']


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
    """A wraith: a hooded, skull-faced spirit in a ragged robe that ends in fluttering tatters, bony hands reaching."""
    n, B = bt.n, bt.B
    body, chest, head = n['body'], n['chest'], n['head']
    Bo, C, Hd = B[body], B[chest], B[head]
    robe = dict(fade=(0.6, 1.9, 0.45), mottle=0.2, stiff=3.5)
    # Shoulders and a robe narrowing at the waist and flaring to the hem.
    bt.blob(gv(C, 0, 0.16, -0.01), 0.25, 0.09, 0.15, bones=[chest], **robe)
    bt.capsule(gv(C, 0, 0.16, 0), gv(C, 0, -0.1, 0), 0.15, 0.17, bones=[chest], **robe)
    bt.capsule(gv(C, 0, -0.1, 0), gv(Bo, 0, 0.12, 0), 0.17, 0.2, bones=[chest, body], **robe)
    bt.capsule(gv(Bo, 0, 0.12, 0), gv(Bo, 0, -0.04, 0), 0.2, 0.25, bones=[body], **robe)
    # Folds down the skirt into each tatter.
    for st in n['strands']:
        R = B[st[0]]
        bt.capsule(Vector((R.x * 0.6, R.y * 0.6, Bo.z + 0.2)), R + Vector((0, 0, 0.02)), 0.05, 0.05, bones=[body, st[0]], **robe)
    tatters(bt, n['strands'], 0.13, 'ghost', (0.2, 1.6, 0.35))
    # The hood: a deep cowl with its face hollowed out, a peak falling back.
    bt.blob(gv(Hd, 0, 0.02, -0.02), 0.17, 0.18, 0.19, bones=[head], **robe)
    bt.capsule(gv(Hd, 0, 0.08, -0.1), gv(Hd, 0, 0.0, -0.28), 0.09, 0.03, bones=[head], **robe)
    bt.blob(gv(Hd, 0, -0.03, 0.17), 0.12, 0.14, 0.14, bones=[head], neg=True)
    bt.hard.append(('fur', _ball(gv(Hd, 0, 0.0, -0.02), 0.13, (1, 1.05, 0.9)), Part([head], slot=FIXED, rgb=0x050408)))
    skull(bt, gv(Hd, 0, -0.03, 0.02), 0.1, head, 0xcfc7ad, 0x80b0ff)
    # Sleeves and skeletal hands.
    for arm in n['arms']:
        sleeve_arm(bt, arm, 0.05, 0.12, 0xcfc7ad, robe=robe)
    return bt.build(0.0075, 7000, ('CLOUDS', 0.04, 0.006), surface='ghost'), ['ghost', 'fur', 'glow']


@builder('witch', 0x2a2440)
def witch(bt):
    """The Shade of Hecate: three faces under a spiked crown, a high collar, a gown dissolving into tatters, staff and torch."""
    n, B = bt.n, bt.B
    body, chest, head = n['body'], n['chest'], n['head']
    Bo, C, Hd = B[body], B[chest], B[head]
    gown = dict(fade=(0.2, 2.0, 0.4), mottle=0.15, stiff=3.5)
    gold, skin = 0xc8a858, 0xb8b0a0
    strands = n['strands']
    skirt, hair = strands[:12], strands[12:]
    # Bodice, a cinched waist with a gold belt, and a skirt flaring to the hem.
    bt.blob(gv(C, 0, 0.24, 0.0), 0.24, 0.08, 0.13, bones=[chest], **gown)
    bt.capsule(gv(C, 0, 0.24, 0), gv(C, 0, -0.05, 0.01), 0.14, 0.13, bones=[chest], **gown)
    for sd in (-1, 1):
        bt.blob(gv(C, sd * 0.065, 0.06, 0.08), 0.07, 0.07, 0.06, bones=[chest], **gown)
    bt.capsule(gv(C, 0, -0.05, 0.01), gv(C, 0, -0.27, 0.0), 0.13, 0.12, bones=[chest], **gown)
    bt.tube([gv(C, 0, -0.27, 0), gv(C, 0, -0.23, 0)], 0.135, [chest], surface='fur', rgb=gold, n=16)
    bt.capsule(gv(C, 0, -0.27, 0), gv(Bo, 0, 0.1, 0), 0.12, 0.3, bones=[chest, body], **gown)
    bt.capsule(gv(Bo, 0, 0.1, 0), gv(Bo, 0, -0.18, 0), 0.3, 0.38, bones=[body], **gown)
    for st in skirt:
        R = B[st[0]]
        bt.capsule(Vector((R.x * 0.75, R.y * 0.75, Bo.z + 0.05)), R + Vector((0, 0, 0.02)), 0.07, 0.07, bones=[body, st[0]], **gown)
    tatters(bt, skirt, 0.15, 'fur', (0.0, 1.0, 0.45))
    # The collar: dark spines fanning up behind the head.
    for i in range(7):
        a = (i / 6 - 0.5) * 2.6 + math.pi
        b = gv(C, math.sin(a) * 0.14, 0.3, math.cos(a) * 0.1 - 0.02)
        bt.tube([b, b + G(math.sin(a) * 0.08, 0.15, math.cos(a) * 0.08), b + G(math.sin(a) * 0.16, 0.3, math.cos(a) * 0.14 - 0.06)], lambda t: 0.045 * (1 - t) + 0.003, [chest], surface='fur', slot=DARK, n=6, squash=0.3, wide=G(math.cos(a), 0, -math.sin(a)))
    # Three faces: the maiden ahead, the mother and the crone to either side, on a veiled head.
    bt.blob(Hd, 0.14, 0.16, 0.14, bones=[head], slot=FIXED, rgb=0x18141e, stiff=3.0)
    for a, c in ((0.0, 0xe8e0d0), (2.1, skin), (-2.1, 0x8a8070)):
        d = G(math.sin(a), 0, math.cos(a))
        side = G(math.cos(a), 0, -math.sin(a))
        fc = Hd + d * 0.08
        bt.blob(fc, 0.085, 0.12, 0.07, rot=(0, a, 0), bones=[head], slot=FIXED, rgb=c, stiff=3.0)
        bt.blob(fc + d * 0.065 + G(0, -0.01, 0), 0.016, 0.03, 0.02, rot=(0, a, 0), bones=[head], slot=FIXED, rgb=c, stiff=3.0)
        for sd in (-1, 1):
            e = fc + d * 0.065 + side * sd * 0.037 + G(0, 0.03, 0)
            bt.hard.append(('fur', _ball(e, 0.02, (1, 1, 0.7)), Part([head], slot=FIXED, rgb=0x050308)))
            bt.eye(e + d * 0.008, 0.009, [head], rgb=0xb070ff)
        bt.hard.append(('fur', _ball(fc + d * 0.068 + G(0, -0.055, 0), 0.022, (1, 0.35, 0.5)), Part([head], slot=FIXED, rgb=0x3a1420)))
    # The crown: a gold band with spikes, every third set with a burning gem.
    hy = Hd.z
    bt.tube([gv(Hd, 0, 0.1, 0), gv(Hd, 0, 0.135, 0)], 0.142, [head], surface='shell', rgb=gold, n=18)
    for i in range(9):
        a = (i / 9) * math.tau
        b = gv(Hd, math.sin(a) * 0.135, 0.12, math.cos(a) * 0.135)
        tall = 0.2 if i % 3 == 0 else 0.12
        bt.cone(b, b + G(math.sin(a) * 0.04, tall, math.cos(a) * 0.04), 0.026, [head], surface='shell', rgb=gold)
        if i % 3 == 0:
            bt.eye(b + G(math.sin(a) * 0.012, 0.035, math.cos(a) * 0.012), 0.02, [head], rgb=0xb070ff)
    # A veil of dark hair down the back, on its own strands.
    for st in hair:
        pts = [B[k] for k in st]
        tip = pts[-1] + (pts[-1] - pts[-2]) * 1.15
        bt.tube(curve([pts[0], pts[1], tip], 3), lambda t: 0.07 * (1 - 0.7 * t), st, surface='fur', rgb=0x16121a, n=7, squash=0.35)
    # Long sleeves and pale hands.
    for arm in n['arms']:
        sleeve_arm(bt, arm, 0.06, 0.13, skin, robe=gown)
    # The staff in the right hand: a dark shaft, a gold crescent cradling a violet orb.
    right, left = n['arms'][0], n['arms'][1]
    W = B[right['low']]
    rl = right['low']
    bt.tube([W + G(0, -1.1, 0.04), W + G(0, 0.2, 0), W + G(0, 1.05, -0.02)], lambda t: 0.032, [rl], surface='fur', rgb=0x221830, n=8)
    top = W + G(0, 1.12, -0.02)
    bt.tube(curve([top + G(-0.17, 0.12, 0), top + G(-0.1, -0.08, 0), top + G(0, -0.14, 0), top + G(0.1, -0.08, 0), top + G(0.17, 0.12, 0)], 3), lambda t: 0.01 + 0.025 * math.sin(math.pi * t), [rl], surface='shell', rgb=gold, n=7)
    bt.eye(top + G(0, 0.06, 0), 0.075, [rl], rgb=0xb080ff)
    # The torch in the left: a wrapped haft and a tongue of violet flame.
    Wl = B[left['low']]
    ll = left['low']
    bt.tube([Wl + G(0, -0.14, 0.04), Wl + G(0, 0.28, 0.06)], lambda t: 0.022 + 0.01 * t, [ll], surface='fur', rgb=0x2a1c12, n=7)
    bt.tube(curve([Wl + G(0, 0.28, 0.06), Wl + G(0.02, 0.4, 0.06), Wl + G(-0.01, 0.56, 0.05)], 3), lambda t: 0.06 * (1 - t) ** 0.8 + 0.002, [ll], surface='glow', slot=GLOW, rgb=0x9060ff, n=8)
    return bt.build(0.008, 9000, ('CLOUDS', 0.04, 0.004), surface='fur'), ['fur', 'glow', 'shell']


@builder('reaper', 0x15131a)
def reaper(bt):
    """The Reaper: a towering hooded void with cold eyes, a ragged mantle, bony hands, a great scythe and a soul lantern."""
    n, B = bt.n, bt.B
    body, chest, head = n['body'], n['chest'], n['head']
    Bo, C, Hd = B[body], B[chest], B[head]
    robe = dict(fade=(0.3, 2.9, 0.4), mottle=0.2, stiff=3.5)
    bone, soul, iron = 0xd8d0b8, 0x70ffb0, 0x3a3a40
    strands = n['strands']
    skirt, mantle = strands[:12], strands[12:]
    # Broad shoulders, a long robe flaring to the hem.
    bt.blob(gv(C, 0, 0.24, -0.02), 0.4, 0.12, 0.24, bones=[chest], **robe)
    bt.capsule(gv(C, 0, 0.24, 0), gv(C, 0, -0.1, 0), 0.24, 0.24, bones=[chest], **robe)
    bt.capsule(gv(C, 0, -0.1, 0), gv(Bo, 0, 0.0, 0), 0.24, 0.32, bones=[chest, body], **robe)
    bt.capsule(gv(Bo, 0, 0.0, 0), gv(Bo, 0, -0.38, 0), 0.32, 0.44, bones=[body], **robe)
    for st in skirt:
        R = B[st[0]]
        bt.capsule(Vector((R.x * 0.75, R.y * 0.75, Bo.z - 0.25)), R + Vector((0, 0, 0.02)), 0.08, 0.08, bones=[body, st[0]], **robe)
    tatters(bt, skirt, 0.16, 'ghost', (0.0, 1.6, 0.35))
    tatters(bt, mantle, 0.13, 'ghost', (1.4, 3.0, 0.4))
    # The hood: deep and peaked, a void within, two cold eyes, a glimpse of jaw.
    bt.blob(gv(Hd, 0, 0.06, -0.04), 0.24, 0.25, 0.26, bones=[head], **robe)
    bt.capsule(gv(Hd, 0, 0.14, -0.14), gv(Hd, 0, 0.14, -0.5), 0.12, 0.03, bones=[head], **robe)
    bt.blob(gv(Hd, 0, 0.0, 0.18), 0.15, 0.17, 0.16, bones=[head], neg=True)
    bt.hard.append(('fur', _ball(gv(Hd, 0, 0.0, -0.02), 0.19, (1, 1.05, 0.85)), Part([head], slot=FIXED, rgb=0x020203)))
    for sd in (-1, 1):
        bt.eye(gv(Hd, sd * 0.065, 0.03, 0.12), 0.03, [head], rgb=0x90ffc0, squash=0.6)
    bt.tube([gv(Hd, 0, -0.12, 0.06), gv(Hd, 0, -0.15, 0.12)], lambda t: 0.06 - 0.015 * t, [head], surface='fur', rgb=0x7a7464, n=8, squash=0.4, wide=Vector((1, 0, 0)))
    # Sleeves and skeletal hands.
    for arm in n['arms']:
        sleeve_arm(bt, arm, 0.07, 0.16, bone, robe=robe)
    # The scythe: a long black haft bound with iron, a great curved blade with a ghostly edge.
    rl = n['arms'][0]['low']
    W = B[rl]
    bt.tube([W + G(0.02, -1.5, -0.14), W, W + G(-0.03, 2.1, 0.12)], lambda t: 0.036, [rl], surface='fur', rgb=0x241a14, n=8)
    for y in (-1.2, -0.4, 0.6, 1.5):
        bt.tube([W + G(0, y, y * 0.06), W + G(0, y + 0.08, y * 0.06)], 0.046, [rl], surface='shell', rgb=0x4a3a2a, n=8)
    T0 = W + G(-0.03, 2.12, 0.12)
    bt.tube([T0 + G(0, -0.12, 0), T0 + G(0, 0.08, 0)], 0.055, [rl], surface='shell', rgb=0x5a5a62, n=10)
    bt.cone(T0 + G(0, 0.02, -0.02), T0 + G(0, 0.18, -0.36), 0.04, [rl], surface='shell', rgb=0x5a5a62)
    spine = curve([T0 + G(0, 0.04, 0.02), T0 + G(0, 0.3, 0.7), T0 + G(0, 0.1, 1.4), T0 + G(0, -0.34, 1.85)], 4)
    wid = lambda t: 0.19 * (1 - t) ** 0.7 + 0.004
    # The blade is flat in the swing's plane: its width hangs below the spine.
    edge = [p + G(0, -wid(i / (len(spine) - 1)) * 0.95, 0) for i, p in enumerate(spine)]
    bm_pts = [a.lerp(b, 0.5) for a, b in zip(spine, edge)]
    bt.tube(bm_pts, lambda t: wid(t) * 0.5, [rl], surface='shell', rgb=0xa8b0b8, n=8, squash=0.08, wide=Vector((0, 0, 1)))
    bt.tube(edge, lambda t: 0.012 * (1 - t) + 0.002, [rl], surface='glow', slot=GLOW, rgb=soul, n=4)
    # A soul lantern swinging at the left hip.
    lp = G(0.4, 1.5, 0.14)
    bt.tube([G(0.34, 1.95, 0.08), lp + G(0, 0.16, 0)], 0.008, [body], surface='shell', rgb=iron, n=4)
    for dy in (0.13, -0.13):
        bt.tube([lp + G(0, dy - 0.01, 0), lp + G(0, dy + 0.01, 0)], 0.062, [body], surface='shell', rgb=iron, n=10)
    bt.cone(lp + G(0, 0.13, 0), lp + G(0, 0.22, 0), 0.06, [body], surface='shell', rgb=iron)
    for i in range(4):
        a = (i / 4) * math.tau + 0.4
        bt.tube([lp + G(math.sin(a) * 0.055, 0.13, math.cos(a) * 0.055), lp + G(math.sin(a) * 0.055, -0.13, math.cos(a) * 0.055)], 0.008, [body], surface='shell', rgb=iron, n=4)
    bt.eye(lp, 0.05, [body], rgb=soul, squash=1.0)
    return bt.build(0.011, 9000, ('CLOUDS', 0.06, 0.006), surface='ghost'), ['ghost', 'fur', 'glow', 'shell']


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


@builder('serpent', 0x24525e)
def serpent(bt):
    """The Leviathan: a sea serpent rearing from the waves, sail-finned, horned, glowing along its flanks; two coils and a tail behind."""
    n, B = bt.n, bt.B
    neck, head, jaw, tail, coils = n['neck'], n['head'], n['jaw'], n['tail'], n['coils']
    hide = dict(back=0.75, mottle=0.2)
    spine_rgb, ivory, bone_rgb, glow = 0x0e2a2c, 0xeae4d0, 0xd0c8a8, 0x50fff0
    nb = neck + [head]
    N = [B[k] for k in neck] + [B[head]]
    tipN = G(0, 9.9, 4.6)
    path = curve(N + [tipN], 3)
    m = len(path)

    def rad(i):
        u = i / (m - 1)
        sst = lambda a, b, x: max(0.0, min(1.0, (x - a) / (b - a))) ** 2 * (3 - 2 * max(0.0, min(1.0, (x - a) / (b - a))))
        return 1.65 - 0.95 * sst(0, 1, u) - 0.25 * sst(0.85, 1, u)

    def bone_at(p):
        return sorted(nb, key=lambda b: (B[b] - p).length)[:2]

    throat = G(0, -0.45, 1).normalized()
    for i in range(m - 1):
        bt.capsule(path[i], path[i + 1], rad(i), rad(i + 1), bones=bone_at(path[i].lerp(path[i + 1], 0.5)), belly=-0.2, under=LIGHT, **hide)
    # Belly scutes up the throat, glowing spots down the flanks, sail spines down the back.
    for i in range(1, m - 2):
        c = path[i]
        T = (path[i + 1] - path[i - 1]).normalized()
        D = (throat - T * T.dot(throat)).normalized()
        r = rad(i)
        bt.blob(c + D * r * 0.82, r * 0.25, r * 0.7, r * 0.18, rot=look(T), bones=bone_at(c), slot=LIGHT, stiff=3.0)
        if i % 2 == 0:
            for sd in (-1, 1):
                side = (G(sd, 0, 0) - T * T.x * sd).normalized()
                bt.eye(c + side * r * 0.98 - D * r * 0.15, 0.13, bone_at(c), rgb=glow)
        if i >= 2:
            b = c - D * r * 0.9
            tip = b - D * (0.5 + 0.9 * math.sin(i / m * math.pi)) - T * 0.5
            bt.cone(b + D * 0.1, tip, 0.12, bone_at(c), rgb=spine_rgb)
    # The head: an armoured skull, a long snout, heavy brows over glowing eyes, horns swept back, a fan at each cheek.
    hd = [head]
    bt.blob(G(0, 9.75, 4.25), 0.95, 0.78, 1.25, bones=hd, **hide)
    bt.capsule(G(0, 9.78, 4.9), G(0, 9.4, 6.9), 0.72, 0.24, bones=hd, belly=-0.4, under=LIGHT, **hide)
    for sd in (-1, 1):
        bt.blob(G(sd * 0.56, 10.25, 4.65), 0.44, 0.18, 0.62, rot=(0.15, 0, -sd * 0.32), bones=hd, slot=DARK)
        bt.hard.append(('fur', _ball(G(sd * 0.66, 10.0, 5.0), 0.26, (1, 1.05, 0.8)), Part(hd, slot=FIXED, rgb=0x061012)))
        bt.eye(G(sd * 0.74, 10.02, 5.1), 0.15, hd, rgb=glow, squash=1.0)
        bt.eye(G(sd * 0.18, 9.6, 6.98), 0.06, hd, rgb=0x40d0e0)
        horn = curve([G(sd * 0.45, 10.35, 4.1), G(sd * 0.85, 11.1, 3.5), G(sd * 1.1, 11.3, 2.5), G(sd * 1.05, 11.2, 1.6)], 3)
        bt.tube(horn, lambda t: 0.26 * (1 - t) ** 0.9 + 0.01, hd, surface='fur', rgb=bone_rgb, n=10)
        for i in range(4):
            bt.cone(G(sd * (0.5 - i * 0.06), 10.2 - i * 0.12, 3.7 - i * 0.32), G(sd * (0.78 - i * 0.06), 10.7 - i * 0.12, 3.3 - i * 0.34), 0.08, hd, rgb=spine_rgb)
        base = G(sd * 0.82, 9.6, 3.75)
        for t in (G(sd * 2.1, 10.7, 2.9), G(sd * 2.6, 9.8, 2.6), G(sd * 2.3, 8.8, 2.9), G(sd * 1.5, 8.3, 3.4)):
            bt.tube([base, base.lerp(t, 0.5), t], lambda u: 0.05 * (1 - u) + 0.006, hd, surface='fur', rgb=spine_rgb, n=6)
        for i in range(8):
            z, x = 5.0 + i * 0.27, sd * (0.6 - i * 0.045)
            bt.cone(G(x, 9.36, z), G(x, 8.98, z + 0.06), 0.055, hd, rgb=ivory)
        bt.tube(curve([G(sd * 0.5, 9.28, 6.5), G(sd * 0.95, 8.55, 6.7), G(sd * 1.15, 7.65, 6.4), G(sd * 1.05, 6.9, 6.0)], 3), lambda t: 0.08 * (1 - t) + 0.006, hd, surface='fur', slot=DARK, n=6)
        for g in range(3):
            pts = [G(sd * 0.98, 8.0 - g * 0.32, 2.25 - g * 0.18), G(sd * 1.04, 7.82 - g * 0.32, 1.95 - g * 0.18), G(sd * 0.98, 7.6 - g * 0.32, 1.7 - g * 0.18)]
            q = [bt.surface(p + G(sd * 1.5, 0, 0), G(-sd, 0, 0)) + G(sd * 0.02, 0, 0) for p in pts]
            bt.tube(q, lambda t: 0.035 + 0.015 * math.sin(math.pi * t), [neck[4]], surface='glow', slot=GLOW, rgb=0x40e8ff, n=4)
    bt.blob(G(0, 9.18, 5.45), 0.5, 0.12, 1.25, bones=hd, slot=FIXED, rgb=0x0a2a30)
    # The jaw.
    J = [jaw]
    bt.capsule(G(0, 9.05, 4.4), G(0, 8.98, 6.9), 0.6, 0.18, bones=J, slot=LIGHT, mottle=0.2)
    for sd in (-1, 1):
        for i in range(6):
            z, x = 5.15 + i * 0.28, sd * (0.5 - i * 0.05)
            bt.cone(G(x, 9.0, z), G(x, 9.32, z + 0.05), 0.05, J, rgb=ivory)
    for sd in (-1, 0, 1):
        bt.cone(G(sd * 0.25, 8.75, 5.2 + abs(sd) * 0.3), G(sd * 0.32, 8.3, 5.0 + abs(sd) * 0.3), 0.07, J, rgb=spine_rgb)
    # Two coils arching out of the sea, finned along their crests.
    for root, (z0, top, r0) in zip(coils, ((-10.5, 3.7, 1.45), (-19.5, 3.1, 1.25))):
        pts = [G(0, -2.8 + (top + 2.8) * math.sin(i / 10 * math.pi), z0 + 4.4 * math.cos(i / 10 * math.pi)) for i in range(11)]
        mid = G(0, -2.8, z0)
        inner = lambda v, nn, mid=mid: nn.dot((mid - v).normalized()) > 0.35
        for i in range(10):
            bt.capsule(pts[i], pts[i + 1], r0, r0, bones=[root], light=inner, **hide)
        for i in range(2, 9):
            a = i / 10 * math.pi
            out = G(0, math.sin(a), math.cos(a))
            b = pts[i] + out * r0 * 0.9
            bt.cone(b - out * 0.1, b + out * (0.7 + 0.5 * math.sin(a)) + G(0, 0, -0.4), 0.11, [root], rgb=spine_rgb)
            if i % 2 == 0:
                for sd in (-1, 1):
                    bt.eye(pts[i] + G(sd * r0 * 0.97, 0, 0), 0.12, [root], rgb=glow)
    # The tail standing up out of the water, a finned paddle at the tip.
    tp = [G(0, -3.4, -27), G(0, -0.8, -27.3), G(0, 1.8, -27.6), G(0, 4.2, -27.9), G(0, 6.2, -28.2), G(0, 7.7, -28.5)]
    rr = [1.1, 0.92, 0.74, 0.54, 0.34, 0.12]
    tb = sorted(tail, key=lambda b: B[b].z)
    for i in range(5):
        bt.capsule(tp[i], tp[i + 1], rr[i], rr[i + 1], bones=tb[max(0, i - 1):i + 2] if i < len(tb) else [tb[-1]], light=lambda v, nn: nn.y > 0.4, **hide)
    base = G(0, 6.9, -28.35)
    for t in (G(0, 10.4, -28.9), G(0, 10.0, -30.2), G(0, 8.6, -31.0), G(0, 6.8, -30.6), G(0, 5.6, -29.6)):
        bt.tube([base, base.lerp(t, 0.5), t], lambda u: 0.08 * (1 - u) + 0.01, [tb[-1]], surface='fur', rgb=spine_rgb, n=6)
    for i in range(1, 5):
        bt.cone(tp[i] + G(0, 0, -0.85 + i * 0.12), tp[i] + G(0, 0.3, -1.6 + i * 0.1), 0.12, [tb[min(i, len(tb) - 1)]], rgb=spine_rgb)
    return bt.build(0.06, 20000, ('VORONOI', 0.18, 0.03), surface='scale'), ['scale', 'glow', 'fur']


@builder('siren', 0x2f8a96)
def siren(bt):
    """Queen Nerissa: a sea queen with a scaled tail curling on the ground, a pearl bodice, coral crown, sea-dark hair and a trident."""
    n, B = bt.n, bt.B
    body, chest, head, tail = n['body'], n['chest'], n['head'], n['tail']
    Bo, C, Hd = B[body], B[chest], B[head]
    skin = dict(slot=FIXED, rgb=0xa8d4cc, stiff=3.0)
    gold, pearl, coral, spine_rgb = 0xd8b058, 0xf2eee2, 0xe86a7a, 0x1e5058
    # Torso: a slim waist rising to the shoulders, a slender neck.
    bt.capsule(gv(Bo, 0, -0.05, 0), gv(Bo, 0, 0.17, 0.01), 0.19, 0.15, bones=[body], **skin)
    bt.capsule(gv(Bo, 0, 0.17, 0.01), gv(C, 0, 0.05, 0.02), 0.15, 0.18, bones=[body, chest], **skin)
    bt.blob(gv(C, 0, 0.2, 0.0), 0.23, 0.1, 0.13, bones=[chest], **skin)
    bt.capsule(gv(C, 0, 0.25, 0.0), gv(Hd, 0, -0.06, 0.0), 0.06, 0.055, bones=[chest, head], **skin)
    for sd in (-1, 1):
        bt.hard.append(('shell', cap(gv(C, sd * 0.09, 0.03, 0.1), 0.1, 1.3, G(sd * 0.25, 0, 1), segs=16, rings=5, thick=0.012), Part([chest], slot=FIXED, rgb=pearl)))
    bt.tube([gv(Bo, 0, 0.07, 0), gv(Bo, 0, 0.01, 0)], 0.205, [body], rgb=gold, n=18, squash=0.8, wide=Vector((1, 0, 0)))
    for i in range(10):
        a = i / 10 * math.tau
        bt.hard.append(('shell', _ball(gv(Bo, math.sin(a) * 0.2, 0.04, math.cos(a) * 0.16), 0.03), Part([body], slot=FIXED, rgb=pearl)))
    for i in range(7):
        a = -0.9 + i / 6 * 1.8
        p = gv(C, math.sin(a) * 0.12, 0.24 - math.cos(a) * 0.05, 0.08 + math.cos(a) * 0.06)
        if i == 3:
            bt.eye(p + G(0, -0.03, 0.01), 0.03, [chest], rgb=0x60fff0)
        else:
            bt.hard.append(('shell', _ball(p, 0.02), Part([chest], slot=FIXED, rgb=pearl)))
    # The tail: from the hips down and curling back along the ground, banded in gold, pale beneath.
    pts = [B[t] for t in tail]
    end = pts[-1] + (pts[-1] - pts[-2]) * 0.9
    run = pts + [end]
    rr = [0.2, 0.19, 0.17, 0.145, 0.12, 0.095, 0.072, 0.05, 0.03]
    tb = [[tail[max(0, i - 1)], tail[i], tail[min(i + 1, len(tail) - 1)]] for i in range(len(tail))]
    for i in range(len(run) - 1):
        bt.capsule(run[i], run[i + 1], rr[i], rr[i + 1], bones=tb[i], belly=-0.3, under=LIGHT, back=0.7, mottle=0.15)
    for i in range(1, 7):
        a, b = run[i].lerp(run[i + 1], 0.42), run[i].lerp(run[i + 1], 0.58)
        r = lerp(rr[i], rr[i + 1], 0.5) * 1.18
        bt.tube([a, b], r, [tail[i]], rgb=0xb89a50, n=14)
    # The fluke and hip fins: rods for the membranes the game stretches between them.
    te, last = end, tail[-1]
    for sd in (-1, 1):
        for t in (G(sd * 0.12, 0.5, -0.05), G(sd * 0.45, 0.45, -0.35), G(sd * 0.66, 0.1, -0.5), G(sd * 0.5, -0.12, -0.28)):
            bt.tube([te, te.lerp(te + t, 0.5), te + t], lambda u: 0.016 * (1 - u) + 0.003, [last], surface='fur', rgb=spine_rgb, n=5)
        h = G(sd * 0.18, 1.42, -0.05)
        for t in (G(sd * 0.42, 1.48, -0.15), G(sd * 0.55, 1.24, -0.3), G(sd * 0.4, 1.02, -0.32)):
            bt.tube([h, h.lerp(t, 0.5), t], lambda u: 0.014 * (1 - u) + 0.003, [body], surface='fur', rgb=spine_rgb, n=5)
    # Arms: slender, gold-cuffed, finned at the elbow, with shell pauldrons.
    for arm in n['arms']:
        up, mid, low = arm['up'], arm['mid'], arm['low']
        S, E, W = B[up], B[mid], B[low]
        sd = 1 if W.x > 0 else -1
        bt.capsule(S, E, 0.06, 0.045, bones=[up, mid], **skin)
        bt.capsule(E, W, 0.045, 0.035, bones=[mid, low], **skin)
        bt.blob(gv(W, 0, -0.06, 0.03), 0.038, 0.055, 0.024, bones=[low], **skin)
        for f in range(4):
            k0 = gv(W, (f - 1.5) * 0.02, -0.09, 0.04)
            bt.capsule(k0, k0 + G((f - 1.5) * 0.008, -0.08, 0.03), 0.011, 0.007, bones=[low], **skin)
        bt.tube([W.lerp(E, 0.12), W.lerp(E, 0.22)], 0.05, [low], rgb=gold, n=12)
        bt.hard.append(('shell', cap(gv(S, sd * 0.03, 0.03, 0), 0.1, 1.2, G(sd * 0.6, 1, 0), segs=16, rings=5, thick=0.015), Part([up], slot=MAIN)))
        base = E + G(sd * 0.03, 0, -0.04)
        for t in (E + G(sd * 0.15, 0.05, -0.12), E + G(sd * 0.12, -0.18, -0.12), W + G(sd * 0.06, 0.04, -0.08)):
            bt.tube([base, base.lerp(t, 0.5), t], lambda u: 0.008 * (1 - u) + 0.002, [mid], surface='fur', rgb=spine_rgb, n=4)
    # The head: fine features, glowing eyes, finned ears, a gold circlet with coral branches and pearls.
    bt.blob(gv(Hd, 0, 0.03, 0.02), 0.115, 0.14, 0.12, bones=[head], **skin)
    bt.blob(gv(Hd, 0, -0.05, 0.05), 0.07, 0.06, 0.07, bones=[head], **skin)
    bt.blob(gv(Hd, 0, -0.07, 0.125), 0.03, 0.01, 0.01, bones=[head], slot=FIXED, rgb=0x3a6a70, stiff=3.0)
    for sd in (-1, 1):
        e = bt.surface(gv(Hd, sd * 0.042, 0.04, 0.6), G(0, 0, -1))
        bt.hard.append(('fur', _ball(e, 0.024, (1, 0.6, 0.5)), Part([head], slot=FIXED, rgb=0x061418)))
        bt.eye(e + G(0, 0, 0.006), 0.012, [head], rgb=0x60fff0)
        base = gv(Hd, sd * 0.1, 0.03, -0.02)
        for t in (gv(Hd, sd * 0.2, 0.16, -0.1), gv(Hd, sd * 0.24, 0.04, -0.12), gv(Hd, sd * 0.18, -0.06, -0.08)):
            bt.tube([base, base.lerp(t, 0.5), t], lambda u: 0.006 * (1 - u) + 0.0015, [head], surface='fur', rgb=spine_rgb, n=4)
    bt.tube([gv(Hd, 0, 0.1, 0), gv(Hd, 0, 0.13, 0)], 0.128, [head], rgb=gold, n=18)
    for i in range(7):
        a = -1.2 + i * 0.4
        b = gv(Hd, math.sin(a) * 0.12, 0.13, math.cos(a) * 0.11)
        out = G(math.sin(a), 0, math.cos(a))
        h = 0.34 if i == 3 else 0.22 + 0.04 * (i % 2)
        p1 = b + out * 0.04 + G(0, h * 0.55, 0)
        p2 = b + out * 0.07 + G(0, h, 0)
        bt.tube(curve([b, p1, p2], 3), lambda u: 0.018 * (1 - u) + 0.003, [head], surface='fur', rgb=coral, n=6)
        bt.tube([p1, p1 + out * 0.07 + G(0, 0.08, 0)], lambda u: 0.009 * (1 - u) + 0.002, [head], surface='fur', rgb=coral, n=5)
        bt.eye(p2, 0.017, [head], rgb=0xa0fff8 if i == 3 else 0xff9ab0)
    # Long sea-dark hair, on its own strands.
    hair = n['strands']
    bt.blob(gv(Hd, 0, 0.06, -0.04), 0.12, 0.12, 0.11, bones=[head], slot=FIXED, rgb=0x123c44, stiff=3.0)
    for st in hair:
        pts = [B[k] for k in st]
        tip = pts[-1] + (pts[-1] - pts[-2]) * 0.9
        bt.tube(curve(pts + [tip], 3), lambda u: 0.06 * (1 - 0.75 * u), st, surface='fur', rgb=0x174a52, n=7, squash=0.4)
    # The trident in her right hand.
    rl = n['arms'][0]['low']
    W = B[rl]
    bt.tube([W + G(0, -1.0, 0.03), W + G(0, 0.3, 0), W + G(0, 1.35, -0.03)], 0.028, [rl], rgb=0xb8903a, n=8)
    tp = W + G(0, 1.38, -0.03)
    bt.tube(curve([tp + G(-0.18, 0.1, 0), tp + G(-0.09, -0.04, 0), tp + G(0, -0.07, 0), tp + G(0.09, -0.04, 0), tp + G(0.18, 0.1, 0)], 3), lambda u: 0.012 + 0.016 * math.sin(math.pi * u), [rl], rgb=gold, n=7)
    for dx, h in ((0, 0.46), (-0.17, 0.36), (0.17, 0.36)):
        base = tp + G(dx, 0.08 if dx else 0, 0)
        tip = base + G(dx * 0.08, h, 0)
        bt.cone(base, tip, 0.026, [rl], rgb=gold)
        bt.cone(tip + G(0, -0.1, 0), tip + G(0.05 if dx >= 0 else -0.05, -0.16, 0), 0.012, [rl], rgb=gold)
        bt.eye(tip + G(0, -0.05, 0), 0.02, [rl], rgb=0x80fff0, squash=2.5)
    return bt.build(0.007, 11000, ('CLOUDS', 0.03, 0.002), surface='fur'), ['fur', 'shell', 'glow', 'scale']


# -------------------------------------------------------------- stone giants --
# Humanoid great foes: the game's humanoid skeleton, its surfaces numbered
# ('0' matte, '1' metal, '2' glow), coloured in fixed colours of their own.


def shard(bt, base, d, length, r, bones, rgb):
    """A crystal: a five-sided prism ending in a point."""
    d = d.normalized()
    tip = base + d * length
    bt.tube([base - d * r, base + d * length * 0.6, tip], lambda t: r if t < 0.55 else r * (1 - t) / 0.45 + 0.002, bones, surface='2', slot=GLOW, rgb=rgb, n=5, flat=True)


def stone_limbs(bt, n, B, rock, k_arm, k_leg, fist, plate=None):
    """A stone giant's arms and legs, each segment a separate hewn block: boulder shoulders, thick forearms, great fists, pillar legs, block feet."""
    plate = plate or rock
    st = dict(stiff=3.2)
    for side in ('L', 'R'):
        arm, fore, hand = n['arm' + side], n['fore' + side], n['hand' + side]
        leg, shin, foot = n['leg' + side], n['shin' + side], n['foot' + side]
        A, F, H = B[arm], B[fore], B[hand]
        sd = 1 if A.x > 0 else -1
        bt.blob(gv(A, sd * 0.04, 0.04, 0), 0.14 * k_arm, 0.12 * k_arm, 0.135 * k_arm, bones=[arm, n['chest']], group='sh' + side, **plate, **st)
        bt.capsule(gv(A, sd * 0.01, -0.04, 0), F + G(0, 0.02, 0), 0.1 * k_arm, 0.09 * k_arm, bones=[arm, fore], group='arm' + side, **rock, **st)
        bt.capsule(F + G(0, -0.02, 0), gv(H, 0, 0.04, 0), 0.105 * k_arm, 0.11 * k_arm, bones=[fore, hand], group='fore' + side, **rock, **st)
        bt.blob(gv(F, sd * 0.03, -0.1, 0.0), 0.12 * k_arm, 0.12 * k_arm, 0.12 * k_arm, bones=[fore], group='bracer' + side, **plate, **st)
        bt.blob(gv(H, 0, -0.05, 0.02), 0.11 * fist, 0.11 * fist, 0.12 * fist, bones=[hand], group='fist' + side, **rock, **st)
        for k in range(4):
            bt.blob(gv(H, (k - 1.5) * 0.048 * fist, -0.11 * fist, 0.075 * fist), 0.03 * fist, 0.04 * fist, 0.04 * fist, bones=[hand], group='fist' + side, **rock, **st)
        L, S, Ft = B[leg], B[shin], B[foot]
        bt.blob(gv(L, sd * 0.02, -0.04, 0), 0.15 * k_leg, 0.14 * k_leg, 0.15 * k_leg, bones=[n['hips'], leg], group='hip' + side, **plate, **st)
        bt.capsule(gv(L, 0, -0.08, 0), S + G(0, 0.03, 0), 0.115 * k_leg, 0.1 * k_leg, bones=[leg, shin], group='thigh' + side, **rock, **st)
        bt.blob(gv(S, 0, 0.0, 0.05), 0.085 * k_leg, 0.085 * k_leg, 0.07 * k_leg, bones=[leg, shin], group='knee' + side, **plate, **st)
        bt.capsule(S + G(0, -0.02, 0), gv(Ft, 0, 0.05, 0), 0.1 * k_leg, 0.105 * k_leg, bones=[shin, foot], group='shin' + side, **rock, **st)
        bt.blob(gv(Ft, 0, -0.02, 0.06), 0.11 * k_leg, 0.07 * k_leg, 0.17 * k_leg, bones=[foot], group='foot' + side, **plate, **st)


@builder('h-6ad1895d', 0x9a8a6a)
def colossus(bt):
    """Zephyron, the storm colossus: a sandstone giant, cracked and weathered, shot through with storm-blue crystal."""
    n, B = bt.n, bt.B
    hips, spine, chest, head = n['hips'], n['spine'], n['chest'], n['head']
    Hp, Sp, C, Hd = B[hips], B[spine], B[chest], B[head]
    sand = dict(slot=FIXED, rgb=0x9a8a6a, mottle=0.35)
    pale = dict(slot=FIXED, rgb=0xb4a482, mottle=0.3)
    blue = 0x58b4ff
    # The trunk: a great chest, a narrower waist, a belt of stone.
    st = dict(stiff=3.2)
    bt.blob(gv(C, 0, 0.04, 0.0), 0.3, 0.22, 0.2, bones=[chest], group='chest', **pale, **st)
    bt.blob(gv(C, 0, 0.12, -0.06), 0.27, 0.14, 0.18, bones=[chest], group='chest', **sand, **st)
    bt.capsule(gv(C, 0, -0.1, 0), gv(Sp, 0, -0.02, 0), 0.2, 0.17, bones=[chest, spine], group='waist', **sand, **st)
    bt.capsule(gv(Sp, 0, 0, 0), gv(Hp, 0, -0.04, 0), 0.17, 0.19, bones=[spine, hips], group='waist', **sand, **st)
    for x, y, z, r in ((0.15, 0.1, 0.17, 0.11), (-0.15, 0.1, 0.17, 0.11), (0.0, -0.05, 0.18, 0.1)):
        bt.blob(gv(C, x, y, z), r * 1.1, r * 0.95, r * 0.5, bones=[chest], group=f'plate{x}{y}', **pale, **st)
    bt.tube([gv(Hp, 0, 0.06, 0), gv(Hp, 0, 0.14, 0)], 0.24, [hips, spine], surface='0', rgb=0x6a5a40, n=12, squash=0.8, wide=Vector((1, 0, 0)))
    # A loincloth hanging front and back.
    for fz in (-1, 1):
        a = gv(Hp, 0, 0.06, fz * 0.17)
        bt.tube([a, a + G(0, -0.2, fz * 0.04), a + G(0, -0.4, fz * 0.06)], lambda t: 0.13 * (1 - 0.3 * t), [hips], surface='0', rgb=0x6a5a40, n=6, squash=0.15, wide=Vector((1, 0, 0)))
    # The head: a stone helm with no face, a glowing visor slit, a crown of crystal.
    bt.capsule(gv(C, 0, 0.18, -0.02), gv(Hd, 0, 0.02, 0), 0.1, 0.085, bones=[chest, head], group='neck', **sand, **st)
    bt.blob(gv(Hd, 0, 0.13, 0.0), 0.12, 0.14, 0.13, bones=[head], group='head', **pale, **st)
    bt.blob(gv(Hd, 0, 0.21, -0.01), 0.09, 0.05, 0.1, bones=[head], group='head', **sand, **st)
    bt.tube([gv(Hd, -0.085, 0.15, 0.13), gv(Hd, 0.085, 0.15, 0.13)], 0.016, [head], surface='2', slot=GLOW, rgb=blue, n=6)
    for x, y, z, rx, rz in ((0, 0.3, -0.02, 0, 0.0), (0.06, 0.27, -0.03, 0, -0.45), (-0.06, 0.27, -0.03, 0, 0.45), (0.03, 0.25, -0.09, -0.5, -0.2), (-0.03, 0.25, -0.09, -0.5, 0.2)):
        shard(bt, gv(Hd, x, y - 0.03, z), G(-math.sin(rz), math.cos(rz) * math.cos(rx), math.sin(rx)), 0.15, 0.03, [head], blue)
    # Arms and legs of stone.
    stone_limbs(bt, n, B, sand, 1.35, 1.3, 1.4, plate=pale)
    # Crystal growing out of shoulders, forearms, thighs and back.
    for side in ('L', 'R'):
        A, F, L = B[n['arm' + side]], B[n['fore' + side]], B[n['leg' + side]]
        sd = 1 if A.x > 0 else -1
        for dx, dy, dz, ln in ((0.12, 0.14, 0.02, 0.22), (0.18, 0.08, -0.06, 0.18), (0.05, 0.16, -0.08, 0.16)):
            shard(bt, gv(A, sd * dx, dy, dz), G(sd * (0.4 + dx), 1, dz * 2), ln, 0.045, [n['arm' + side]], blue)
        shard(bt, gv(F, sd * 0.14, -0.1, -0.04), G(sd, 0.4, -0.3), 0.14, 0.035, [n['fore' + side]], blue)
        shard(bt, gv(L, sd * 0.17, -0.12, 0.0), G(sd, 0.2, 0.1), 0.12, 0.03, [n['leg' + side]], blue)
    for x, y, rx, rz in ((0.1, 0.23, -0.7, -0.3), (-0.08, 0.26, -0.8, 0.35), (0.0, 0.13, -1.0, 0), (0.16, 0.06, -0.9, -0.6), (-0.15, 0.04, -0.9, 0.6)):
        shard(bt, gv(C, x, y, -0.2), G(-math.sin(rz) * 0.6, 0.6, -1), 0.22, 0.05, [chest], blue)
    # The storm core in the chest, cracks running out of it.
    core = bt.surface(gv(C, 0, 0.04, 0.8), G(0, 0, -1))
    bt.eye(core, 0.075, [chest], rgb=0x7ac8ff)
    for i in range(6):
        a = i / 6 * math.tau + 0.3
        pts = [bt.surface(gv(C, math.sin(a) * r, 0.04 + math.cos(a) * r, 0.8), G(0, 0, -1)) + G(0, 0, 0.004) for r in (0.07, 0.13, 0.19)]
        bt.tube(pts, lambda t: 0.012 * (1 - t) + 0.003, [chest], surface='2', slot=GLOW, rgb=blue, n=4)
    # A tattered cape hanging from the shoulders.
    cape = [k for k in range(len(B)) if bt.parent[k] == chest and abs(B[k].x) < 0.01 and B[k].y > 0.1]
    if cape:
        chain_ = [cape[0]]
        while bt.child(chain_[-1]) is not None:
            chain_.append(bt.child(chain_[-1]))
        pts = [B[k] for k in chain_]
        tip = pts[-1] + (pts[-1] - pts[-2]) * 0.6
        bt.tube(curve(pts + [tip], 3), lambda t: 0.36 * (1 + 0.15 * t) * (1 - 0.2 * t * t), chain_, surface='0', rgb=0x5a4a30, n=10, squash=0.08, wide=Vector((1, 0, 0)))
    return bt.build(0.01, 4200, ('VORONOI', 0.07, 0.016), surface='0', facet=True), ['0', '1', '2']


@builder('h-8277b566', 0x2a1c18)
def golem(bt):
    """Ignaroth, the magma golem: hunched black basalt in warm plates, molten seams, a furnace in its chest, fists like anvils."""
    n, B = bt.n, bt.B
    hips, spine, chest, head = n['hips'], n['spine'], n['chest'], n['head']
    Hp, Sp, C, Hd = B[hips], B[spine], B[chest], B[head]
    rock = dict(slot=FIXED, rgb=0x2e2420, mottle=0.3)
    plate = dict(slot=FIXED, rgb=0x6a5040, mottle=0.35)
    lava = 0xff6a20
    st = dict(stiff=3.2)
    bt.blob(gv(C, 0, 0.02, 0.02), 0.32, 0.23, 0.22, bones=[chest], group='chest', **rock, **st)
    bt.blob(gv(C, 0, 0.14, -0.1), 0.28, 0.16, 0.18, bones=[chest], group='chest', **rock, **st)
    bt.capsule(gv(C, 0, -0.1, 0), gv(Sp, 0, 0, 0), 0.21, 0.18, bones=[chest, spine], group='waist', **rock, **st)
    bt.capsule(gv(Sp, 0, 0, 0), gv(Hp, 0, -0.04, 0), 0.18, 0.2, bones=[spine, hips], group='waist', **rock, **st)
    # Plates of warm basalt over chest, back and shoulders, each its own slab.
    for i, (x, y, z, r) in enumerate(((0.14, 0.12, 0.18, 0.12), (-0.14, 0.1, 0.18, 0.12), (0.0, -0.03, 0.2, 0.11), (0.12, 0.2, -0.18, 0.13), (-0.13, 0.17, -0.2, 0.13), (0.0, 0.05, -0.24, 0.12))):
        bt.blob(gv(C, x, y, z), r * 1.15, r * 0.95, r * 0.5, bones=[chest], group=f'plate{i}', **plate, **st)
    # The head: a lump of rock sunk between the shoulders, two burning eyes and a molten mouth.
    bt.blob(gv(Hd, 0, 0.08, 0.06), 0.12, 0.11, 0.12, bones=[head], group='head', **plate, **st)
    bt.blob(gv(Hd, 0, 0.14, 0.03), 0.11, 0.05, 0.09, bones=[head], group='brow', **rock, **st)
    for sd in (-1, 1):
        e = bt.surface(gv(Hd, sd * 0.05, 0.1, 0.8), G(0, 0, -1))
        bt.eye(e + G(0, 0, 0.01), 0.024, [head], rgb=0xffa040, squash=0.6)
    m = bt.surface(gv(Hd, 0, 0.03, 0.8), G(0, 0, -1))
    bt.tube([m + G(-0.05, 0, 0.005), m + G(0, -0.008, 0.008), m + G(0.05, 0, 0.005)], 0.012, [head], surface='2', slot=GLOW, rgb=lava, n=4)
    stone_limbs(bt, n, B, rock, 1.5, 1.4, 1.95, plate=plate)
    # Molten seams over the limbs and the trunk; the furnace core.
    for side in ('L', 'R'):
        A, F, L, S = B[n['arm' + side]], B[n['fore' + side]], B[n['leg' + side]], B[n['shin' + side]]
        sd = 1 if A.x > 0 else -1
        for bone, P, dy0, dy1 in ((n['arm' + side], A, -0.05, -0.24), (n['fore' + side], F, -0.04, -0.22), (n['leg' + side], L, -0.1, -0.36), (n['shin' + side], S, -0.05, -0.3)):
            pts = [bt.surface(gv(P, sd * 0.6, dy, 0.06 + 0.03 * math.sin(dy * 30)), G(-sd, 0, 0)) + G(sd * 0.008, 0, 0) for dy in (dy0, (dy0 + dy1) / 2, dy1)]
            bt.tube(pts, lambda t: 0.014 * math.sin(math.pi * min(1, 0.15 + t)) + 0.004, [bone], surface='2', slot=GLOW, rgb=lava, n=4)
    for x, y, rz in ((0.08, 0.13, 0.6), (0.14, 0.0, -0.4), (0.05, -0.12, 0.3), (-0.1, 0.1, -0.7), (-0.13, -0.07, 0.5)):
        for fz in (1, -1):
            a = gv(C, x, y, 0.8 * fz)
            p0 = bt.surface(a, G(0, 0, -fz))
            p1 = bt.surface(a + G(math.sin(rz) * 0.1, math.cos(rz) * 0.1, 0), G(0, 0, -fz))
            bt.tube([p0 + G(0, 0, 0.006 * fz), p1 + G(0, 0, 0.006 * fz)], lambda t: 0.012, [chest], surface='2', slot=GLOW, rgb=lava, n=4)
    core = bt.surface(gv(C, 0, 0.02, 0.8), G(0, 0, -1))
    bt.eye(core, 0.08, [chest], rgb=0xffb050)
    return bt.build(0.01, 4200, ('VORONOI', 0.06, 0.018), surface='0', facet=True), ['0', '1', '2']

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
    with open(path, 'rb') as fh:
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
    with open(OUT, 'wb') as fh:
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
