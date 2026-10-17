"""Shared tools for building Mythbound's models in Blender (headless, as the bpy module).

The organic parts of a creature are metaballs (capsules and ellipsoids that
melt into one another like clay), turned into a mesh, evened out with a
voxel remesh, smoothed, given surface detail and brought down to a budget.
The hard parts (claws, teeth, horns, antlers, spikes, eyes) are tapered
tubes and cones built directly. Every vertex knows which body part it came
from: that part decides its colour slot (the creature's own colour, a light
belly colour, a dark marking colour, or a fixed colour) and the bones it may
follow. Weights are worked out from each bone's segment and then smoothed
across the surface, ambient occlusion is ray-traced into every vertex, and
the result is written for the game (see pack()).
"""

import math
import random
import struct

import bpy  # noqa: I001 (bpy first: it loads bmesh and mathutils)
import bmesh
from mathutils import Euler, Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

# Colour slots, worked out from the creature's colour when the game builds it.
MAIN, LIGHT, DARK, FIXED, GLOW = 0, 1, 2, 3, 4


def G(x, y, z):
    """The game's Y-up coordinates to Blender's Z-up."""
    return Vector((x, -z, y))


def to_game(v):
    return (v.x, v.z, -v.y)


def lerp(a, b, t):
    return a + (b - a) * t


def hexrgb(h):
    return ((h >> 16) & 255, (h >> 8) & 255, h & 255)


class Part:
    """A body part: where it is, how it's coloured and which bones it follows."""

    def __init__(self, bones, slot=MAIN, rgb=0xffffff, belly=False, mottle=0.0, stripes=None, back=None, light=None, under=LIGHT):
        self.bones = list(bones)
        self.slot = slot
        self.rgb = rgb
        # Underside turns to the light colour; `back` (a threshold) darkens the top; `light` (a function) picks light patches.
        self.belly = belly
        self.mottle = mottle
        self.stripes = stripes
        self.back = back
        self.light = light
        self.under = under

    def dist(self, p):
        raise NotImplementedError


class Capsule(Part):
    def __init__(self, a, b, r0, r1, bones, **kw):
        super().__init__(bones, **kw)
        self.a, self.b, self.r0, self.r1 = Vector(a), Vector(b), r0, r1

    def dist(self, p):
        ab = self.b - self.a
        L2 = ab.length_squared or 1e-9
        t = max(0.0, min(1.0, (p - self.a).dot(ab) / L2))
        return (p - (self.a + ab * t)).length - lerp(self.r0, self.r1, t)


class Blob(Part):
    def __init__(self, c, rx, ry, rz, rot, bones, **kw):
        super().__init__(bones, **kw)
        self.c = Vector(c)
        self.r = (rx, ry, rz)
        self.q = rot if isinstance(rot, Quaternion) else Euler(rot).to_quaternion()
        self.inv = self.q.inverted()

    def dist(self, p):
        d = self.inv @ (p - self.c)
        k = math.sqrt((d.x / self.r[0]) ** 2 + (d.y / self.r[1]) ** 2 + (d.z / self.r[2]) ** 2)
        return (k - 1) * min(self.r)


def look(direction, up=Vector((0, 0, 1))):
    """A rotation turning local +X toward `direction` (for metaball capsules and blobs)."""
    d = Vector(direction).normalized()
    return d.to_track_quat('X', 'Z' if abs(d.z) < 0.95 else 'Y')


class Beast:
    """One creature being built: its skeleton (from the game's dump), organic parts and hard parts."""

    def __init__(self, data, seed=1):
        self.data = data
        self.n = data.get('names') or {}
        self.B = [G(*b['w']) for b in data['bones']]
        self.parent = [b['parent'] for b in data['bones']]
        self.children = [[] for _ in self.B]
        for i, p in enumerate(self.parent):
            if p >= 0:
                self.children[p].append(i)
        self.balls = []  # (Part, metaball element spec)
        self.hard = []  # (surface, bmesh, Part)
        self.rng = random.Random(seed)

    # ------------------------------------------------------------ organic --

    def capsule(self, a, b, r0, r1=None, bones=(), steps=None, stiff=2.0, **kw):
        """A tapered limb or neck from a to b (metaball capsules in steps; a negative radius carves)."""
        r1 = r0 if r1 is None else r1
        a, b = Vector(a), Vector(b)
        L = (b - a).length
        n = steps or max(1, int(L / (min(abs(r0), abs(r1)) * 1.2 + 1e-6)))
        n = min(n, 24)
        part = Capsule(a, b, abs(r0), abs(r1), bones, **kw)
        for k in range(n):
            t0, t1 = k / n, (k + 1) / n
            pa, pb = a.lerp(b, t0), a.lerp(b, t1)
            r = lerp(r0, r1, (t0 + t1) / 2)
            self.balls.append((part, ('CAPSULE', (pa + pb) / 2, look(pb - pa) if (pb - pa).length > 1e-6 else Quaternion(), ((pb - pa).length / 2, 0, 0), abs(r), stiff, r < 0)))
        return part

    def blob(self, c, rx, ry, rz, rot=(0, 0, 0), bones=(), stiff=2.0, neg=False, **kw):
        """
        An ellipsoid with radii in the game's axes (rx across, ry up, rz
        forward) and a turn given as a game-axis Euler (pitch, yaw, roll),
        or a quaternion from look().
        """
        if not isinstance(rot, Quaternion):
            rot = Euler((rot[0], -rot[2], rot[1])).to_quaternion()
        rx, ry, rz = rx, rz, ry
        part = Blob(c, rx, ry, rz, rot, bones, **kw)
        self.balls.append((part, ('ELLIPSOID', Vector(c), part.q, (rx, ry, rz), 1.0, stiff, neg)))
        return part

    def chain(self, pts, radii, bones, **kw):
        """Capsules through a run of points, radii given at each point."""
        parts = []
        for k in range(len(pts) - 1):
            parts.append(self.capsule(pts[k], pts[k + 1], radii[k], radii[k + 1], bones=bones[k] if isinstance(bones[0], (list, tuple)) else bones, **kw))
        return parts

    def surface(self, origin, direction, far=4.0):
        """Where a ray from `origin` first meets the clay so far (for setting spines, scales and eyes on the skin)."""
        o, d = Vector(origin), Vector(direction).normalized()
        parts = [p for p, spec in self.balls if not spec[6]]
        t = 0.0
        while t < far:
            p = o + d * t
            k = min(pt.dist(p) for pt in parts)
            if k < 0.002:
                return p
            t += max(k * 0.8, 0.002)
        return o + d * far

    def top(self, x, z, y0=6.0):
        """The highest point of the clay above game (x, z)."""
        return self.surface(G(x, y0, z), Vector((0, 0, -1)), far=y0 + 1)

    # --------------------------------------------------------------- hard --

    def tube(self, pts, radius, bones, surface='shell', slot=FIXED, rgb=0xd8d0b8, n=8, cap=True, flat=False, squash=1.0):
        """A tapered tube along points (horns, claws, antlers, teeth, spikes); radius is a function of t or a number."""
        pts = [Vector(p) for p in pts]
        bm = bmesh.new()
        rings = []
        t0 = (pts[1] - pts[0]).normalized()
        up = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
        nrm = t0.cross(up).normalized()
        for k, p in enumerate(pts):
            a = pts[max(0, k - 1)]
            b = pts[min(len(pts) - 1, k + 1)]
            t = (b - a).normalized()
            nrm = (nrm - t * nrm.dot(t)).normalized()
            bn = t.cross(nrm).normalized()
            r = radius(k / (len(pts) - 1)) if callable(radius) else radius
            r = max(r, 0.0004)
            rings.append([bm.verts.new(p + (nrm * math.cos(i / n * math.tau) + bn * math.sin(i / n * math.tau) * squash) * r) for i in range(n)])
        for a, b in zip(rings, rings[1:]):
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new([a[i], a[j], b[j], b[i]])
        if cap:
            bm.faces.new(list(reversed(rings[0])))
            bm.faces.new(rings[-1])
        for f in bm.faces:
            f.smooth = not flat
        self.hard.append((surface, bm, Part(bones, slot=slot, rgb=rgb)))

    def cone(self, base, tip, r, bones, **kw):
        self.tube([base, Vector(base).lerp(Vector(tip), 0.5), tip], lambda t: r * (1 - t) ** 1.2, bones, **kw)

    def eye(self, c, r, bones, rgb=0xffc040, glow=True, squash=1.0, facing=None):
        """An eye: a glowing (or dark, glossy) bead set into the head."""
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=r)
        for v in bm.verts:
            v.co.y *= squash
            v.co += Vector(c)
        for f in bm.faces:
            f.smooth = True
        self.hard.append(('glow' if glow else 'shell', bm, Part(bones, slot=GLOW if glow else FIXED, rgb=rgb)))

    # -------------------------------------------------------------- build --

    def child(self, i):
        """A bone's first child (or none)."""
        return self.children[i][0] if self.children[i] else None

    def build(self, voxel, tris, detail=('CLOUDS', 0.03, 0.003), surface='fur'):
        """Melts the organic parts into one surface and returns every finished surface's arrays."""
        out = {}
        if self.balls:
            out[surface] = self._organic(voxel, tris, detail)
        by_surf = {}
        for surf, bm, part in self.hard:
            by_surf.setdefault(surf, []).append((bm, part))
        for surf, items in by_surf.items():
            verts, faces, parts = [], [], []
            for bm, part in items:
                bm.verts.index_update()
                base = len(verts)
                verts.extend(v.co.copy() for v in bm.verts)
                parts.extend([part] * len(bm.verts))
                faces.extend([[base + v.index for v in f.verts] for f in bm.faces])
                bm.free()
            tri = []
            for f in faces:
                for k in range(1, len(f) - 1):
                    tri.append((f[0], f[k], f[k + 1]))
            rec = out.get(surf)
            normals = vertex_normals(verts, tri)
            if rec:
                off = len(rec['verts'])
                rec['verts'].extend(verts)
                rec['normals'].extend(normals)
                rec['parts'].extend(parts)
                rec['tris'].extend((a + off, b + off, c + off) for a, b, c in tri)
            else:
                out[surf] = {'verts': verts, 'normals': normals, 'parts': parts, 'tris': tri}
        for surf, rec in out.items():
            rec['weights'] = self._weights(rec)
        self._ao(out)
        return out

    def _organic(self, voxel, tris, detail):
        mb = bpy.data.metaballs.new('body')
        mb.resolution = voxel * 0.8
        mb.render_resolution = voxel * 0.8
        mb.threshold = 0.6
        ob = bpy.data.objects.new('body', mb)
        bpy.context.collection.objects.link(ob)
        for part, (kind, co, q, size, r, stiff, neg) in self.balls:
            e = mb.elements.new(type=kind)
            e.co = co
            e.rotation = q
            e.stiffness = stiff
            e.use_negative = neg
            # A lone metaball shows at 0.575 of its radius (threshold 0.6, stiffness 2): ask for what is meant.
            if kind == 'CAPSULE':
                e.radius = r / 0.575
                e.size_x = max(size[0], 1e-4)
            else:
                e.radius = 1 / 0.575
                e.size_x, e.size_y, e.size_z = size
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        work = bpy.data.objects.new('work', me)
        bpy.context.collection.objects.link(work)
        rm = work.modifiers.new('even', 'REMESH')
        rm.mode = 'VOXEL'
        rm.voxel_size = voxel
        sm = work.modifiers.new('smooth', 'SMOOTH')
        sm.factor = 0.5
        sm.iterations = 2
        kind, size, depth = detail
        if depth:
            tex = bpy.data.textures.new('detail', kind)
            tex.noise_scale = size
            d = work.modifiers.new('detail', 'DISPLACE')
            d.texture = tex
            d.texture_coords = 'LOCAL'
            d.strength = depth
        dg = bpy.context.evaluated_depsgraph_get()
        dense = bpy.data.objects.new('dense', bpy.data.meshes.new_from_object(work.evaluated_get(dg)))
        bpy.context.collection.objects.link(dense)
        dec = dense.modifiers.new('reduce', 'DECIMATE')
        dec.ratio = min(1.0, tris / max(1, len(dense.data.polygons) * 2))
        dense.modifiers.new('tris', 'TRIANGULATE')
        dg = bpy.context.evaluated_depsgraph_get()
        fin = bpy.data.meshes.new_from_object(dense.evaluated_get(dg))
        verts = [v.co.copy() for v in fin.vertices]
        tri = [tuple(p.vertices) for p in fin.polygons if len(p.vertices) == 3]
        normals = [fin.vertex_normals[i].vector.copy() for i in range(len(verts))]
        # Each vertex belongs to the part whose surface it lies nearest.
        allparts = []
        seen = set()
        for part, _ in self.balls:
            if id(part) not in seen and not any(spec[6] for p2, spec in self.balls if p2 is part):
                seen.add(id(part))
                allparts.append(part)
        parts = [min(allparts, key=lambda pt: pt.dist(v)) for v in verts]
        for o in (ob, work, dense):
            bpy.data.objects.remove(o, do_unlink=True)
        return {'verts': verts, 'normals': normals, 'parts': parts, 'tris': tri}

    def _segment(self, i):
        """A bone's segment: from its joint to its first child (or a little past itself)."""
        a = self.B[i]
        c = self.child(i)
        if c is not None:
            return a, self.B[c]
        p = self.parent[i]
        d = (a - self.B[p]) * 0.5 if p >= 0 else Vector((0, 0, 0.01))
        return a, a + d

    def _weights(self, rec):
        verts, parts, tris = rec['verts'], rec['parts'], rec['tris']
        raw = []
        for v, part in zip(verts, parts):
            ws = {}
            for b in part.bones:
                a, c = self._segment(b)
                ab = c - a
                L2 = ab.length_squared or 1e-9
                t = max(0.0, min(1.0, (v - a).dot(ab) / L2))
                d = (v - (a + ab * t)).length + 1e-4
                ws[b] = 1 / d ** 3
            s = sum(ws.values()) or 1
            raw.append({b: w / s for b, w in ws.items()})
        # Smooth across the surface so parts blend where they meet.
        nb = [set() for _ in verts]
        for a, b, c in tris:
            nb[a] |= {b, c}
            nb[b] |= {a, c}
            nb[c] |= {a, b}
        cur = raw
        for _ in range(4):
            nxt = []
            for i, w in enumerate(cur):
                acc = dict((b, x * 2) for b, x in w.items())
                for j in nb[i]:
                    for b, x in cur[j].items():
                        acc[b] = acc.get(b, 0) + x
                s = sum(acc.values()) or 1
                nxt.append({b: x / s for b, x in acc.items()})
            cur = nxt
        out = []
        for w in cur:
            top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
            s = sum(x for _, x in top) or 1
            q = [round(x / s * 255) for _, x in top]
            q += [0] * (4 - len(q))
            q[0] += 255 - sum(q)
            out.append(([b for b, _ in top] + [top[0][0]] * (4 - len(top)), q))
        return out

    def _ao(self, out, rays=18):
        verts, polys = [], []
        for rec in out.values():
            base = len(verts)
            verts.extend(rec['verts'])
            polys.extend((base + a, base + b, base + c) for a, b, c in rec['tris'])
        tree = BVHTree.FromPolygons(verts, polys)
        lo = Vector([min(v[k] for v in verts) for k in range(3)])
        hi = Vector([max(v[k] for v in verts) for k in range(3)])
        reach = (hi - lo).length * 0.25
        dirs = []
        for k in range(rays):
            u = (k + 0.5) / rays
            a = k * 2.399963
            r = math.sqrt(u)
            dirs.append(Vector((math.cos(a) * r, math.sin(a) * r, math.sqrt(1 - u))))
        for rec in out.values():
            ao = []
            for v, n in zip(rec['verts'], rec['normals']):
                rot = Vector((0, 0, 1)).rotation_difference(n)
                o = v + n * reach * 0.003
                hit = sum(1 for d in dirs if tree.ray_cast(o, rot @ d, reach)[0] is not None)
                ao.append(0.5 + 0.5 * (1 - hit / rays) ** 1.2)
            rec['ao'] = ao

    # ------------------------------------------------------------- colour --

    def shade(self, rec, i):
        """Slot, shade (0-1) and fixed colour for one vertex: its part's colouring, markings and occlusion."""
        part = rec['parts'][i]
        v, n = rec['verts'][i], rec['normals'][i]
        slot = part.slot
        s = rec['ao'][i]
        if part.belly is not False and part.belly is not None and slot == MAIN and n.z < (-0.25 if part.belly is True else part.belly):
            slot = part.under
        if part.back is not None and slot == MAIN and n.z > part.back + 0.12 * (noise3(v * 7) - 0.5):
            slot = DARK
        if part.light and slot == MAIN and part.light(v, n):
            slot = LIGHT
        if part.mottle:
            s *= 1 - part.mottle * noise3(v * 9.0)
        if part.stripes and slot == MAIN:
            axis, freq, width = part.stripes
            if math.sin(v.dot(Vector(axis)) * freq + noise3(v * 4) * 2) > 1 - width * 2:
                slot = DARK
        return slot, max(0.0, min(1.0, s)), part.rgb


def noise3(p):
    """A cheap smooth noise in 0..1."""
    return 0.5 + 0.25 * (math.sin(p.x * 1.7 + p.y * 2.3) * math.cos(p.y * 1.3 - p.z * 2.9) + math.sin(p.z * 2.1 + p.x * 0.7))


def vertex_normals(verts, tris):
    acc = [Vector() for _ in verts]
    for a, b, c in tris:
        n = (verts[b] - verts[a]).cross(verts[c] - verts[a])
        acc[a] += n
        acc[b] += n
        acc[c] += n
    return [n.normalized() if n.length > 1e-12 else Vector((0, 0, 1)) for n in acc]


def pack(beast, surfaces, replace):
    """One creature's record for creatures.bin (format 3): header and bytes."""
    data = beast.data
    head = {'kind': data['kind'], 'bones': len(data['bones']), 'bind': [b['w'] for b in data['bones'][:3]], 'replace': replace, 'surfaces': []}
    blobs = []
    for surf, rec in surfaces.items():
        verts = rec['verts']
        nv = len(verts)
        pts = [to_game(v) for v in verts]
        lo = [min(p[k] for p in pts) for k in range(3)]
        hi = [max(p[k] for p in pts) for k in range(3)]
        span = [max(hi[k] - lo[k], 1e-6) for k in range(3)]
        pos = struct.pack(f'<{nv * 3}H', *[round((p[k] - lo[k]) / span[k] * 65535) for p in pts for k in range(3)])
        nrm = struct.pack(f'<{nv * 3}b', *[max(-127, min(127, round(c * 127))) for n in rec['normals'] for c in to_game(n)])
        cols = [beast.shade(rec, i) for i in range(nv)]
        slot = bytes(c[0] for c in cols)
        shade = bytes(round(c[1] * 255) for c in cols)
        rgb = bytes(x for c in cols for x in hexrgb(c[2]))
        si = bytes(b for w in rec['weights'] for b in w[0])
        sw = bytes(x for w in rec['weights'] for x in w[1])
        tris = rec['tris']
        big = nv > 65535
        idx = struct.pack(f'<{len(tris) * 3}{"I" if big else "H"}', *[i for t in tris for i in t])
        blob = b''.join([pos, nrm, slot, shade, rgb, si, sw, idx])
        head['surfaces'].append({'surf': surf, 'mode': 'pal', 'verts': nv, 'tris': len(tris), 'big': big, 'bytes': len(blob), 'box': [round(x, 5) for x in lo + hi]})
        blobs.append(blob)
    return head, b''.join(blobs)
