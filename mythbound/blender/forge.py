"""Hard-surface pieces for the great foes: plate, blade, hull and horn.

The beasts' organic bodies are metaball clay (kit.py). The great foes are
forged instead: every piece is built as crisp, flat-shaded faces (a plate's
bevel catches the light along its edge), set on the bones it follows, in the
same pal surfaces the game reads ('0' matte, '1' metal, '2' glow for the
humanoid foes; the creatures' own surface names otherwise).

All positions are in game coordinates (x right, y up, z forward) and turned
into Blender's with G(); `rot` is (x, y, z) in radians, applied in that order.
"""

import math

import bmesh
from mathutils import Euler, Matrix, Vector

from kit import DARK, FIXED, GLOW, LIGHT, MAIN, G, Part


def _flat(bm):
    """Every face its own corners, so each shades flat (crisp facets)."""
    bmesh.ops.split_edges(bm, edges=bm.edges[:])
    for f in bm.faces:
        f.smooth = False
    return bm


def _place(bm, c, rot=(0, 0, 0)):
    """Turns the piece (built about the origin, in game axes) and moves it to c (game coordinates)."""
    m = Euler(rot, 'XYZ').to_matrix()
    for v in bm.verts:
        p = m @ Vector(v.co)
        v.co = G(p.x, p.y, p.z) + Vector(c)
    return bm


# Colours that follow the game's own tint of the creature (a kind shared by foes of several colours).
TINT = {'main': MAIN, 'light': LIGHT, 'dark': DARK}


def put(bt, bm, bones, rgb, surf='0', glow=False, **kw):
    # A creature's surfaces have names of their own (matte fur, hard shell, glow).
    if not (bt.n or {}).get('humanoid'):
        surf = {'0': 'fur', '1': 'shell', '2': 'glow'}.get(surf, surf)
    slot = GLOW if glow else TINT.get(rgb, FIXED)
    bt.hard.append((surf, _flat(bm), Part(bones, slot=slot, rgb=0xffffff if rgb in TINT else rgb, **kw)))


def gp(p, dx=0.0, dy=0.0, dz=0.0):
    """A game-space point offset from a bone's Blender position."""
    return Vector(p) + G(dx, dy, dz)


def plate(bt, c, size, bones, rgb, rot=(0, 0, 0), bevel=0.25, surf='1', glow=False, taper=1.0):
    """A bevelled box: size (w, h, d) in game axes; `taper` shrinks the top face (a wedge)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        x, y, z = v.co.x * size[0], v.co.z * size[1], -v.co.y * size[2]
        if y > 0:
            x *= taper
            z *= taper
        v.co = Vector((x, y, z))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(size) * bevel * 0.5, segments=1, affect='EDGES', profile=0.5)
    put(bt, _place(bm, c, rot), bones, rgb, surf, glow)


def hull(bt, rings, bones, rgb, sides=10, surf='1', glow=False, cap0=True, cap1=True, arc=None, wave=None):
    """
    A lofted hull through rings of (centre, rx, rz) in game coordinates (the
    ring lies across y): torsos, helms, greaves. `arc` (a0, a1) leaves it open
    (a plate that wraps part way round); `wave(a, i)` scales a ring's radius.
    """
    bm = bmesh.new()
    a0, a1 = arc if arc else (0.0, math.tau)
    closed = arc is None
    n = sides if closed else sides + 1
    layers = []
    for i, (c, rx, rz) in enumerate(rings):
        row = []
        for k in range(n):
            a = a0 + (a1 - a0) * k / sides
            w = wave(a, i) if wave else 1.0
            row.append(bm.verts.new(Vector(c) + G(math.sin(a) * rx * w, 0, math.cos(a) * rz * w)))
        layers.append(row)
    span = sides if closed else sides
    for r0, r1 in zip(layers, layers[1:]):
        for k in range(span):
            j = (k + 1) % n
            bm.faces.new([r0[k], r0[j], r1[j], r1[k]])
    if closed and cap0:
        bm.faces.new(list(reversed(layers[0])))
    if closed and cap1:
        bm.faces.new(layers[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    put(bt, bm, bones, rgb, surf, glow)


def prism(bt, a, b, r0, r1, bones, rgb, sides=6, surf='1', glow=False, squash=1.0, turn=0.0):
    """A faceted tapered limb from a to b (Blender positions), closed at both ends."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
    u = d.cross(up).normalized()
    w = d.cross(u).normalized()
    bm = bmesh.new()
    rings = []
    for p, r in ((a, r0), (b, r1)):
        rings.append([bm.verts.new(p + (u * math.cos(turn + k / sides * math.tau) + w * math.sin(turn + k / sides * math.tau) * squash) * max(r, 0.0005)) for k in range(sides)])
    for k in range(sides):
        j = (k + 1) % sides
        bm.faces.new([rings[0][k], rings[0][j], rings[1][j], rings[1][k]])
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    put(bt, bm, bones, rgb, surf, glow)


def chain(bt, pts, radii, bones, rgb, sides=6, surf='1', glow=False, squash=1.0):
    """A run of prisms through points (horns, tails, claws, spars)."""
    for i in range(len(pts) - 1):
        prism(bt, pts[i], pts[i + 1], radii[i], radii[i + 1], bones, rgb, sides, surf, glow, squash)


def spike(bt, base, tip, r, bones, rgb, sides=4, surf='1', glow=False):
    prism(bt, base, tip, r, 0.0006, bones, rgb, sides, surf, glow)


def blade(bt, base, tip, width, bones, rgb, thick=0.012, surf='0', glow=False, side=None, belly=0.45):
    """A flat leaf: a feather, a shard, a frond, a tattered strip; widest `belly` of the way along."""
    base, tip = Vector(base), Vector(tip)
    d = tip - base
    L = d.length
    d.normalize()
    s = Vector(side).normalized() if side is not None else d.cross(Vector((0, 0, 1))).normalized()
    if s.length < 0.5:
        s = Vector((1, 0, 0))
    n = d.cross(s).normalized()
    s = n.cross(d).normalized()
    mid = base + d * L * belly
    bm = bmesh.new()
    vb = bm.verts.new(base)
    vt = bm.verts.new(tip)
    vl = bm.verts.new(mid - s * width * 0.5)
    vr = bm.verts.new(mid + s * width * 0.5)
    vu = bm.verts.new(mid + n * thick)
    vd = bm.verts.new(mid - n * thick)
    for f in ((vb, vl, vu), (vb, vu, vr), (vb, vr, vd), (vb, vd, vl), (vt, vu, vl), (vt, vr, vu), (vt, vd, vr), (vt, vl, vd)):
        bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    put(bt, bm, bones, rgb, surf, glow)


def dome(bt, c, r, bones, rgb, axis=(0, 1, 0), theta=1.4, thick=0.01, segs=12, rings=4, surf='1', glow=False, squash=(1, 1, 1)):
    """A faceted spherical cap (pauldrons, knee cops, helm crowns); `squash` scales it in game axes."""
    bm = bmesh.new()
    q = Vector((0, 1, 0)).rotation_difference(Vector(axis).normalized())
    layers = []
    for rr in ((r, r - thick) if thick else (r,)):
        layer = [[]]
        layer[0] = [Vector((0, rr, 0))]
        for i in range(1, rings + 1):
            th = theta * i / rings
            layer.append([Vector((math.sin(th) * math.cos(a) * rr, math.cos(th) * rr, math.sin(th) * math.sin(a) * rr)) for a in (k / segs * math.tau for k in range(segs))])
        layers.append(layer)
    made = []
    for layer in layers:
        vs = [[bm.verts.new(G(*(q @ Vector((p.x * squash[0], p.y * squash[1], p.z * squash[2])))) + Vector(c)) for p in ring] for ring in layer]
        made.append(vs)
    for li, vs in enumerate(made):
        flip = li == 1
        pole = vs[0][0]
        for k in range(segs):
            f = [pole, vs[1][(k + 1) % segs], vs[1][k]]
            bm.faces.new(f[::-1] if flip else f)
        for a, b in zip(vs[1:], vs[2:]):
            for k in range(segs):
                f = [a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]]
                bm.faces.new(f[::-1] if flip else f)
    if thick:
        o, i_ = made[0][-1], made[1][-1]
        for k in range(segs):
            bm.faces.new([o[k], i_[k], i_[(k + 1) % segs], o[(k + 1) % segs]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    put(bt, bm, bones, rgb, surf, glow)


def ring(bt, c, r, bones, rgb, width=0.02, thick=0.01, axis=(0, 1, 0), segs=16, surf='1', glow=False, arc=None):
    """A flat band round an axis (trims, collars, glowing rims)."""
    a0, a1 = arc if arc else (0.0, math.tau)
    closed = arc is None
    q = Vector((0, 1, 0)).rotation_difference(Vector(axis).normalized())
    bm = bmesh.new()
    n = segs if closed else segs + 1
    quads = []
    for k in range(n):
        a = a0 + (a1 - a0) * k / segs
        pts = []
        for dr, dy in ((0, -width / 2), (0, width / 2), (thick, width / 2), (thick, -width / 2)):
            p = Vector((math.sin(a) * (r + dr), dy, math.cos(a) * (r + dr)))
            pts.append(bm.verts.new(G(*(q @ p)) + Vector(c)))
        quads.append(pts)
    for k in range(segs if closed else segs):
        j = (k + 1) % n
        for e in range(4):
            f = (e + 1) % 4
            bm.faces.new([quads[k][e], quads[k][f], quads[j][f], quads[j][e]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    put(bt, bm, bones, rgb, surf, glow)


def gem(bt, c, r, bones, rgb, surf='2', glow=True, stretch=1.0):
    """A cut stone or a glowing eye: an octahedron, stretched up."""
    bm = bmesh.new()
    vs = [bm.verts.new(Vector(c) + G(*p)) for p in ((r, 0, 0), (-r, 0, 0), (0, r * stretch, 0), (0, -r * stretch, 0), (0, 0, r), (0, 0, -r))]
    for f in ((0, 2, 4), (4, 2, 1), (1, 2, 5), (5, 2, 0), (4, 3, 0), (1, 3, 4), (5, 3, 1), (0, 3, 5)):
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    put(bt, bm, bones, rgb, surf, glow)


def ribbon(bt, pts, widths, side, bones, rgb, thick=0.008, surf='0', glow=False, jag=None):
    """A strip of cloth (or a membrane) through points, `side` its width direction; `jag` notches the free end."""
    pts = [Vector(p) for p in pts]
    s = Vector(side).normalized()
    bm = bmesh.new()
    rows = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        n = d.cross(s).normalized()
        w = widths[i] if isinstance(widths, (list, tuple)) else widths
        rows.append([bm.verts.new(p + s * w * 0.5 + n * thick * h) for h in (1, -1)] + [bm.verts.new(p - s * w * 0.5 + n * thick * h) for h in (-1, 1)])
    for r0, r1 in zip(rows, rows[1:]):
        for e in range(4):
            f = (e + 1) % 4
            bm.faces.new([r0[e], r0[f], r1[f], r1[e]])
    bm.faces.new(list(reversed(rows[0])))
    bm.faces.new(rows[-1])
    if jag:
        # A torn end: the last row's middle pulled down into a point.
        last = rows[-1]
        tip = (pts[-1] - pts[-2]).normalized() * jag
        for v in last:
            v.co += tip * 0.0
        bm.verts.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    put(bt, bm, bones, rgb, surf, glow)


def loft(bt, pts, rx, ry, bones, rgb, sides=8, surf='fur', glow=False, roll=0.0, **kw):
    """A faceted body along a path (Blender points): each ring stands across the path, `rx` wide and `ry` tall."""
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    rows = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1))
        s = t.cross(up)
        s = s.normalized() if s.length > 1e-4 else Vector((1, 0, 0))
        u = s.cross(t).normalized()
        a_ = rx[i] if isinstance(rx, (list, tuple)) else rx
        b_ = ry[i] if isinstance(ry, (list, tuple)) else ry
        rows.append([bm.verts.new(p + s * math.cos(roll + k / sides * math.tau) * a_ + u * math.sin(roll + k / sides * math.tau) * b_) for k in range(sides)])
    for r0, r1 in zip(rows, rows[1:]):
        for k in range(sides):
            j = (k + 1) % sides
            bm.faces.new([r0[k], r0[j], r1[j], r1[k]])
    bm.faces.new(list(reversed(rows[0])))
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    put(bt, bm, bones, rgb, surf, glow, **kw)
