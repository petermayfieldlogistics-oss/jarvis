"""Mythbound's weapons and shield, modelled in Blender.

Run headless (Blender as a Python module, or `blender -b -P`):

    python blender/weapons.py            # writes src/assets/weapons.glb
    python blender/weapons.py --preview  # also renders blender/preview/weapons.png

Every weapon is one object named after its weapon id, with its origin at the
grip. Axes follow the game once exported (glTF is Y-up): the weapon runs up
Blender's +Z (the game's +Y), a sword's flat faces Blender's +-Y and its
edges +-X, and an axe's edge (or a hammer's face) points down Blender's -Y
(the game's +Z). The shield faces -Y. Sizes match the old hand-built models,
so grips, trails and rune spots line up.
"""

import math
import os
import sys

import bpy  # noqa: I001 (bpy first: it loads bmesh and mathutils)
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'assets', 'weapons.glb')
TAU = math.tau

# ------------------------------------------------------------- materials --

_mats = {}


def mat(name, color, metal=0.0, rough=0.6, emit=None, strength=0.0):
    """A Principled material (the glTF exporter turns it into MeshStandardMaterial)."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*srgb(color), 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit is not None:
        b.inputs['Emission Color'].default_value = (*srgb(emit), 1)
        b.inputs['Emission Strength'].default_value = strength
    _mats[name] = m
    return m


def srgb(hexcolor):
    """0xRRGGBB (as picked by eye) to linear RGB."""
    out = []
    for shift in (16, 8, 0):
        c = ((hexcolor >> shift) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


def palette():
    return {
        'steel': mat('steel', 0xc8ccd2, 0.5, 0.32),
        'edge': mat('edge', 0xe4e8ee, 0.55, 0.22),
        'dark': mat('darksteel', 0x5e6268, 0.45, 0.45),
        'iron': mat('iron', 0x4a4846, 0.4, 0.5),
        'forged': mat('forged', 0x8a8e94, 0.45, 0.42),
        'brass': mat('brass', 0xc09848, 0.55, 0.35),
        'gold': mat('gold', 0xe0b850, 0.6, 0.28),
        'silver': mat('silver', 0xd8dce4, 0.6, 0.25),
        'leather': mat('leather', 0x4a301c, 0.0, 0.85),
        'cord': mat('cord', 0x2a1c12, 0.0, 0.9),
        'wood': mat('wood', 0x6e4e30, 0.0, 0.8),
        'ash': mat('ashwood', 0xa88a5a, 0.0, 0.75),
        'oak': mat('oak', 0x5a3e24, 0.0, 0.85),
        'ebony': mat('ebony', 0x1e1820, 0.1, 0.5),
        'bone': mat('bone', 0xd8d0b8, 0.0, 0.65),
        'black': mat('blacksteel', 0x34323e, 0.35, 0.35),
        'ruby': mat('ruby', 0xa8121e, 0.2, 0.15, 0x400408, 0.6),
        'chitin': mat('chitin', 0x2e3a1e, 0.2, 0.4),
        'teal': mat('teal', 0x2a6a7a, 0.4, 0.35),
        'soul': mat('soul', 0x70ffb0, 0.0, 0.4, 0x40ff90, 4.0),
        'fire': mat('fireglow', 0xffa040, 0.0, 0.4, 0xff6a10, 4.0),
        'sea': mat('seaglow', 0x8ae8ff, 0.0, 0.2, 0x2ab8ff, 3.5),
        'venom': mat('venomglow', 0x9aff40, 0.0, 0.4, 0x60ff20, 3.0),
        'moon': mat('moonglow', 0xc8a0ff, 0.0, 0.3, 0x9a60ff, 4.0),
        'bolt': mat('boltglow', 0xe8f4ff, 0.0, 0.3, 0x9ad0ff, 6.0),
        'leaf': mat('leafglow', 0x9aff9a, 0.0, 0.3, 0x40e060, 3.0),
        'red': mat('redcloth', 0x7a1e18, 0.0, 0.8),
        'shieldwood': mat('shieldwood', 0x5a3e26, 0.0, 0.85),
    }


# --------------------------------------------------------------- meshes --


class Part:
    """Geometry gathered into one bmesh per weapon, each face tagged with its material."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def mark(self):
        """Where the next vertex will go: hand it to shift() to move what is made after it."""
        return len(self.bm.verts)

    def shift(self, mark, offset=Vector(), rot=None):
        self.bm.verts.ensure_lookup_table()
        for v in self.bm.verts[mark:]:
            v.co = (rot @ v.co if rot else v.co) + offset

    def mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def ring_loft(self, rings, m, cap0=True, cap1=True, smooth=True, close=True):
        """Quads between rings of points (each a list of Vectors, the same count); caps the ends."""
        bm = self.bm
        idx = self.mi(m)
        verts = [[bm.verts.new(p) for p in r] for r in rings]
        n = len(rings[0])
        faces = []
        for a, b in zip(verts, verts[1:]):
            for i in range(n if close else n - 1):
                j = (i + 1) % n
                quad = [a[i], a[j], b[j], b[i]]
                if len({v.co.to_tuple(6) for v in quad}) < 3:
                    continue
                try:
                    faces.append(bm.faces.new(quad))
                except ValueError:
                    pass
        if cap0 and close and n > 2:
            faces.append(self._cap(verts[0], reverse=True))
        if cap1 and close and n > 2:
            faces.append(self._cap(verts[-1]))
        for f in faces:
            if f is None:
                continue
            f.material_index = idx
            f.smooth = smooth
        return faces

    def _cap(self, ring, reverse=False):
        pts = {v.co.to_tuple(6) for v in ring}
        if len(pts) < 3:
            return None
        try:
            return self.bm.faces.new(list(reversed(ring)) if reverse else ring)
        except ValueError:
            return None

    def build(self, smooth_angle=0.6):
        me = bpy.data.meshes.new(self.name)
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(ob)
        # Smooth where it curves, sharp where it creases (a blade's ridge, an edge).
        if hasattr(me, 'set_sharp_from_angle'):
            me.set_sharp_from_angle(angle=smooth_angle)
        return ob


def circle(r, n=12, z=0.0, sx=1.0, sy=1.0, phase=0.0):
    return [Vector((math.cos(phase + i / n * TAU) * r * sx, math.sin(phase + i / n * TAU) * r * sy, z)) for i in range(n)]


def frames(path):
    """Parallel-transport frames along a polyline: (point, tangent, normal, binormal)."""
    out = []
    t0 = (path[1] - path[0]).normalized()
    up = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    nrm = t0.cross(up).normalized()
    for i, p in enumerate(path):
        a = path[max(0, i - 1)]
        b = path[min(len(path) - 1, i + 1)]
        t = (b - a).normalized()
        nrm = (nrm - t * nrm.dot(t)).normalized()
        out.append((p, t, nrm, t.cross(nrm).normalized()))
    return out


def tube(part, path, radius, m, n=10, cap=True, smooth=True, squash=1.0):
    """A tube along a 3D polyline; radius is a number or a function of t in 0..1."""
    path = [Vector(p) for p in path]
    rings = []
    for k, (p, t, nn, bn) in enumerate(frames(path)):
        r = radius(k / (len(path) - 1)) if callable(radius) else radius
        rings.append([p + (nn * math.cos(i / n * TAU) + bn * math.sin(i / n * TAU) * squash) * max(r, 1e-4) for i in range(n)])
    part.ring_loft(rings, m, cap, cap, smooth)


def cyl(part, r0, r1, z0, z1, m, n=12, x=0.0, y=0.0, smooth=True):
    """An upright cylinder (or frustum) from z0 to z1."""
    rings = [[v + Vector((x, y, 0)) for v in circle(r0, n, z0)], [v + Vector((x, y, 0)) for v in circle(r1, n, z1)]]
    part.ring_loft(rings, m, True, True, smooth)


def lathe(part, profile, m, n=16, x=0.0, y=0.0, smooth=True, axis='z'):
    """A shape turned round an axis from (radius, height) pairs."""
    rings = []
    for r, h in profile:
        ring = circle(max(r, 1e-4), n, h)
        if axis == 'y':
            ring = [Vector((v.x, h, v.y)) for v in ring]
        rings.append([v + Vector((x, y, 0)) for v in ring])
    part.ring_loft(rings, m, True, True, smooth)


def ball(part, r, c, m, sx=1.0, sy=1.0, sz=1.0, n=12):
    rings = []
    for k in range(1, n // 2):
        a = k / (n // 2) * math.pi
        rings.append([Vector((c[0] + math.cos(i / n * TAU) * math.sin(a) * r * sx, c[1] + math.sin(i / n * TAU) * math.sin(a) * r * sy, c[2] + math.cos(a) * r * sz)) for i in range(n)])
    bm = part.bm
    idx = part.mi(m)
    top = bm.verts.new((c[0], c[1], c[2] + r * sz))
    bot = bm.verts.new((c[0], c[1], c[2] - r * sz))
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new([top, vr[0][j], vr[0][i]]))
        faces.append(bm.faces.new([bot, vr[-1][i], vr[-1][j]]))
    for a, b in zip(vr, vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new([a[i], a[j], b[j], b[i]]))
    for f in faces:
        f.material_index = idx
        f.smooth = True


def wrap(part, r, z0, z1, m, turns=7, wire=0.0055):
    """Cord wound round a grip."""
    pts = []
    steps = turns * 14
    for k in range(steps + 1):
        a = k / steps * turns * TAU
        pts.append((math.cos(a) * r, math.sin(a) * r, z0 + (z1 - z0) * k / steps))
    tube(part, pts, wire, m, 6)


def blade(part, stations, m, fuller=None, ridge=1.0):
    """
    A forged blade lofted through cross-sections. Each station is
    (z, half-width, half-thickness, x-offset). A blade has a raised spine and
    sharp edges; a fuller (a groove) runs down each face where fuller=(m, z1).
    """
    rings = []
    for z, w, t, ox in stations:
        f = 0.38 * w
        depth = t * 0.45 if fuller and z < fuller[1] else t * ridge
        rings.append([Vector(p) for p in [
            (ox - w, 0, z), (ox - f, t, z), (ox, depth, z), (ox + f, t, z),
            (ox + w, 0, z), (ox + f, -t, z), (ox, -depth, z), (ox - f, -t, z)]])
    part.ring_loft(rings, m, True, True, smooth=False)


def slab(part, outline, thick, m, edge=lambda u, v: False, axis='y', sharp=0.003, smooth=False):
    """
    A flat plate from a 2D outline (u across, v up). It is `thick` through,
    thinning to a sharp edge at the points `edge` picks. axis 'y' lays u
    along Blender -Y (an axe's edge, the game's +Z); 'x' lays it along +X.
    """
    def place(u, v, d):
        return Vector((u, d, v)) if axis == 'x' else Vector((d, -u, v))
    front = [place(u, v, (sharp if edge(u, v) else thick) / 2) for u, v in outline]
    back = [place(u, v, -(sharp if edge(u, v) else thick) / 2) for u, v in outline]
    bm = part.bm
    idx = part.mi(m)
    fv = [bm.verts.new(p) for p in front]
    bv = [bm.verts.new(p) for p in back]
    faces = [bm.faces.new(fv), bm.faces.new(list(reversed(bv)))]
    n = len(fv)
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new([fv[i], bv[i], bv[j], fv[j]]))
    for f in faces:
        f.material_index = idx
        f.smooth = smooth
    bmesh.ops.triangulate(bm, faces=faces[:2])


def box(part, size, c, m):
    sx, sy, sz = (s / 2 for s in size)
    pts = [[Vector((c[0] + x, c[1] + y, c[2] + z)) for x, y in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy))] for z in (-sz, sz)]
    part.ring_loft(pts, m, True, True, smooth=False)


def spike(part, r, z0, z1, m, n=6, x=0.0, y=0.0):
    cyl(part, r, 0.0005, z0, z1, m, n, x, y, smooth=False)


def mirror_x(fn):
    for s in (-1, 1):
        fn(s)


# ---------------------------------------------------------------- swords --


def sword_grip(p, P, z0, z1, r0, r1, wrapm='cord'):
    cyl(p, r0, r1, z0, z1, P['leather'], 12)
    wrap(p, (r0 + r1) / 2 + 0.002, z0 + 0.012, z1 - 0.012, P[wrapm], turns=max(4, int((z1 - z0) / 0.03)))


def iron_sword(P):
    p = Part('iron-sword')
    sword_grip(p, P, -0.1, 0.1, 0.024, 0.021)
    # A wheel pommel set with a stone on each face.
    k = p.mark()
    lathe(p, [(0.0, -0.016), (0.044, -0.016), (0.05, -0.01), (0.05, 0.01), (0.044, 0.016), (0.0, 0.016)], P['brass'], 16, axis='y')
    p.shift(k, Vector((0, 0, -0.15)))
    for s in (-1, 1):
        ball(p, 0.018, (0, s * 0.016, -0.15), P['ruby'], sy=0.5)
    cyl(p, 0.022, 0.03, -0.13, -0.1, P['brass'])
    # The cross-guard: a block, arms swept toward the blade, ball ends.
    box(p, (0.07, 0.05, 0.04), (0, 0, 0.112), P['brass'])
    tube(p, [(-0.17, 0, 0.15), (-0.11, 0, 0.125), (-0.04, 0, 0.112), (0.04, 0, 0.112), (0.11, 0, 0.125), (0.17, 0, 0.15)], lambda t: 0.012 + 0.006 * math.sin(math.pi * t), P['brass'], 8)
    for s in (-1, 1):
        ball(p, 0.022, (s * 0.172, 0, 0.152), P['brass'])
    blade(p, [(0.13, 0.038, 0.009, 0), (0.25, 0.037, 0.0085, 0), (0.85, 0.032, 0.0075, 0), (1.05, 0.026, 0.0068, 0), (1.17, 0.013, 0.005, 0), (1.225, 0.0005, 0.001, 0)], P['steel'], fuller=(P['steel'], 0.95))
    return p


def steel_longsword(P):
    p = Part('steel-longsword')
    sword_grip(p, P, -0.17, 0.1, 0.024, 0.021)
    lathe(p, [(0.0, -0.245), (0.018, -0.24), (0.03, -0.215), (0.026, -0.19), (0.02, -0.175), (0.0, -0.17)], P['dark'], 12)
    tube(p, [(-0.2, 0, 0.12), (-0.1, 0, 0.112), (0, 0, 0.11), (0.1, 0, 0.112), (0.2, 0, 0.12)], lambda t: 0.011 + 0.004 * math.sin(math.pi * t), P['dark'], 8)
    for s in (-1, 1):
        k = p.mark()
        lathe(p, [(0.0, -0.025), (0.016, -0.015), (0.016, 0.01), (0.0, 0.022)], P['dark'], 8, x=s * 0.205)
        p.shift(k, Vector((0, 0, 0.122)))
    box(p, (0.05, 0.04, 0.03), (0, 0, 0.11), P['dark'])
    blade(p, [(0.125, 0.034, 0.0085, 0), (0.3, 0.033, 0.008, 0), (1.0, 0.027, 0.007, 0), (1.22, 0.016, 0.0055, 0), (1.33, 0.006, 0.003, 0), (1.35, 0.0005, 0.001, 0)], P['steel'], fuller=(P['steel'], 1.05))
    return p


def iron_greatsword(P):
    p = Part('iron-greatsword')
    sword_grip(p, P, -0.29, 0.08, 0.027, 0.024)
    lathe(p, [(0.0, -0.37), (0.02, -0.365), (0.036, -0.335), (0.03, -0.3), (0.022, -0.29), (0.0, -0.285)], P['dark'], 12)
    # A long straight guard with drooping ends, a ricasso and parrying lugs.
    tube(p, [(-0.27, 0, 0.07), (-0.22, 0, 0.1), (-0.1, 0, 0.11), (0.1, 0, 0.11), (0.22, 0, 0.1), (0.27, 0, 0.07)], lambda t: 0.014 + 0.006 * math.sin(math.pi * t), P['dark'], 8)
    box(p, (0.08, 0.06, 0.05), (0, 0, 0.1), P['dark'])
    blade(p, [(0.125, 0.028, 0.011, 0), (0.24, 0.028, 0.011, 0)], P['forged'])
    for s in (-1, 1):
        lug = [(0.028, 0.24), (0.06, 0.25), (0.07, 0.27), (0.05, 0.285), (0.028, 0.28)]
        slab(p, lug if s > 0 else [(-u, v) for u, v in reversed(lug)], 0.012, P['forged'], axis='x')
    blade(p, [(0.28, 0.056, 0.011, 0), (0.5, 0.054, 0.0105, 0), (1.4, 0.046, 0.009, 0), (1.66, 0.032, 0.007, 0), (1.78, 0.012, 0.004, 0), (1.82, 0.0005, 0.001, 0)], P['steel'], fuller=(P['steel'], 1.3))
    return p


def sword_of_mars(P):
    p = Part('sword-of-mars')
    sword_grip(p, P, -0.1, 0.1, 0.025, 0.022, wrapm='gold')
    cyl(p, 0.022, 0.032, -0.13, -0.1, P['gold'])
    ball(p, 0.034, (0, 0, -0.15), P['ruby'])
    # Wings of flame for a guard, sweeping up beside the blade.
    for s in (-1, 1):
        tube(p, [(0, 0, 0.11), (s * 0.06, 0, 0.11), (s * 0.12, 0, 0.13), (s * 0.16, 0, 0.17), (s * 0.165, 0, 0.22), (s * 0.14, 0, 0.26)], lambda t: 0.018 * (1 - t) + 0.003, P['gold'], 8)
        tube(p, [(s * 0.04, 0, 0.115), (s * 0.085, 0, 0.14), (s * 0.1, 0, 0.19), (s * 0.085, 0, 0.23)], lambda t: 0.011 * (1 - t) + 0.002, P['gold'], 8)
    ball(p, 0.03, (0, 0, 0.12), P['gold'], sx=1.4, sy=0.8, sz=0.8)
    for s in (-1, 1):
        ball(p, 0.016, (0, s * 0.022, 0.12), P['ruby'], sy=0.5)
    blade(p, [(0.14, 0.042, 0.0095, 0), (0.3, 0.046, 0.0095, 0), (0.85, 0.04, 0.008, 0), (1.08, 0.03, 0.007, 0), (1.2, 0.012, 0.004, 0), (1.26, 0.0005, 0.001, 0)], P['gold'], fuller=(P['gold'], 1.02))
    # The war god's fire burns down the fuller.
    for s in (-1, 1):
        k = p.mark()
        slab(p, [(-0.007, 0.18), (0.007, 0.18), (0.005, 1.0), (0, 1.04), (-0.005, 1.0)], 0.001, P['fire'], axis='x')
        p.shift(k, Vector((0, s * 0.0047, 0)))
    return p


def reapers_edge(P):
    p = Part('reapers-edge')
    # A black blade hooking at its point like the scythe it was forged from.
    edge = [(-0.032, 0.13), (-0.034, 0.45), (-0.037, 0.8), (-0.042, 0.95), (-0.052, 1.04), (-0.072, 1.1), (-0.1, 1.125), (-0.125, 1.11)]
    back = [(-0.148, 1.065), (-0.137, 1.14), (-0.11, 1.195), (-0.075, 1.225), (-0.03, 1.22), (0.005, 1.17), (0.025, 1.08), (0.03, 0.95), (0.028, 0.13)]
    outline = edge + back
    sharp = {pt for pt in edge[1:]} | {back[0]}
    slab(p, outline, 0.018, P['black'], edge=lambda u, v: (u, v) in sharp, axis='x', sharp=0.004)
    # The souls it reaped light the edge.
    glow = [(x + 0.012, y) for x, y in edge[1:7]] + [(x + 0.004, y) for x, y in reversed(edge[1:7])]
    for s in (-1, 1):
        k = p.mark()
        slab(p, glow, 0.001, P['soul'], axis='x')
        p.shift(k, Vector((0, s * 0.0072, 0)))
    # A bone guard, a grip of vertebrae, and a skull whose eyes still glow.
    tube(p, [(-0.12, 0, 0.19), (-0.08, 0, 0.128), (-0.03, 0, 0.104), (0.03, 0, 0.104), (0.08, 0, 0.128), (0.12, 0, 0.19)], lambda t: 0.005 + 0.02 * math.sin(math.pi * t), P['bone'], 10, squash=0.8)
    cyl(p, 0.016, 0.016, -0.11, 0.1, P['black'], 8)
    for i in range(5):
        z = -0.08 + i * 0.04
        lathe(p, [(0.0, z - 0.013), (0.022, z - 0.012), (0.026, z), (0.022, z + 0.012), (0.0, z + 0.013)], P['bone'], 10)
        box(p, (0.064, 0.012, 0.008), (0, 0, z), P['bone'])
    ball(p, 0.034, (0, 0, -0.15), P['bone'], sx=0.95, sy=1.05, sz=1.0, n=14)
    box(p, (0.036, 0.03, 0.02), (0, -0.008, -0.18), P['bone'])
    for s in (-1, 1):
        ball(p, 0.009, (s * 0.013, -0.027, -0.146), P['soul'])
        ball(p, 0.012, (0, s * 0.016, 0.104), P['soul'], sy=0.5)
    return p


def duelist_saber(P):
    p = Part('duelist-saber')
    bend = lambda z: 0.062 * max(0.0, z - 0.12) ** 2
    st = []
    for i in range(9):
        z = 0.12 + i * 0.13
        w = 0.021 * (1 - i * 0.03)
        st.append((min(z, 1.2), w if i < 8 else 0.0005, 0.006 if i < 8 else 0.001, bend(z) + 0.004))
    st[-1] = (1.23, 0.0005, 0.001, bend(1.23))
    blade(p, st, P['steel'], fuller=(P['steel'], 0.9))
    sword_grip(p, P, -0.1, 0.1, 0.022, 0.019, wrapm='brass')
    tube(p, [(-0.02, 0, 0.108), (-0.06, 0, 0.1), (-0.086, 0, 0.04), (-0.08, 0, -0.05), (-0.05, 0, -0.118), (-0.012, 0, -0.135)], 0.0085, P['brass'], 8)
    tube(p, [(0.02, 0, 0.108), (0.06, 0, 0.115), (0.084, 0, 0.142), (0.078, 0, 0.168), (0.062, 0, 0.162)], lambda t: 0.0085 - t * 0.003, P['brass'], 8)
    box(p, (0.055, 0.038, 0.028), (-0.002, 0, 0.108), P['brass'])
    ball(p, 0.023, (0, 0, -0.14), P['brass'], sz=0.8)
    return p


# --------------------------------------------------------------- daggers --


def shadow_dagger(P):
    p = Part('shadow-dagger')
    sword_grip(p, P, -0.065, 0.065, 0.02, 0.018)
    ball(p, 0.022, (0, 0, -0.085), P['dark'])
    tube(p, [(-0.06, 0, 0.09), (-0.03, 0, 0.075), (0.03, 0, 0.075), (0.06, 0, 0.09)], lambda t: 0.007 + 0.005 * math.sin(math.pi * t), P['dark'], 8)
    blade(p, [(0.08, 0.026, 0.006, 0), (0.15, 0.027, 0.006, 0), (0.38, 0.02, 0.005, 0), (0.47, 0.009, 0.003, 0), (0.5, 0.0005, 0.001, 0)], P['black'], fuller=(P['black'], 0.36))
    return p


def venomfang(P):
    p = Part('venomfang')
    sword_grip(p, P, -0.065, 0.065, 0.021, 0.018)
    ball(p, 0.024, (0, 0, -0.088), P['chitin'], sz=1.2)
    # A curved fang of chitin, green at the tip where the venom wells.
    st = []
    for i in range(8):
        z = 0.08 + i * 0.06
        st.append((z, 0.03 * (1 - i / 8) + 0.002, 0.007 * (1 - i / 10), -0.08 * (i / 7) ** 2))
    st[-1] = (0.5, 0.0005, 0.001, -0.08)
    blade(p, st[:6], P['bone'])
    blade(p, st[5:], P['venom'])
    lathe(p, [(0.0, 0.055), (0.03, 0.058), (0.036, 0.072), (0.028, 0.086), (0.0, 0.088)], P['chitin'], 10)
    for s in (-1, 1):
        tube(p, [(0, 0, 0.07), (s * 0.04, 0, 0.075), (s * 0.06, 0, 0.1), (s * 0.055, 0, 0.12)], lambda t: 0.008 * (1 - t) + 0.002, P['chitin'], 6)
    return p


# ------------------------------------------------------------------ axes --


def haft(p, P, z0, z1, r0, r1, grip0, grip1, wood='wood'):
    cyl(p, r0, r1, z0, z1, P[wood], 12)
    cyl(p, r0 + 0.006, r0 + 0.006, grip0, grip1, P['leather'], 12)
    wrap(p, r0 + 0.008, grip0 + 0.01, grip1 - 0.01, P['cord'], turns=6)


def iron_axe(P):
    p = Part('iron-axe')
    haft(p, P, -0.11, 0.91, 0.032, 0.026, -0.1, 0.06)
    cyl(p, 0.03, 0.036, -0.14, -0.1, P['dark'])
    # A bearded head: a forged body, a bright ground edge, a dark cheek, a spike behind.
    inner = [(0.17, 0.565), (0.215, 0.595), (0.26, 0.66), (0.285, 0.75), (0.285, 0.83), (0.26, 0.895), (0.215, 0.935)]
    arc = [(0.24, 0.975), (0.29, 0.925), (0.322, 0.84), (0.322, 0.74), (0.292, 0.64), (0.24, 0.56), (0.18, 0.515)]
    body = [(0.02, 0.69), (0.06, 0.68), (0.1, 0.64), (0.14, 0.585)] + inner + [(0.16, 0.948), (0.08, 0.925), (0.02, 0.91)]
    slab(p, body, 0.03, P['forged'])
    bit = arc + list(reversed(inner))
    slab(p, bit, 0.024, P['edge'], edge=lambda u, v: (u, v) in set(arc[1:-1]), sharp=0.002)
    slab(p, [(0.02, 0.69), (0.12, 0.675), (0.16, 0.8), (0.12, 0.925), (0.02, 0.9)], 0.046, P['dark'])
    box(p, (0.072, 0.09, 0.17), (0, 0, 0.8), P['dark'])
    spike(p, 0.03, 0.91, 0.99, P['dark'])
    # The back spike points toward the game's -Z (Blender +Y).
    tube(p, [(0, 0.04, 0.8), (0, 0.1, 0.8), (0, 0.2, 0.79)], lambda t: 0.028 * (1 - t) + 0.001, P['dark'], 6)
    for s in (-1, 1):
        box(p, (0.012, 0.03, 0.2), (s * 0.03, 0, 0.62), P['dark'])
        for z in (0.75, 0.85):
            ball(p, 0.011, (s * 0.04, 0, z), P['brass'], n=8)
    return p


def battle_axe(P):
    p = Part('battle-axe')
    haft(p, P, -0.21, 1.15, 0.033, 0.027, -0.13, 0.07)
    cyl(p, 0.03, 0.038, -0.24, -0.21, P['dark'])
    ball(p, 0.032, (0, 0, -0.26), P['brass'])
    inner = [(0.215, 1.14), (0.24, 1.07), (0.252, 0.93), (0.24, 0.79), (0.215, 0.72)]
    body = [(0.03, 0.85), (0.12, 0.82), (0.19, 0.74)] + list(reversed(inner)) + [(0.19, 1.12), (0.12, 1.04), (0.03, 1.01)]
    ground = [(0.235, 0.69), (0.27, 0.78), (0.285, 0.93), (0.27, 1.08), (0.235, 1.17)] + inner
    cheek = [(0.03, 0.86), (0.11, 0.85), (0.15, 0.93), (0.11, 1.01), (0.03, 1.0)]
    for s in (-1, 1):
        f = (lambda pts: pts) if s > 0 else (lambda pts: [(-u, v) for u, v in reversed(pts)])
        slab(p, f(body), 0.028, P['forged'])
        g = f(ground)
        edgepts = set(f([(0.27, 0.78), (0.285, 0.93), (0.27, 1.08)]))
        slab(p, g, 0.02, P['edge'], edge=lambda u, v, e=edgepts: (u, v) in e, sharp=0.002)
        slab(p, f(cheek), 0.046, P['dark'])
    box(p, (0.075, 0.08, 0.2), (0, 0, 0.93), P['dark'])
    spike(p, 0.034, 1.03, 1.17, P['dark'])
    for s in (-1, 1):
        box(p, (0.012, 0.03, 0.22), (s * 0.029, 0, 0.74), P['dark'])
    return p


def hammer_of_hephaestus(P):
    p = Part('hammer-of-hephaestus')
    haft(p, P, -0.12, 1.01, 0.038, 0.03, -0.13, 0.05)
    ball(p, 0.046, (0, 0, -0.16), P['brass'])
    for z in (0.3, 0.62):
        cyl(p, 0.042, 0.042, z - 0.015, z + 0.015, P['dark'])
    # An octagonal forged head lying along the game's Z, flared faces, bands,
    # and a seam that glows like the forge.
    head = [(0.0, -0.245), (0.12, -0.245), (0.142, -0.225), (0.142, -0.19), (0.12, -0.17), (0.124, -0.12), (0.13, -0.11), (0.13, -0.095), (0.124, -0.085),
            (0.124, 0.085), (0.13, 0.095), (0.13, 0.11), (0.124, 0.12), (0.12, 0.17), (0.142, 0.19), (0.142, 0.225), (0.12, 0.245), (0.0, 0.245)]
    k = p.mark()
    lathe(p, head, P['iron'], 8, axis='y', smooth=False)
    lathe(p, [(0.0, -0.026), (0.128, -0.026), (0.128, 0.026), (0.0, 0.026)], P['fire'], 8, axis='y', smooth=False)
    p.shift(k, Vector((0, 0, 0.98)))
    cyl(p, 0.06, 0.05, 0.82, 0.88, P['dark'])
    spike(p, 0.05, 1.1, 1.26, P['dark'])
    for s in (-1, 1):
        box(p, (0.012, 0.035, 0.26), (s * 0.036, 0, 0.73), P['dark'])
    return p


# --------------------------------------------------------- polearms etc. --


def trident(P):
    p = Part('trident-of-poseidon')
    cyl(p, 0.032, 0.028, -0.35, 1.5, P['teal'], 12)
    cyl(p, 0.038, 0.038, -0.13, 0.13, P['leather'], 12)
    wrap(p, 0.04, -0.12, 0.12, P['gold'], turns=6)
    for z in (0.18, 0.7, 1.2):
        lathe(p, [(0.0, z - 0.02), (0.038, z - 0.018), (0.042, z), (0.038, z + 0.018), (0.0, z + 0.02)], P['gold'], 12)
    spike(p, 0.034, -0.4, -0.35, P['gold'])
    # A coral-gold crown where the tines spring from, a glowing sea pearl at its heart.
    lathe(p, [(0.0, 1.44), (0.035, 1.45), (0.07, 1.5), (0.08, 1.54), (0.06, 1.56), (0.0, 1.565)], P['gold'], 14)
    ball(p, 0.03, (0, -0.05, 1.52), P['sea'])
    ball(p, 0.03, (0, 0.05, 1.52), P['sea'])
    tine = lambda pts: tube(p, pts, lambda t: 0.018 * (1 - t) ** 0.7 + 0.002, P['gold'], 8)
    tine([(0, 0, 1.55), (0, 0, 1.75), (0, 0, 2.02)])
    blade(p, [(1.88, 0.03, 0.006, 0), (1.95, 0.022, 0.005, 0), (2.04, 0.0005, 0.001, 0)], P['gold'])
    for s in (-1, 1):
        tine([(s * 0.05, 0, 1.54), (s * 0.12, 0, 1.6), (s * 0.13, 0, 1.75), (s * 0.12, 0, 1.92)])
        blade(p, [(1.84, 0.024, 0.005, s * 0.122), (1.9, 0.018, 0.004, s * 0.12), (1.97, 0.0005, 0.001, s * 0.115)], P['gold'])
        # Barbs.
        tube(p, [(s * 0.13, 0, 1.78), (s * 0.155, 0, 1.8), (s * 0.165, 0, 1.84)], lambda t: 0.008 * (1 - t) + 0.001, P['gold'], 6)
    return p


def ash_spear(P):
    p = Part('ash-spear')
    cyl(p, 0.026, 0.023, -0.52, 1.35, P['ash'], 12)
    cyl(p, 0.029, 0.029, -0.15, 0.15, P['leather'], 12)
    wrap(p, 0.031, -0.14, 0.14, P['cord'], turns=8)
    for z in (-0.38, 0.5, 1.05):
        cyl(p, 0.029, 0.029, z - 0.012, z + 0.012, P['brass'])
    spike(p, 0.027, -0.6, -0.52, P['dark'])
    lathe(p, [(0.0, 1.33), (0.029, 1.34), (0.026, 1.38), (0.02, 1.46), (0.0, 1.47)], P['dark'], 10)
    blade(p, [(1.44, 0.012, 0.009, 0), (1.5, 0.042, 0.009, 0), (1.58, 0.046, 0.008, 0), (1.7, 0.028, 0.006, 0), (1.82, 0.0005, 0.001, 0)], P['steel'])
    return p


def oak_staff(P):
    p = Part('oak-staff')
    # A gnarled shaft that twists as it climbs, roots at its foot, and
    # branches curled round a glowing seed-crystal.
    pts = []
    for k in range(25):
        z = -0.45 + k * 0.08
        pts.append((0.012 * math.sin(k * 0.9), 0.01 * math.cos(k * 1.3), z))
    tube(p, pts, lambda t: 0.032 - 0.008 * t + 0.004 * math.sin(t * 40), P['oak'], 9)
    cyl(p, 0.04, 0.04, -0.12, 0.12, P['leather'], 12)
    wrap(p, 0.042, -0.11, 0.11, P['cord'], turns=6)
    for a in range(4):
        ang = a / 4 * TAU + 0.4
        tube(p, [(0, 0, 1.42), (math.cos(ang) * 0.05, math.sin(ang) * 0.05, 1.5), (math.cos(ang + 0.6) * 0.08, math.sin(ang + 0.6) * 0.08, 1.6), (math.cos(ang + 1.3) * 0.045, math.sin(ang + 1.3) * 0.045, 1.7)], lambda t: 0.016 * (1 - t) + 0.003, P['oak'], 6)
    lathe(p, [(0.0, 1.5), (0.035, 1.54), (0.04, 1.58), (0.03, 1.63), (0.0, 1.68)], P['leaf'], 6, smooth=False)
    return p


def staff_of_hecate(P):
    p = Part('staff-of-hecate')
    cyl(p, 0.04, 0.03, -0.35, 1.35, P['ebony'], 12)
    cyl(p, 0.042, 0.042, -0.12, 0.12, P['leather'], 12)
    wrap(p, 0.044, -0.11, 0.11, P['silver'], turns=6)
    for z, r in ((0.2, 0.042), (0.62, 0.038), (1.16, 0.035)):
        lathe(p, [(0.0, z - 0.02), (r, z - 0.016), (r + 0.006, z), (r, z + 0.016), (0.0, z + 0.02)], P['silver'], 12)
    spike(p, 0.04, -0.42, -0.35, P['silver'])
    lathe(p, [(0.0, 1.32), (0.03, 1.33), (0.05, 1.37), (0.036, 1.4), (0.0, 1.41)], P['silver'], 12)
    # A crescent moon cradling an orb of dark light, three keys of the crossroads below it.
    pts = []
    for k in range(17):
        a = -math.pi * 0.85 + k / 16 * math.pi * 1.7
        pts.append((math.sin(a) * 0.14, 0, 1.56 - math.cos(a) * 0.14))
    tube(p, pts, lambda t: 0.006 + 0.022 * math.sin(math.pi * t), P['silver'], 10, squash=0.5)
    ball(p, 0.06, (0, 0, 1.56), P['moon'], n=16)
    for i in range(3):
        a = (i - 1) * 0.7
        tube(p, [(0, 0, 1.4), (math.sin(a) * 0.07, math.cos(a) * 0.02, 1.36), (math.sin(a) * 0.09, math.cos(a) * 0.02, 1.28)], 0.006, P['silver'], 6)
        ball(p, 0.014, (math.sin(a) * 0.09, math.cos(a) * 0.02, 1.27), P['moon'])
    return p


def quarterstaff(P, name, wood, shoe, bands):
    p = Part(name)
    cyl(p, 0.028, 0.028, -0.85, 1.05, P[wood], 12)
    cyl(p, 0.032, 0.032, -0.14, 0.14, P['leather'], 12)
    wrap(p, 0.034, -0.13, 0.13, P['cord'], turns=7)
    for z0, z1 in ((-0.85, -0.73), (0.93, 1.05)):
        cyl(p, 0.034, 0.034, z0, z1, P[shoe], 12)
        lathe(p, [(0.0, (z0 if z0 < 0 else z1) - 0.005), (0.03, (z0 if z0 < 0 else z1)), (0.0, (z0 if z0 < 0 else z1) + 0.005)], P[shoe], 12)
    for z in bands:
        cyl(p, 0.031, 0.031, z - 0.008, z + 0.008, P['brass'])
    return p


def master_bolt(P):
    p = Part('master-bolt')
    cyl(p, 0.032, 0.032, -0.12, 0.12, P['leather'], 12)
    wrap(p, 0.034, -0.11, 0.11, P['gold'], turns=6)
    for z in (-0.13, 0.13):
        lathe(p, [(0.0, z - 0.02), (0.04, z - 0.015), (0.045, z), (0.04, z + 0.015), (0.0, z + 0.02)], P['gold'], 12)
    # Jagged prongs of lightning up and down, a fan of smaller forks at each end.
    def fork(sign, spread, length, r):
        pts = [(0, 0, sign * 0.14)]
        x = 0.0
        for k in range(1, 6):
            x += (0.03 if k % 2 else -0.045) * spread
            pts.append((x, 0, sign * (0.14 + length * k / 5)))
        tube(p, pts, lambda t: r * (1 - t) + 0.002, P['bolt'], 6)
    for sign in (-1, 1):
        fork(sign, 1.0, 0.85 if sign > 0 else 0.5, 0.03)
        fork(sign, -1.6, 0.6 if sign > 0 else 0.38, 0.018)
        fork(sign, 2.2, 0.45 if sign > 0 else 0.3, 0.014)
    return p


# ---------------------------------------------------------------- shield --


def shield(P):
    p = Part('shield')
    # Planked wood with a painted field, an iron rim and rivets, a brass sun round the boss.
    # Faces the game's +Z: Blender -Y.
    def disc(r, y0, y1, m, n=32):
        rings = [[Vector((v.x, y0, v.y)) for v in circle(r, n)], [Vector((v.x, y1, v.y)) for v in circle(r, n)]]
        p.ring_loft(rings, m, True, True, smooth=False)
    disc(0.38, 0.025, -0.025, P['shieldwood'])
    disc(0.335, -0.025, -0.028, P['red'])
    tube(p, [(math.cos(i / 48 * TAU) * 0.384, 0, math.sin(i / 48 * TAU) * 0.384) for i in range(49)], 0.02, P['iron'], 8, cap=False)
    for i in range(12):
        a = (i + 0.5) / 12 * TAU
        ball(p, 0.012, (math.cos(a) * 0.384, -0.02, math.sin(a) * 0.384), P['iron'], n=8)
    for i in range(8):
        a = i / 8 * TAU
        ball(p, 0.018, (math.cos(a) * 0.29, -0.03, math.sin(a) * 0.29), P['iron'], sy=0.7, n=8)
    tube(p, [(math.cos(i / 32 * TAU) * 0.13, -0.03, math.sin(i / 32 * TAU) * 0.13) for i in range(33)], 0.011, P['brass'], 6, cap=False)
    for i in range(8):
        a = (i + 0.5) / 8 * TAU
        c, s = math.cos(a), math.sin(a)
        tri = [(c * 0.14 - s * 0.024, s * 0.14 + c * 0.024), (c * 0.14 + s * 0.024, s * 0.14 - c * 0.024), (c * 0.25, s * 0.25)]
        bm = p.bm
        vs = [bm.verts.new((u, -0.031, v)) for u, v in tri]
        f = bm.faces.new(vs)
        f.material_index = p.mi(P['brass'])
    ball(p, 0.085, (0, -0.03, 0), P['brass'], sy=0.65, n=16)
    k = p.mark()
    spike(p, 0.028, 0, 0.08, P['brass'])
    p.shift(k, Vector((0, -0.075, 0)), Matrix.Rotation(math.pi / 2, 3, 'X'))
    for z in (-0.1, 0.1):
        box(p, (0.36, 0.02, 0.05), (0, 0.035, z), P['leather'])
    box(p, (0.04, 0.03, 0.22), (0, 0.045, 0), P['leather'])
    return p


# ------------------------------------------------------------------ main --

BUILDERS = [
    iron_sword, steel_longsword, iron_greatsword, sword_of_mars, reapers_edge, duelist_saber,
    shadow_dagger, venomfang, iron_axe, battle_axe, hammer_of_hephaestus, trident, ash_spear,
    oak_staff, staff_of_hecate, master_bolt, shield,
    lambda P: quarterstaff(P, 'ash-quarterstaff', 'ash', 'iron', (-0.45, 0.65)),
    lambda P: quarterstaff(P, 'ironwood-staff', 'ebony', 'dark', (-0.6, -0.45, -0.3, 0.5, 0.65, 0.8)),
]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    P = palette()
    objs = []
    for build in BUILDERS:
        part = build(P)
        objs.append(part.build())
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False, export_animations=False)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
    print(f'wrote {OUT}: {len(objs)} models, {tris} triangles, {os.path.getsize(OUT) // 1024} KB')
    if '--preview' in sys.argv:
        preview(objs)


def preview(objs):
    """A contact sheet: every model laid out in a row, rendered with Cycles."""
    scene = bpy.context.scene
    for i, o in enumerate(objs):
        o.location = ((i - len(objs) / 2) * 0.42, 0, 0)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = len(objs) * 0.44
    cam.location = (0, -6, 0.75)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for loc, power in (((3, -4, 4), 900), ((-4, -3, 1), 400), ((0, 4, 3), 500)):
        L = bpy.data.objects.new('light', bpy.data.lights.new('light', 'AREA'))
        L.data.energy = power
        L.data.size = 4
        L.location = loc
        L.rotation_euler = (Vector((0, 0, 0.75)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(L)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.045, 0.04, 1)
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 2400
    scene.render.resolution_y = int(2400 * 2.3 / (len(objs) * 0.44))
    out = os.path.join(HERE, 'preview', 'weapons.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('preview', out)
    # A second sheet turned a quarter, to see the axes' and hammer's heads side on.
    for o in objs:
        o.rotation_euler = (0, 0, -math.pi / 2)
    scene.render.filepath = os.path.join(HERE, 'preview', 'weapons-side.png')
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
