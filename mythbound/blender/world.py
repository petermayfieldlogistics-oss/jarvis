"""Mythbound's scenery modelled in Blender: trees and plants, rocks, houses and the town's props.

    python blender/world.py [name ...] [--preview]

Every model is built from Blender objects (bevelled boxes, tubes, metaball
canopies, displaced rocks), each painted with a colour or a colour slot the
game fills in (a house's plaster, roof and shutters), shaded with
ray-traced occlusion and written to src/assets/world.bin. Plants also carry
how much the land's own colour tints each part and how much it glows, as
the game's swaying vegetation expects.
"""

import json
import math
import os
import random
import struct
import sys

import bpy  # noqa: I001 (bpy first: it loads bmesh and mathutils)
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.noise import noise as pnoise

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'assets', 'world.bin')
MODELS = {}
TAU = math.tau


def model(name):
    def wrap(fn):
        MODELS[name] = fn
        return fn
    return wrap


def G(x, y, z):
    """The game's Y-up coordinates to Blender's Z-up."""
    return Vector((x, -z, y))


def hexrgb(h):
    return ((h >> 16) & 255, (h >> 8) & 255, h & 255)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c0, c1, t):
    a, b = hexrgb(c0), hexrgb(c1)
    return tuple(round(lerp(x, y, max(0.0, min(1.0, t)))) for x, y in zip(a, b))


# ------------------------------------------------------------------ pieces --


class Piece:
    """
    One painted part: a Blender mesh (evaluated, in place) and how it is
    coloured: a colour (or a gradient up its height), a slot the game fills
    in, how much the land tints it, how much it glows, and whether it shades
    smooth or faceted.
    """

    def __init__(self, me, rgb=0xffffff, top=None, slot=0, tint=0.0, glow=0.0, smooth=True, radial=None, ao=True, colour=None):
        self.me = me
        self.rgb, self.top = rgb, top
        self.slot, self.tint, self.glow = slot, tint, glow
        self.smooth = smooth
        # Canopies light as a ball: normals bent out from this centre.
        self.radial = radial
        self.ao = ao
        # A function (vertex) -> rgb tuple, for marks painted on (birch bark, moss).
        self.colour = colour


class Scene:
    """Collects the pieces of one model."""

    def __init__(self, seed=1):
        self.pieces = []
        self.rng = random.Random(seed)

    def add(self, ob, **kw):
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        me.transform(ob.matrix_world)
        bpy.data.objects.remove(ob, do_unlink=True)
        self.pieces.append(Piece(me, **kw))
        return self.pieces[-1]

    def mesh(self, verts, faces, **kw):
        me = bpy.data.meshes.new('p')
        me.from_pydata([Vector(v) for v in verts], [], faces)
        me.validate()
        self.pieces.append(Piece(me, **kw))
        return self.pieces[-1]


def obj(me, name='o'):
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def box(sc, size, at, rot=(0, 0, 0), bevel=0.0, segs=1, **kw):
    """A box `size` (game x, y, z) centred at game `at`, turned by game-axis Euler `rot` (pitch, yaw, roll), bevelled."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    me = bpy.data.meshes.new('box')
    bm.to_mesh(me)
    bm.free()
    ob = obj(me)
    ob.scale = (size[0], size[2], size[1])
    ob.rotation_mode = 'YXZ'
    ob.rotation_euler = (rot[0], -rot[2], rot[1])
    ob.location = G(*at)
    if bevel:
        bpy.context.view_layer.update()
        m = ob.modifiers.new('bevel', 'BEVEL')
        m.width = bevel
        m.segments = segs
        m.limit_method = 'NONE'
        m.use_clamp_overlap = True
    kw.setdefault('smooth', False)
    return sc.add(ob, **kw)


def tube(sc, pts, radius, sides=8, cap=True, profile=None, **kw):
    """A tube along game-space points; `radius` a number or function of t; `profile(angle)` scales each ring (stars, ribs)."""
    pts = [G(*p) if not isinstance(p, Vector) else p for p in pts]
    verts, faces = [], []
    t0 = (pts[1] - pts[0]).normalized()
    ref = Vector((1, 0, 0)) if abs(t0.x) < 0.9 else Vector((0, 1, 0))
    nrm = (ref - t0 * ref.dot(t0)).normalized()
    for k, p in enumerate(pts):
        a = pts[max(0, k - 1)]
        b = pts[min(len(pts) - 1, k + 1)]
        t = (b - a).normalized()
        nrm = (nrm - t * nrm.dot(t)).normalized()
        bn = t.cross(nrm)
        u = k / (len(pts) - 1)
        r = radius(u) if callable(radius) else radius
        for i in range(sides):
            ang = i / sides * TAU
            s = profile(ang, u) if profile else 1.0
            verts.append(p + (nrm * math.cos(ang) + bn * math.sin(ang)) * r * s)
    for k in range(len(pts) - 1):
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((k * sides + i, k * sides + j, (k + 1) * sides + j, (k + 1) * sides + i))
    if cap:
        faces.append(tuple(reversed(range(sides))))
        last = (len(pts) - 1) * sides
        faces.append(tuple(range(last, last + sides)))
    return sc.mesh(verts, faces, **kw)


def cone(sc, base, tip, r, sides=8, **kw):
    b, t = G(*base), G(*tip)
    return tube(sc, [b, b.lerp(t, 0.5), t], lambda u: r * (1 - u) + 0.0005, sides=sides, **kw)


def curve(pts, n=6):
    """A smooth Catmull-Rom run through game-space points (returns game-space tuples)."""
    pts = [Vector(p) for p in pts]
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)))
    out.append(tuple(pts[-1]))
    return out


def blobs(sc, balls, voxel, tris, detail=None, seed=0, **kw):
    """Metaball clay (balls of game centre and radius, or (centre, (rx, ry, rz)) ellipsoids), evened, roughened and reduced."""
    mb = bpy.data.metaballs.new('clay')
    mb.resolution = voxel
    mb.threshold = 0.6
    ob = obj(mb, 'clay')
    for c, r in balls:
        e = mb.elements.new(type='BALL' if not isinstance(r, tuple) else 'ELLIPSOID')
        e.co = G(*c)
        if isinstance(r, tuple):
            e.radius = 1 / 0.575
            e.size_x, e.size_y, e.size_z = r[0], r[2], r[1]
        else:
            e.radius = r / 0.575
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob, do_unlink=True)
    work = obj(me)
    if detail:
        kind, size, depth = detail
        tex = bpy.data.textures.new('d', kind)
        tex.noise_scale = size
        if hasattr(tex, 'noise_basis'):
            tex.noise_basis = 'BLENDER_ORIGINAL'
        d = work.modifiers.new('d', 'DISPLACE')
        d.texture = tex
        d.texture_coords = 'GLOBAL'
        d.strength = depth
        d.mid_level = 0.5
    dec = work.modifiers.new('dec', 'DECIMATE')
    dec.ratio = min(1.0, tris / max(1, len(me.polygons) * 2))
    work.modifiers.new('tri', 'TRIANGULATE')
    return sc.add(work, **kw)


def rock_mesh(sc, size, seed, tris=140, flat_bottom=True, **kw):
    """A boulder: a lumpy ball, cracked by Voronoi, flattened beneath, cut to facets."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
    rng = random.Random(seed)
    off = Vector((rng.uniform(0, 50), rng.uniform(0, 50), rng.uniform(0, 50)))
    for v in bm.verts:
        p = v.co.copy()
        n1 = pnoise(p * 1.1 + off)
        n2 = pnoise(p * 2.7 + off * 1.3)
        k = 1 + 0.28 * n1 + 0.1 * n2
        # Flat planes, as if split along its grain.
        for ax, cut in ((Vector((0.3, 0.2, 1)).normalized(), 0.72), (Vector((-0.8, 0.3, 0.2)).normalized(), 0.86), (Vector((0.5, -0.7, -0.1)).normalized(), 0.82)):
            d = p.normalized().dot(ax) * k
            if d > cut:
                k *= cut / d
        v.co = Vector((p.x * size[0], p.y * size[2], p.z * size[1])) * k
        if flat_bottom and v.co.z < -0.3 * size[1]:
            v.co.z = -0.3 * size[1] + (v.co.z + 0.3 * size[1]) * 0.15
    me = bpy.data.meshes.new('rock')
    bm.to_mesh(me)
    bm.free()
    ob = obj(me)
    dec = ob.modifiers.new('dec', 'DECIMATE')
    dec.ratio = min(1.0, tris * 2.2 / 5120)
    ob.modifiers.new('tri', 'TRIANGULATE')
    kw.setdefault('smooth', False)
    return sc.add(ob, **kw)


# ------------------------------------------------------------------ baking --


def bake(sc, ao_reach=None, ao_rays=20, ao_floor=0.45, ground=True):
    """Every piece's vertices and corners, coloured and shaded, merged into one model's arrays."""
    # Ambient occlusion against every piece, and the ground beneath.
    allv, allf = [], []
    for pc in sc.pieces:
        base = len(allv)
        allv.extend(v.co.copy() for v in pc.me.vertices)
        allf.extend(tuple(base + i for i in p.vertices) for p in pc.me.polygons)
    lo = Vector([min(v[k] for v in allv) for k in range(3)])
    hi = Vector([max(v[k] for v in allv) for k in range(3)])
    if ground:
        g = len(allv)
        R = max(hi - lo) * 2
        allv.extend([Vector((-R, -R, 0)), Vector((R, -R, 0)), Vector((R, R, 0)), Vector((-R, R, 0))])
        allf.append((g, g + 1, g + 2, g + 3))
    tree = BVHTree.FromPolygons(allv, allf)
    reach = ao_reach or (hi - lo).length * 0.3
    dirs = []
    for k in range(ao_rays):
        u = (k + 0.5) / ao_rays
        a = k * 2.399963
        r = math.sqrt(u)
        dirs.append(Vector((math.cos(a) * r, math.sin(a) * r, math.sqrt(1 - u))))

    out = {'pos': [], 'nrm': [], 'rgb': [], 'slot': [], 'tint': [], 'glow': [], 'idx': []}
    for pc in sc.pieces:
        me = pc.me
        me.calc_loop_triangles()
        zs = [v.co.z for v in me.vertices] or [0]
        z0, z1 = min(zs), max(zs)
        cache = {}

        def vert(vi, n):
            key = (vi, round(n.x, 2), round(n.y, 2), round(n.z, 2)) if not pc.smooth else vi
            if key in cache:
                return cache[key]
            co = me.vertices[vi].co
            if pc.smooth:
                n = me.vertices[vi].normal.copy()
                if pc.radial is not None:
                    n = (n + (co - G(*pc.radial)).normalized() * 1.5).normalized()
            k = 1.0
            if pc.ao:
                rot = Vector((0, 0, 1)).rotation_difference(n)
                o = co + n * reach * 0.004
                hit = sum(1 for d in dirs if tree.ray_cast(o, rot @ d, reach)[0] is not None)
                k = ao_floor + (1 - ao_floor) * (1 - hit / ao_rays) ** 1.1
            t = (co.z - z0) / (z1 - z0) if z1 > z0 else 0
            c = pc.colour(co) if pc.colour else (mix(pc.rgb, pc.top, t) if pc.top is not None else hexrgb(pc.rgb))
            i = len(out['pos'])
            out['pos'].append((co.x, co.z, -co.y))
            out['nrm'].append((n.x, n.z, -n.y))
            out['rgb'].append(tuple(min(255, round(x * k)) for x in c))
            out['slot'].append(pc.slot)
            out['tint'].append(round(pc.tint * 255))
            out['glow'].append(round(min(1.0, pc.glow / 4) * 255))
            cache[key] = i
            return i

        for tri in me.loop_triangles:
            fn = tri.normal
            ids = [vert(vi, fn) for vi in tri.vertices]
            out['idx'].append(tuple(ids))
        bpy.data.meshes.remove(me)
    return out


def pack(name, m):
    nv = len(m['pos'])
    lo = [min(p[k] for p in m['pos']) for k in range(3)]
    hi = [max(p[k] for p in m['pos']) for k in range(3)]
    span = [max(hi[k] - lo[k], 1e-6) for k in range(3)]
    big = nv > 65535
    blob = b''.join([
        struct.pack(f'<{nv * 3}H', *[round((p[k] - lo[k]) / span[k] * 65535) for p in m['pos'] for k in range(3)]),
        struct.pack(f'<{nv * 3}b', *[max(-127, min(127, round(c * 127))) for n in m['nrm'] for c in n]),
        bytes(x for c in m['rgb'] for x in c),
        bytes(m['slot']),
        bytes(m['tint']),
        bytes(m['glow']),
        struct.pack(f'<{len(m["idx"]) * 3}{"I" if big else "H"}', *[i for t in m['idx'] for i in t]),
    ])
    head = {'name': name, 'verts': nv, 'tris': len(m['idx']), 'big': big, 'bytes': len(blob), 'box': [round(x, 4) for x in lo + hi]}
    return head, blob


def read(path):
    with open(path, 'rb') as fh:
        raw = fh.read()
    if raw[:4] != b'MBW1':
        return [], []
    hl = struct.unpack('<I', raw[4:8])[0]
    heads = json.loads(raw[8:8 + hl])
    off, blobs_ = 8 + hl, []
    for h in heads:
        blobs_.append(raw[off:off + h['bytes']])
        off += h['bytes']
    return heads, blobs_


def write(heads, blobs_):
    header = json.dumps(heads).encode()
    with open(OUT, 'wb') as fh:
        fh.write(b'MBW1')
        fh.write(struct.pack('<I', len(header)))
        fh.write(header)
        fh.write(b''.join(blobs_))
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')


# ------------------------------------------------------------------ preview --

# Stand-in colours for slots and the land's tint in previews.
PREVIEW_SLOTS = {1: 0x9a8a6c, 2: 0x4a2e22, 3: 0x2e3a2a, 4: 0x6a645a}
PREVIEW_TINT = 0x6a8a3a


def preview(name, m, tint=PREVIEW_TINT):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    me = bpy.data.meshes.new(name)
    verts = [Vector((p[0], -p[2], p[1])) for p in m['pos']]
    me.from_pydata(verts, [], m['idx'])
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    tr = [x / 255 for x in hexrgb(tint)]
    for i in range(len(verts)):
        c = [x / 255 for x in m['rgb'][i]]
        s = m['slot'][i]
        if s:
            c = [a * b / 255 for a, b in zip(c, hexrgb(PREVIEW_SLOTS.get(s, 0x808080)))]
        t = m['tint'][i] / 255
        c = [a * lerp(1, b, t) for a, b in zip(c, tr)]
        col.data[i].color = (c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, 1)
    me.normals_split_custom_set_from_vertices([Vector((n[0], -n[2], n[1])) for n in m['nrm']]) if hasattr(me, 'normals_split_custom_set_from_vertices') else None
    for p in me.polygons:
        p.use_smooth = True
    mt = bpy.data.materials.new(name)
    mt.use_nodes = True
    nt = mt.node_tree
    bsdf = nt.nodes['Principled BSDF']
    ca = nt.nodes.new('ShaderNodeVertexColor')
    ca.layer_name = 'Col'
    nt.links.new(ca.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    me.materials.append(mt)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    lo = Vector([min(v[k] for v in verts) for k in range(3)])
    hi = Vector([max(v[k] for v in verts) for k in range(3)])
    size = max(hi - lo)
    mid = (lo + hi) / 2
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size * 1.2
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.36, 0.38, 0.4, 1)
    scene.world = w
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 20
    scene.render.resolution_x = 700
    scene.render.resolution_y = 700
    os.makedirs(os.path.join(HERE, 'preview', 'world'), exist_ok=True)
    r = size * 3
    a = math.radians(35)
    cam.location = mid + Vector((math.sin(a) * r, -math.cos(a) * r, r * 0.45))
    cam.rotation_euler = (mid - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(HERE, 'preview', 'world', f'{name}.png')
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------- plants --


def bark(sc, pts, r0, r1, rgb=0x34261a, top=0x4e3a26, sides=8, flare=0.0, **kw):
    """A trunk or bough: a tapering tube along a curve, flared at the root, a little gnarled."""
    rng = sc.rng
    ph = rng.uniform(0, 10)
    prof = lambda ang, u: 1 + 0.08 * math.sin(ang * 3 + ph + u * 4) + (flare * max(0.0, 1 - u * 6) ** 2) * (0.7 + 0.3 * math.cos(ang * 5 + ph))
    return tube(sc, pts, lambda u: lerp(r0, r1, u), sides=sides, profile=prof, rgb=rgb, top=top, **kw)


@model('pine')
def pine(sc):
    """A tall pine: a straight trunk under tiers of drooping, ragged boughs."""
    bark(sc, curve([(0, -0.3, 0), (0, 3, 0.05), (0.05, 8.6, 0)], 4), 0.3, 0.06, rgb=0x3a2a1c, top=0x56402c, flare=0.7)
    rng = sc.rng
    for k in range(6):
        y = 2.3 + k * 1.22
        R = 2.45 - k * 0.36
        h = 1.9 - k * 0.13
        n = 11 - k // 2
        verts, faces = [], []
        ph = rng.uniform(0, TAU)
        # A star of drooping bough tips round a raised centre, its underside tucked in.
        rings = []
        for ring, (rr, dy) in enumerate(((0.0, h), (0.55, h * 0.55), (1.0, 0.0), (0.62, 0.25))):
            row = []
            for i in range(n * 2):
                a = ph + i / (n * 2) * TAU
                tip = i % 2 == 0
                rad = R * rr * (1.0 if tip or ring == 0 else 0.72) * (1 + 0.12 * math.sin(a * 3 + k))
                droop = (-0.3 if tip and ring == 2 else 0.0)
                row.append(len(verts))
                verts.append(G(math.cos(a) * rad, y + dy + droop, math.sin(a) * rad))
            rings.append(row)
        for a_, b_ in zip(rings, rings[1:]):
            m = len(a_)
            for i in range(m):
                faces.append((a_[i], a_[(i + 1) % m], b_[(i + 1) % m], b_[i]))
        faces.append(tuple(reversed(rings[-1])))
        sc.mesh(verts, faces, rgb=0x24361e, top=0x587a44, tint=1.0, smooth=True, radial=(0, y - 1.5, 0))


@model('oak')
def oak(sc):
    """A broad oak: a thick, forked trunk and a crown of leafy clusters."""
    bark(sc, curve([(0, -0.3, 0), (0.05, 1.8, 0), (0.1, 3.0, 0.05)], 4), 0.48, 0.3, flare=0.9, sides=10)
    for path, r0 in (([(0.1, 2.8, 0), (0.9, 3.7, 0.1), (1.9, 4.4, 0.5)], 0.22), ([(0.0, 2.7, 0.0), (-0.8, 3.6, 0.3), (-1.7, 4.4, -0.4)], 0.21),
                     ([(0.05, 3.0, 0), (0.2, 4.2, -0.6), (0.4, 4.6, -1.6)], 0.17), ([(0.0, 3.0, 0), (-0.2, 4.4, 0.8), (-0.4, 4.8, 1.6)], 0.16),
                     ([(0.1, 3.0, 0), (0.15, 4.6, 0.1), (0.2, 6.0, 0.2)], 0.2)):
        bark(sc, curve(path, 4), r0, r0 * 0.35, sides=7)
    rng = sc.rng
    balls = []
    for c, r in (((0, 5.3, 0), 1.7), ((1.9, 4.7, 0.6), 1.25), ((-1.8, 4.8, -0.5), 1.3), ((0.4, 4.6, -1.9), 1.2), ((-0.5, 4.6, 1.8), 1.15),
                 ((0.2, 6.6, 0.2), 1.2), ((1.4, 6.0, -1.0), 0.95), ((-1.2, 6.1, 1.0), 0.95), ((-1.1, 5.5, -1.6), 0.85), ((1.4, 5.3, 1.5), 0.85),
                 ((2.6, 4.3, -0.4), 0.7), ((-2.5, 4.4, 0.7), 0.7)):
        balls.append((c, r))
        # Each clump made of smaller leafy lumps, so it reads as foliage, not a ball.
        for k in range(5):
            a, b = rng.uniform(0, TAU), rng.uniform(-0.6, 1.0)
            d = Vector((math.cos(a) * math.cos(b), math.sin(b), math.sin(a) * math.cos(b)))
            balls.append((tuple(Vector(c) + d * r * 0.75), r * rng.uniform(0.35, 0.5)))
    blobs(sc, balls, 0.16, 1100, detail=('CLOUDS', 0.35, 0.45), rgb=0x7a7a7a, top=0xffffff, tint=1.0, radial=(0, 4.8, 0))


@model('birch')
def birch(sc):
    """A slender birch: a white trunk marked in black, a light, narrow crown."""
    rng = sc.rng
    marks = [(rng.uniform(0.6, 5.5), rng.uniform(0, TAU), rng.uniform(0.6, 1.4)) for _ in range(26)]

    def bark_col(co):
        y, a = co.z, math.atan2(co.y, co.x)
        for my, ma, mw in marks:
            if abs(y - my) < 0.05 * mw and abs(math.atan2(math.sin(a - ma), math.cos(a - ma))) < 0.9 * mw:
                return hexrgb(0x24201c)
        return mix(0xbab4a6, 0xe4e0d4, y / 6)

    p = bark(sc, curve([(0, -0.3, 0), (0.08, 2.5, 0.0), (-0.05, 6.0, 0.05)], 6), 0.17, 0.07, flare=0.4, sides=9)
    p.colour = bark_col
    for path in ([(0, 4.3, 0), (0.55, 5.0, 0.1), (0.9, 5.6, 0.2)], [(0, 4.8, 0), (-0.5, 5.4, -0.2), (-0.8, 5.9, -0.4)], [(0, 3.8, 0), (0.1, 4.4, 0.5), (0.2, 4.9, 0.8)]):
        tube(sc, curve(path, 3), lambda u: 0.07 * (1 - u) + 0.02, sides=5, rgb=0xc8c2b4)
    balls = []
    for c, r in (((0, 6.5, 0), 1.0), ((0.7, 5.5, 0.3), 0.8), ((-0.55, 5.7, -0.35), 0.8), ((0.15, 5.0, 0.7), 0.65), ((0.0, 7.4, 0.1), 0.7), ((-0.3, 4.9, -0.6), 0.55), ((0.6, 6.6, -0.5), 0.6)):
        balls.append((c, r))
        for k in range(4):
            a, b = rng.uniform(0, TAU), rng.uniform(-0.6, 1.0)
            d = Vector((math.cos(a) * math.cos(b), math.sin(b) * 1.3, math.sin(a) * math.cos(b)))
            balls.append((tuple(Vector(c) + d * r * 0.7), r * rng.uniform(0.35, 0.5)))
    blobs(sc, balls, 0.12, 750, detail=('CLOUDS', 0.3, 0.35), rgb=0x7a7a7a, top=0xffffff, tint=1.0, radial=(0, 5.8, 0))


@model('bush')
def bush(sc):
    rng = sc.rng
    balls = []
    for c, r in (((0, 0.55, 0), 0.75), ((0.7, 0.42, 0.3), 0.6), ((-0.6, 0.45, -0.3), 0.62), ((0.1, 0.4, -0.7), 0.5), ((-0.2, 0.4, 0.7), 0.48), ((0.1, 0.95, 0.05), 0.45)):
        balls.append((c, r))
        for k in range(3):
            a, b = rng.uniform(0, TAU), rng.uniform(-0.3, 1.0)
            d = Vector((math.cos(a) * math.cos(b), math.sin(b), math.sin(a) * math.cos(b)))
            balls.append((tuple(Vector(c) + d * r * 0.7), r * rng.uniform(0.35, 0.5)))
    blobs(sc, balls, 0.08, 420, detail=('CLOUDS', 0.2, 0.22), rgb=0x7a7a7a, top=0xffffff, tint=1.0, radial=(0, 0.1, 0))


def blade(sc, base, lean, h, w, rgb, top, tint, bend=0.35, segs=3):
    """A blade of grass or reed: three-sided, tapering to a point, bending over."""
    b = Vector(base)
    pts = []
    for k in range(segs + 1):
        u = k / segs
        pts.append((b.x + lean[0] * h * (u + bend * u * u), b.y + h * u, b.z + lean[1] * h * (u + bend * u * u)))
    return tube(sc, pts, lambda u: w * (1 - u) + 0.002, sides=3, cap=False, rgb=rgb, top=top, tint=tint, smooth=True, ao=False)


@model('grass')
def grass(sc):
    rng = sc.rng
    for i in range(7):
        a = rng.uniform(0, TAU)
        r = rng.uniform(0.02, 0.16)
        h = 0.95 * rng.uniform(0.6, 1.1)
        d = (math.cos(a) * rng.uniform(0.15, 0.4), math.sin(a) * rng.uniform(0.15, 0.4))
        blade(sc, (math.cos(a) * r, 0, math.sin(a) * r), d, h, 0.035, 0x6a6a6a, 0xffffff, 1.0, segs=2)


@model('flowers')
def flowers(sc):
    rng = sc.rng
    for i in range(5):
        a = rng.uniform(0, TAU)
        blade(sc, (math.cos(a) * 0.08, 0, math.sin(a) * 0.08), (math.cos(a) * 0.3, math.sin(a) * 0.3), 0.45, 0.035, 0x3e5a24, 0x6a8a38, 0.0)
    for i in range(5):
        a = i * 2.4
        r = 0 if i == 0 else 0.2
        h = 0.45 + rng.uniform(0, 0.3)
        x, z = math.cos(a) * r, math.sin(a) * r
        tube(sc, [(x, 0, z), (x * 1.1, h * 0.6, z * 1.1), (x * 1.15, h, z * 1.15)], 0.014, sides=4, cap=False, rgb=0x3e5a24, ao=False)
        c = (x * 1.15, h + 0.02, z * 1.15)
        # Five petals round a gold eye.
        for k in range(5):
            pa = k / 5 * TAU + i
            tip = (c[0] + math.cos(pa) * 0.09, c[1] + 0.02, c[2] + math.sin(pa) * 0.09)
            left = (c[0] + math.cos(pa + 0.5) * 0.05, c[1] + 0.015, c[2] + math.sin(pa + 0.5) * 0.05)
            right = (c[0] + math.cos(pa - 0.5) * 0.05, c[1] + 0.015, c[2] + math.sin(pa - 0.5) * 0.05)
            vs = [G(*c), G(*right), G(*tip), G(*left), G(c[0], c[1] - 0.012, c[2])]
            sc.mesh(vs, [(0, 1, 2, 3), (4, 3, 2, 1)], rgb=0xffffff, tint=1.0, glow=0.15, smooth=False, ao=False)
        cone(sc, (c[0], c[1] + 0.005, c[2]), (c[0], c[1] + 0.05, c[2]), 0.03, sides=5, rgb=0xe8b030, ao=False)


@model('reeds')
def reeds(sc):
    rng = sc.rng
    for i in range(9):
        a = rng.uniform(0, TAU)
        r = rng.uniform(0.03, 0.18)
        blade(sc, (math.cos(a) * r, 0, math.sin(a) * r), (math.cos(a) * 0.12, math.sin(a) * 0.12), 2.0 * rng.uniform(0.65, 1.1), 0.05, 0x3e4a26, 0x9a9858, 0.6, bend=0.6)
    for x, z, h in ((0.08, 0.05, 1.9), (-0.1, -0.08, 1.65), (0.0, 0.12, 1.75)):
        tube(sc, [(x, 0, z), (x, h * 0.8, z), (x, h, z)], 0.012, sides=4, cap=False, rgb=0x4a5a2a, ao=False)
        tube(sc, [(x, h - 0.1, z), (x, h + 0.1, z), (x, h + 0.25, z)], lambda u: 0.04 * math.sin(math.pi * min(1, 0.2 + u * 0.8)) + 0.01, sides=6, rgb=0x3a2414, top=0x5a3a20, ao=False)


def mushroom_patch(sc, glow):
    for x, z, h, r in ((0, 0, 0.5, 0.31), (0.32, 0.15, 0.34, 0.22), (-0.22, -0.26, 0.26, 0.18)):
        tube(sc, curve([(x, -0.05, z), (x + 0.02, h * 0.5, z), (x - 0.01, h, z)], 2), lambda u: r * 0.24 * (1.15 - 0.3 * u), sides=7, rgb=0xb8b0a0, top=0xe0d8c8)
        # The cap: domed on top, gilled (dark) beneath.
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=11, v_segments=6, radius=1.0)
        for v in bm.verts:
            if v.co.z < 0:
                v.co.z *= 0.15
            v.co.z *= 0.55
        me = bpy.data.meshes.new('cap')
        bm.to_mesh(me)
        bm.free()
        ob = obj(me)
        ob.scale = (r, r, r)
        ob.location = G(x - 0.01, h, z)
        sc.add(ob, rgb=0xcccccc, top=0xffffff, tint=1.0, glow=glow)
        if not glow:
            for k in range(6):
                a = k * 2.4
                rr = r * (0.3 + 0.12 * (k % 3))
                bm = bmesh.new()
                bmesh.ops.create_icosphere(bm, subdivisions=0, radius=r * 0.12)
                me = bpy.data.meshes.new('spot')
                bm.to_mesh(me)
                bm.free()
                o = obj(me)
                o.scale = (1, 1, 0.4)
                o.location = G(x + math.cos(a) * rr, h + r * 0.5 * math.sqrt(max(0.05, 1 - (rr / r) ** 2)), z + math.sin(a) * rr)
                sc.add(o, rgb=0xf2ece0, ao=False)


@model('toadstool')
def toadstool(sc):
    mushroom_patch(sc, 0.0)


@model('mushroom')
def mushroom(sc):
    mushroom_patch(sc, 0.9)


@model('crystal')
def crystal(sc):
    rock_mesh(sc, (0.8, 0.4, 0.75), 7, tris=60, rgb=0x2e2c36)
    for at, h, r, lean in (((0, 0.0, 0), 2.3, 0.3, (0, 0)), ((0.45, 0.0, 0.2), 1.5, 0.22, (0.38, 0.1)), ((-0.38, 0.0, -0.22), 1.3, 0.2, (-0.42, -0.2)),
                           ((0.1, 0.0, -0.5), 1.0, 0.18, (0.1, -0.5)), ((-0.15, 0.0, 0.45), 0.8, 0.14, (-0.2, 0.45))):
        b = Vector(at)
        d = Vector((lean[0], 1, lean[1])).normalized()
        pts = [b, b + d * h * 0.8, b + d * h]
        tube(sc, [tuple(p) for p in pts], lambda u: r * (1 if u < 0.6 else (1 - u) / 0.4 * 0.999 + 0.001), sides=6, rgb=0x9a9aa8, top=0xffffff, tint=1.0, glow=1.0, smooth=False)


@model('dead')
def dead(sc):
    bark(sc, curve([(0, -0.3, 0), (0.15, 2.0, 0.1), (-0.1, 4.0, 0), (0.1, 5.4, 0.1)], 4), 0.32, 0.08, rgb=0x221d1a, top=0x3a332c, flare=1.0)
    for path, r in (([(0.05, 3.2, 0), (0.8, 4.0, 0.1), (1.5, 4.9, 0.0), (1.8, 5.0, 0.3)], 0.13), ([(0, 2.8, 0), (-0.7, 3.4, -0.1), (-1.4, 4.2, 0.2), (-1.6, 4.6, 0.0)], 0.12),
                    ([(0.1, 4.6, 0.05), (0.3, 5.5, 0.4), (0.4, 6.3, 0.6)], 0.08), ([(0.0, 4.0, 0), (-0.3, 4.8, -0.6), (-0.5, 5.4, -1.0)], 0.07), ([(0.6, 4.2, 0.1), (1.0, 4.4, -0.5), (1.2, 4.9, -0.8)], 0.05)):
        bark(sc, curve(path, 3), r, r * 0.2, rgb=0x2e2824, top=0x3a332c, sides=6)
    for x, y, z, L in ((1.45, 4.85, 0.1, 1.3), (-1.3, 4.1, 0.15, 1.0), (0.35, 5.9, 0.5, 0.8)):
        tube(sc, [(x, y, z), (x + 0.05, y - L * 0.5, z), (x, y - L, z + 0.05)], lambda u: 0.12 * (1 - u * 0.7), sides=4, rgb=0x3e4a2a, top=0x56603a, ao=False, profile=lambda a, u: 0.35 + 0.65 * abs(math.cos(a)))


@model('ashtree')
def ashtree(sc):
    p = bark(sc, curve([(0, -0.3, 0), (0.1, 2.2, 0.05), (-0.05, 4.2, 0), (0.05, 5.4, 0.05)], 4), 0.34, 0.08, rgb=0x161210, top=0x7a746c, flare=1.0)
    for path, r in (([(0.05, 3.2, 0), (0.8, 4.1, 0.1), (1.6, 4.9, 0.1)], 0.12), ([(0, 2.8, 0), (-0.7, 3.5, -0.1), (-1.4, 4.3, 0.2)], 0.11),
                    ([(0.1, 4.6, 0.05), (0.3, 5.5, 0.4), (0.45, 6.3, 0.6)], 0.08), ([(0.0, 4.0, 0), (-0.3, 4.8, -0.6), (-0.5, 5.5, -1.0)], 0.07)):
        bark(sc, curve(path, 3), r, r * 0.2, rgb=0x4a443e, top=0x8e8880, sides=6)
    # Embers smouldering in cracks of the trunk.
    for y, a, L in ((0.9, 0.7, 0.45), (2.1, -0.8, 0.35), (1.5, 2.6, 0.3), (3.0, 1.9, 0.25)):
        r = 0.3 - y * 0.035
        pts = [(math.cos(a) * r, y + t * L, math.sin(a) * r) for t in (0, 0.5, 1)]
        tube(sc, pts, lambda u: 0.03 * math.sin(math.pi * min(1, 0.1 + u)) + 0.008, sides=4, rgb=0xff6a20, glow=2.5, ao=False)


@model('cactus')
def cactus(sc):
    ribs = lambda a, u: 0.86 + 0.14 * abs(math.cos(a * 4))
    tube(sc, curve([(0, -0.2, 0), (0, 1.6, 0), (0.02, 3.1, 0)], 4), lambda u: 0.36 * (1 if u < 0.85 else 1 - (u - 0.85) / 0.15 * 0.7), sides=12, profile=ribs, rgb=0x3e5a30, top=0x5a7a44)
    for s, y0, h in ((1, 1.3, 2.4), (-1, 1.8, 2.75)):
        arm = curve([(0, y0, 0), (s * 0.55, y0 - 0.05, 0), (s * 0.85, y0 + 0.2, 0), (s * 0.9, h, 0)], 3)
        tube(sc, arm, lambda u: 0.2 * (1 if u < 0.85 else 1 - (u - 0.85) / 0.15 * 0.6), sides=8, profile=ribs, rgb=0x4a6a3a, top=0x5a7a44)
    b = bmesh.new()
    bmesh.ops.create_icosphere(b, subdivisions=1, radius=0.14)
    me = bpy.data.meshes.new('fl')
    b.to_mesh(me)
    b.free()
    o = obj(me)
    o.scale = (1, 1, 0.6)
    o.location = G(0, 3.2, 0)
    sc.add(o, rgb=0xe0607a, smooth=False)


@model('palm')
def palm(sc):
    trunk = [(0, -0.3, 0), (0.15, 2.0, 0), (0.55, 4.3, 0), (1.15, 6.5, 0), (1.7, 7.9, 0)]
    rings = lambda a, u: 1 + 0.08 * math.cos(u * 60)
    tube(sc, curve(trunk, 6), lambda u: lerp(0.3, 0.17, u), sides=9, profile=rings, rgb=0x5a4430, top=0x806446)
    top = Vector((1.75, 8.0, 0))
    rng = sc.rng
    for i in range(8):
        a = i / 8 * TAU + 0.3
        d = Vector((math.cos(a), 0, math.sin(a)))
        L = 3.3 + rng.uniform(-0.3, 0.3)
        spine = [top + d * (L * u) + Vector((0, 0.5 * math.sin(u * math.pi * 0.8) - 1.6 * u * u, 0)) for u in (0, 0.2, 0.4, 0.6, 0.8, 1.0)]
        side = Vector((-d.z, 0, d.x))
        verts, faces = [], []
        for k, p in enumerate(spine):
            u = k / (len(spine) - 1)
            w = 0.55 * math.sin(math.pi * min(1, 0.12 + u)) + 0.02
            for s in (-1, 0, 1):
                q = p + side * w * s + Vector((0, -0.12 * abs(s) * w, 0))
                verts.append(G(q.x, q.y, q.z))
        for k in range(len(spine) - 1):
            r0, r1 = k * 3, (k + 1) * 3
            faces += [(r0, r0 + 1, r1 + 1, r1), (r0 + 1, r0 + 2, r1 + 2, r1 + 1)]
            faces += [(r1, r1 + 1, r0 + 1, r0), (r1 + 1, r1 + 2, r0 + 2, r0 + 1)]
        sc.mesh(verts, faces, rgb=0x6a6a6a, top=0xffffff, tint=1.0, smooth=False)
    for i in range(3):
        b = bmesh.new()
        bmesh.ops.create_icosphere(b, subdivisions=1, radius=0.22)
        me = bpy.data.meshes.new('co')
        b.to_mesh(me)
        b.free()
        o = obj(me)
        o.location = G(1.75 + math.cos(i * 2.1) * 0.3, 7.72, math.sin(i * 2.1) * 0.3)
        sc.add(o, rgb=0x4a3420, smooth=True)


@model('rock')
def rock(sc):
    rock_mesh(sc, (1.0, 0.9, 1.0), 3, tris=160, rgb=0xffffff, ao=True)


# --------------------------------------------------------------- buildings --

PLASTER, ROOFS, SHUTTER, BANNER = 1, 2, 3, 1
TIMBER, STONE, DARKSTONE, IRON = 0x33241a, 0x6a645a, 0x56514a, 0x2a2622


def stones(sc, x0, x1, y0, y1, z, depth, rng, rgb=STONE, course=0.32, along='x', bevel=0.0, width=(0.45, 0.85)):
    """A wall face of bevelled stones in courses, each a little different in size and tone."""
    y = y0
    row = 0
    while y < y1 - 0.02:
        h = min(course * rng.uniform(0.85, 1.15), y1 - y)
        x = x0 - (rng.uniform(0, 0.4) if row % 2 else 0)
        while x < x1 - 0.02:
            w = min(rng.uniform(*width), x1 - x)
            if w > 0.05:
                tone = mix(rgb, 0x000000, rng.uniform(0, 0.18))
                tone = (tone[0] << 16) | (tone[1] << 8) | tone[2]
                cx = max(x, x0) + w / 2
                if along == 'x':
                    box(sc, (w - 0.03, h - 0.03, depth * rng.uniform(0.9, 1.1)), (cx, y + h / 2, z), bevel=bevel, rgb=tone)
                else:
                    box(sc, (depth * rng.uniform(0.9, 1.1), h - 0.03, w - 0.03), (z, y + h / 2, cx), bevel=bevel, rgb=tone)
            x += w
        y += h
        row += 1


def planks(sc, w, h, at, n, rgb, rot=(0, 0, 0), depth=0.06, vertical=True):
    """A door, shutter or crate side of planks."""
    for i in range(n):
        if vertical:
            pw = w / n
            box(sc, (pw - 0.012, h, depth), (at[0] - w / 2 + pw * (i + 0.5), at[1], at[2]), rot=rot, rgb=mix_hex(rgb, 0x000000, (i % 3) * 0.06))
        else:
            ph = h / n
            box(sc, (w, ph - 0.012, depth), (at[0], at[1] - h / 2 + ph * (i + 0.5), at[2]), rot=rot, rgb=mix_hex(rgb, 0x000000, (i % 3) * 0.06))


def mix_hex(a, b, t):
    c = mix(a, b, t)
    return (c[0] << 16) | (c[1] << 8) | c[2]


def roof(sc, w, d, rh, y0, over=0.45, rows=7, slot=ROOFS):
    """A gable roof over a w x d house (ridge along x): two slopes of overlapping shingle courses, a ridge beam, bargeboards."""
    half = d / 2 + over
    L = math.hypot(half, rh)
    ang = math.atan2(rh, half)
    for side in (-1, 1):
        for k in range(rows):
            u0, u1 = k / rows, (k + 1.12) / rows
            # Each course a slab, lapping the one below, its edge cut in tiles.
            zc = side * half * (1 - (u0 + u1) / 2)
            yc = y0 + rh * (u0 + u1) / 2 + 0.05
            depth = L * (u1 - u0)
            ntiles = max(3, round((w + over * 2) / 0.55))
            tw = (w + over * 2) / ntiles
            for t in range(ntiles):
                x = -w / 2 - over + tw * (t + 0.5)
                tone = mix_hex(0xffffff, 0x000000, ((t * 7 + k * 3) % 5) * 0.035)
                box(sc, (tw - 0.02, 0.07, depth), (x, yc, zc), rot=(side * ang, 0, 0), slot=slot, rgb=tone)
    box(sc, (w + over * 2 + 0.1, 0.18, 0.2), (0, y0 + rh + 0.06, 0), bevel=0.03, rgb=TIMBER)
    for sx in (-1, 1):
        for side in (-1, 1):
            zc = side * half / 2
            box(sc, (0.1, 0.24, L + 0.05), (sx * (w / 2 + over), y0 + rh / 2 - 0.02, zc), rot=(side * ang, 0, 0), bevel=0.02, rgb=TIMBER)
        # The gable end: plaster in a triangle, framed.
        verts = [G(sx * w / 2, y0, -d / 2), G(sx * w / 2, y0, d / 2), G(sx * w / 2, y0 + rh * (1 - 0.0), 0)]
        sc.mesh(verts, [(0, 1, 2) if sx > 0 else (2, 1, 0)], slot=PLASTER, rgb=0xffffff, smooth=False)
        box(sc, (0.12, rh * 0.85, 0.14), (sx * (w / 2 + 0.03), y0 + rh * 0.42, 0), bevel=0.02, rgb=TIMBER)


def house(sc, w=6.0, d=5.0, h=3.6, chimney=True):
    rng = sc.rng
    # The foundation: a course of stones.
    for side in (-1, 1):
        stones(sc, -w / 2 - 0.15, w / 2 + 0.15, -0.3, 0.6, side * (d / 2 + 0.08), 0.22, rng, course=0.3)
        stones(sc, -d / 2 - 0.15, d / 2 + 0.15, -0.3, 0.6, side * (w / 2 + 0.08), 0.22, rng, course=0.3, along='z')
    # Plastered walls.
    box(sc, (w - 0.05, h - 0.55, d - 0.05), (0, 0.55 + (h - 0.55) / 2, 0), slot=PLASTER, rgb=0xf2f2f2)
    # The timber frame: corner posts, sill, rail and plate, studs and braces.
    for lx, lz in ((-w / 2, -d / 2), (w / 2, -d / 2), (-w / 2, d / 2), (w / 2, d / 2)):
        box(sc, (0.3, h + 0.2, 0.3), (lx, h / 2 + 0.1, lz), bevel=0.04, rgb=TIMBER)
    for fz in (-1, 1):
        zz = fz * (d / 2 + 0.04)
        for yy in (0.62, h * 0.52, h - 0.1):
            box(sc, (w + 0.1, 0.2, 0.12), (0, yy, zz), bevel=0.03, rgb=TIMBER)
        for sx in (-1, 1):
            box(sc, (0.18, h, 0.12), (sx * w * 0.22, h / 2, zz), bevel=0.03, rgb=TIMBER)
            bw, bh = w * 0.28, h * 0.48 - 0.1
            box(sc, (0.16, math.hypot(bw, bh), 0.1), (sx * (w / 2 - bw / 2), h * 0.76, zz), rot=(0, 0, sx * math.atan2(bw, bh)), bevel=0.025, rgb=TIMBER)
    for fx in (-1, 1):
        for yy in (0.62, h * 0.52, h - 0.1):
            box(sc, (0.12, 0.2, d + 0.1), (fx * (w / 2 + 0.04), yy, 0), bevel=0.03, rgb=TIMBER)
        box(sc, (0.12, h - 0.7, 0.16), (fx * (w / 2 + 0.05), h / 2 + 0.3, 0), bevel=0.03, rgb=TIMBER)
    roof(sc, w, d, 1.6 + d * 0.22, h)
    # The door: planks under a lintel, iron straps and a ring.
    dx, dz = -w * 0.12, -d / 2 - 0.07
    planks(sc, 1.05, 1.9, (dx, 1.25, dz), 5, 0x4a3220)
    for yy in (0.6, 1.8):
        box(sc, (0.9, 0.06, 0.03), (dx - 0.05, yy, dz - 0.04), rgb=IRON, bevel=0.01)
    tube(sc, [(dx + 0.38, 1.2, dz - 0.06), (dx + 0.38, 1.12, dz - 0.09), (dx + 0.38, 1.04, dz - 0.06)], 0.012, sides=5, rgb=IRON, cap=False)
    box(sc, (1.35, 0.18, 0.16), (dx, 2.3, dz - 0.02), bevel=0.03, rgb=TIMBER)
    for sx in (-1, 1):
        box(sc, (0.14, 2.0, 0.14), (dx + sx * 0.6, 1.3, dz - 0.01), bevel=0.03, rgb=TIMBER)
    box(sc, (1.5, 0.12, 0.5), (dx, 0.32, dz - 0.25), bevel=0.03, rgb=DARKSTONE)
    # Windows: framed, crossed by mullions, shuttered, a flower box under one.
    for wx, fz in ((w * 0.3, -1), (-w * 0.3, 1), (w * 0.3, 1)):
        zz = fz * (d / 2 + 0.07)
        box(sc, (0.9, 0.1, 0.14), (wx, 1.74, zz), bevel=0.02, rgb=TIMBER)
        box(sc, (0.9, 0.1, 0.12), (wx, 2.46, zz), bevel=0.02, rgb=TIMBER)
        for sx in (-1, 1):
            box(sc, (0.1, 0.72, 0.12), (wx + sx * 0.4, 2.1, zz), bevel=0.02, rgb=TIMBER)
            planks(sc, 0.36, 0.72, (wx + sx * 0.62, 2.1, zz + fz * 0.03), 3, 0xffffff, depth=0.04)
            for p in sc.pieces[-3:]:
                p.slot = SHUTTER
        box(sc, (0.04, 0.66, 0.05), (wx, 2.1, zz + fz * 0.02), rgb=TIMBER)
        box(sc, (0.7, 0.04, 0.05), (wx, 2.1, zz + fz * 0.02), rgb=TIMBER)
        if fz < 0:
            box(sc, (0.85, 0.18, 0.22), (wx, 1.6, zz - 0.13), bevel=0.02, rgb=0x5a3e24)
            for k in range(5):
                b = bmesh.new()
                bmesh.ops.create_icosphere(b, subdivisions=0, radius=0.09)
                me = bpy.data.meshes.new('fl')
                b.to_mesh(me)
                b.free()
                o = obj(me)
                o.location = G(wx - 0.32 + k * 0.16, 1.74, zz - 0.13)
                sc.add(o, rgb=[0xc83a3a, 0xe8c040, 0xd86aa0, 0x5a8a3a, 0xc83a3a][k], smooth=False)
    if chimney:
        lx, lz, top = w / 2 - 0.9, d * 0.18, h + (1.6 + d * 0.22) * 0.95 + 0.6
        stones(sc, lx - 0.4, lx + 0.4, h, top, lz - 0.4, 0.06, rng, rgb=0x5e5a54, course=0.28)
        stones(sc, lx - 0.4, lx + 0.4, h, top, lz + 0.4, 0.06, rng, rgb=0x5e5a54, course=0.28)
        stones(sc, lz - 0.4, lz + 0.4, h, top, lx - 0.4, 0.06, rng, rgb=0x5e5a54, course=0.28, along='z')
        stones(sc, lz - 0.4, lz + 0.4, h, top, lx + 0.4, 0.06, rng, rgb=0x5e5a54, course=0.28, along='z')
        box(sc, (0.78, top - h, 0.78), (lx, (h + top) / 2, lz), rgb=0x3e3a36)
        box(sc, (0.98, 0.18, 0.98), (lx, top, lz), bevel=0.03, rgb=0x3e3a36)


def house_lit(sc, w=6.0, d=5.0, h=3.6):
    """The house's window panes, lit from inside (drawn glowing)."""
    for wx, fz in ((w * 0.3, -1), (-w * 0.3, 1), (w * 0.3, 1)):
        box(sc, (0.72, 0.64, 0.04), (wx, 2.1, fz * (d / 2 + 0.05)), rgb=0xffffff, ao=False)


@model('house')
def house_model(sc):
    house(sc, chimney=False)


@model('house-chimney')
def house_chimney_model(sc):
    house(sc, chimney=True)


@model('house.lit')
def house_lit_model(sc):
    house_lit(sc)


@model('barrel')
def barrel(sc):
    """A coopered barrel: bulging staves, iron hoops, a lid of boards."""
    n = 14
    for i in range(n):
        a = i / n * TAU
        pts = []
        for k in range(5):
            u = k / 4
            r = 0.375 * (0.88 + 0.12 * math.sin(math.pi * u))
            pts.append(G(math.cos(a) * r, u, math.sin(a) * r))
        w = 0.375 * TAU / n * 0.48
        side = Vector((-math.sin(a), -math.cos(a), 0))
        side = Vector((-math.sin(a), 0, 0)) * 0 + G(-math.sin(a), 0, math.cos(a))
        verts, faces = [], []
        out = G(math.cos(a), 0, math.sin(a))
        for k, p in enumerate(pts):
            for s_, dd in ((-1, 0.0), (1, 0.0), (1, -0.03), (-1, -0.03)):
                verts.append(p + side * w * s_ + out * dd)
        for k in range(len(pts) - 1):
            b0, b1 = k * 4, (k + 1) * 4
            for e in range(4):
                f = (b0 + e, b0 + (e + 1) % 4, b1 + (e + 1) % 4, b1 + e)
                faces.append(f[::-1])
        faces.append((0, 1, 2, 3))
        last = (len(pts) - 1) * 4
        faces.append((last + 3, last + 2, last + 1, last))
        sc.mesh(verts, faces, rgb=mix_hex(0x6a4a2c, 0x3a2414, (i % 4) * 0.12), smooth=False)
    for y in (0.12, 0.36, 0.64, 0.88):
        r = (0.375 * (0.88 + 0.12 * math.sin(math.pi * y)) + 0.014) / math.cos(math.pi / n) * math.hypot(1, 0.375 * TAU / n * 0.48 / 0.375)
        tube(sc, [(0, y - 0.03, 0), (0, y + 0.03, 0)], r, sides=n * 2, rgb=IRON, smooth=True)
    R = 0.33 * 0.97
    for k in range(4):
        x = -0.24 + k * 0.16
        L = 2 * math.sqrt(max(0.01, R * R - x * x))
        box(sc, (0.155, 0.03, L), (x, 0.96, 0), rgb=mix_hex(0x4a3420, 0x000000, k * 0.05))


@model('crate')
def crate(sc):
    """A crate of planks with corner battens and a cross brace (unit size)."""
    box(sc, (0.94, 0.94, 0.94), (0, 0.5, 0), rgb=0x3e2a1a)
    for side in range(4):
        rot = (0, side * math.pi / 2, 0)
        c, s_ = math.cos(side * math.pi / 2), math.sin(side * math.pi / 2)
        for i in range(4):
            y = 0.06 + 0.88 * (i + 0.5) / 4
            box(sc, (0.92, 0.2, 0.04), (s_ * 0.48, y, c * 0.48), rot=rot, rgb=mix_hex(0x7a5632, 0x2a1a0a, (i * 3 + side) % 4 * 0.08))
        for sx in (-1, 1):
            box(sc, (0.1, 1.0, 0.05), (s_ * 0.5 + c * sx * 0.45, 0.5, c * 0.5 - s_ * sx * 0.45), rot=rot, bevel=0.012, rgb=0x4e341e)
        box(sc, (0.1, 1.15, 0.04), (s_ * 0.505, 0.5, c * 0.505), rot=(0, side * math.pi / 2, 0.82), bevel=0.012, rgb=0x4e341e)
    for i in range(4):
        box(sc, (0.22, 0.04, 0.96), (-0.36 + i * 0.24, 0.99, 0), rgb=mix_hex(0x7a5632, 0x2a1a0a, i % 3 * 0.08))


@model('fence-post')
def fence_post(sc):
    tube(sc, [(0, -0.2, 0), (0, 0.9, 0), (0, 1.1, 0), (0, 1.22, 0)], lambda u: 0.085 if u < 0.85 else 0.085 * (1 - (u - 0.85) / 0.15) + 0.01, sides=6, rgb=0x4a3624, top=0x5a4430, smooth=False)


@model('fence-rail')
def fence_rail(sc):
    """A split rail one unit long (stretched between posts)."""
    tube(sc, [(-0.5, 0, 0), (0, 0.01, 0), (0.5, 0, 0)], 0.05, sides=5, rgb=0x5a4430, smooth=False, profile=lambda a, u: 1 + 0.15 * math.cos(a * 2))


@model('banner')
def banner(sc):
    """A banner on a pole: a carved crossbar, cloth with a swallowtail and a gold band and emblem."""
    tube(sc, [(0, 0, 0), (0, 3, 0), (0, 6.05, 0)], 0.09, sides=8, rgb=0x2e2218)
    cone(sc, (0, 6.0, 0), (0, 6.35, 0), 0.08, sides=8, rgb=0xb08a3a)
    box(sc, (1.5, 0.1, 0.1), (0.5, 5.7, 0), bevel=0.02, rgb=0x2e2218)
    for x in (-0.22, 1.22):
        b = bmesh.new()
        bmesh.ops.create_icosphere(b, subdivisions=1, radius=0.07)
        me = bpy.data.meshes.new('k')
        b.to_mesh(me)
        b.free()
        o = obj(me)
        o.location = G(x, 5.7, 0)
        sc.add(o, rgb=0xb08a3a)
    # The cloth, hanging in soft folds and ending in a swallowtail.
    cols, rows = 9, 10
    verts, faces = [], []
    for r in range(rows + 1):
        v = r / rows
        for c in range(cols + 1):
            u = c / cols
            y = 5.6 - v * 2.75
            tail = 0.45 * (1 - abs(u - 0.5) * 2) if v > 0.82 else 0.0
            if v > 0.82:
                y += tail * (v - 0.82) / 0.18 * 1.0
            verts.append(G(-0.1 + u * 1.2, y, 0.03 * math.sin(u * TAU * 1.5 + v * 2) * (0.3 + v)))
    for r in range(rows):
        for c in range(cols):
            i = r * (cols + 1) + c
            faces.append((i, i + 1, i + cols + 2, i + cols + 1))
            faces.append((i + cols + 1, i + cols + 2, i + 1, i))
    sc.mesh(verts, faces, slot=BANNER, rgb=0xffffff, smooth=True)
    box(sc, (1.22, 0.12, 0.05), (0.5, 3.15, 0.0), rgb=0xb08a3a)
    box(sc, (0.34, 0.34, 0.06), (0.5, 4.6, 0.02), rot=(0, 0, math.pi / 4), bevel=0.02, rgb=0xd8b050)
    box(sc, (0.34, 0.34, 0.06), (0.5, 4.6, -0.02), rot=(0, 0, math.pi / 4), bevel=0.02, rgb=0xd8b050)


@model('lamp')
def lamp(sc):
    """A town lamp post: a stone foot, a fluted iron post, a lantern with a pointed cap."""
    box(sc, (0.44, 0.3, 0.44), (0, 0.15, 0), bevel=0.05, rgb=DARKSTONE)
    tube(sc, [(0, 0.3, 0), (0, 1.6, 0), (0, 3.15, 0)], lambda u: 0.085 - 0.02 * u, sides=8, profile=lambda a, u: 1 + 0.08 * math.cos(a * 4), rgb=IRON)
    for y in (0.4, 3.1):
        tube(sc, [(0, y - 0.04, 0), (0, y + 0.04, 0)], 0.11, sides=8, rgb=IRON)
    box(sc, (0.42, 0.06, 0.42), (0, 3.62, 0), bevel=0.02, rgb=IRON)
    box(sc, (0.36, 0.06, 0.36), (0, 3.02, 0), bevel=0.02, rgb=IRON)
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(sc, (0.035, 0.6, 0.035), (sx * 0.17, 3.32, sz * 0.17), rgb=IRON)
    cone(sc, (0, 3.64, 0), (0, 3.98, 0), 0.3, sides=4, rgb=IRON)
    b = bmesh.new()
    bmesh.ops.create_icosphere(b, subdivisions=1, radius=0.05)
    me = bpy.data.meshes.new('k')
    b.to_mesh(me)
    b.free()
    o = obj(me)
    o.location = G(0, 4.0, 0)
    sc.add(o, rgb=IRON)


@model('lamp.lit')
def lamp_lit(sc):
    box(sc, (0.3, 0.52, 0.3), (0, 3.32, 0), rgb=0xffffff, ao=False)


@model('wall')
def wall(sc):
    """A stretch of the old town wall (1.2 thick, 6.4 long, one unit high: stretched to height), its coping worn."""
    rng = sc.rng
    for side in (-1, 1):
        stones(sc, -3.2, 3.2, 0.0, 1.0, side * 0.55, 0.14, rng, course=0.34, width=(0.7, 1.3), along='z')
    box(sc, (1.0, 1.0, 6.3), (0, 0.5, 0), rgb=0x56514a)


@model('wall-cap')
def wall_cap(sc):
    rng = sc.rng
    for k in range(9):
        z = -3.25 + (k + 0.5) * 6.5 / 9
        box(sc, (1.5 * rng.uniform(0.92, 1.0), 0.3 * rng.uniform(0.8, 1.1), 6.5 / 9 - 0.04), (rng.uniform(-0.04, 0.04), 0, z), bevel=0.05, rgb=mix_hex(0x56514a, 0x000000, rng.uniform(0, 0.15)))


@model('gate-tower')
def gate_tower(sc):
    """A square gate tower of coursed stone with a jutting parapet and four merlons."""
    rng = sc.rng
    for side in (-1, 1):
        stones(sc, -1.5, 1.5, -0.5, 6.4, side * 1.5, 0.2, rng, course=0.62, width=(0.7, 1.2))
        stones(sc, -1.5, 1.5, -0.5, 6.4, side * 1.5, 0.2, rng, course=0.62, along='z', width=(0.7, 1.2))
    box(sc, (2.9, 6.9, 2.9), (0, 2.95, 0), rgb=0x56514a)
    box(sc, (3.5, 0.5, 3.5), (0, 6.6, 0), bevel=0.06, rgb=DARKSTONE)
    for k in range(8):
        a = k / 8 * TAU
        box(sc, (0.35, 0.3, 0.25), (math.cos(a) * 1.6, 6.25, math.sin(a) * 1.6), rot=(0, -a, 0), bevel=0.03, rgb=DARKSTONE)
    for ox, oz in ((-1.3, -1.3), (1.3, -1.3), (-1.3, 1.3), (1.3, 1.3)):
        box(sc, (0.7, 0.8, 0.7), (ox, 7.2, oz), bevel=0.06, rgb=mix_hex(STONE, 0x000000, rng.uniform(0, 0.12)))
    for oz in (-1, 1):
        box(sc, (0.18, 0.7, 0.08), (0, 4.4, oz * 1.62), rgb=0x14100c)


@model('well')
def well(sc):
    """The town well: a ring of stones, a dark water face, two posts, a windlass and a little roof."""
    rng = sc.rng
    n = 14
    for row in range(3):
        for i in range(n):
            a = (i + row * 0.5) / n * TAU
            r = 1.5
            box(sc, (0.42, 0.36, 0.62), (math.cos(a) * r, 0.18 + row * 0.38, math.sin(a) * r), rot=(0, -a, 0), rgb=mix_hex(STONE, 0x000000, rng.uniform(0, 0.18)))
    tube(sc, [(0, 1.08, 0), (0, 1.22, 0)], 1.72, sides=20, rgb=DARKSTONE, profile=lambda a, u: 1.0, smooth=False)
    tube(sc, [(0, 0.2, 0), (0, 1.0, 0)], 1.25, sides=16, rgb=0x0a1418, cap=True, smooth=False)
    for sx in (-1, 1):
        box(sc, (0.2, 2.8, 0.2), (sx * 1.4, 2.0, 0), bevel=0.03, rgb=TIMBER)
    tube(sc, [(-1.45, 3.0, 0), (1.45, 3.0, 0)], 0.09, sides=8, rgb=TIMBER)
    tube(sc, [(-0.5, 3.0, 0), (0.5, 3.0, 0)], 0.14, sides=8, rgb=0x6a5a40)
    tube(sc, [(0.4, 2.98, 0), (0.4, 2.2, 0)], 0.015, sides=4, rgb=0x8a7a5a)
    tube(sc, [(0.4, 2.2, 0), (0.4, 1.9, 0)], lambda u: 0.17 - 0.03 * u, sides=10, rgb=0x5a3e24)
    box(sc, (3.2, 0.18, 0.18), (0, 3.3, 0), bevel=0.03, rgb=TIMBER)
    for side in (-1, 1):
        box(sc, (3.4, 0.08, 1.15), (0, 3.62, side * 0.5), rot=(side * 0.62, 0, 0), bevel=0.02, slot=ROOFS, rgb=0xffffff)


# --------------------------------------------------------------------- main --


def main():
    names = [a for a in sys.argv[1:] if not a.startswith('--')] or list(MODELS)
    heads, blobs_ = read(OUT) if os.path.exists(OUT) else ([], [])
    keep = [(h, b) for h, b in zip(heads, blobs_) if h['name'] not in names]
    heads, blobs_ = [h for h, _ in keep], [b for _, b in keep]
    for name in names:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = Scene(seed=sum(map(ord, name)))
        MODELS[name](sc)
        m = bake(sc)
        h, b = pack(name, m)
        heads.append(h)
        blobs_.append(b)
        print(name, h['verts'], 'v', h['tris'], 't', flush=True)
        if '--preview' in sys.argv:
            preview(name, m)
    write(heads, blobs_)


if __name__ == '__main__':
    main()
