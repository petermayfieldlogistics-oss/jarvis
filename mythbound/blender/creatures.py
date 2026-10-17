"""Mythbound's monsters and great foes, remodelled in Blender.

    npx vite-node scripts/dump-creatures.ts     # the bodies as built in code
    python blender/creatures.py [--preview]     # writes src/assets/creatures.bin

Each creature keeps its skeleton (so every animation still plays), but its
body is rebuilt in Blender: the separate tubes and shells it was made of are
fused into one solid (a voxel remesh), smoothed, given surface detail (fur
clumps, scales, ridged shell), brought down to a sensible size, and shaded
with ambient occlusion baked into each vertex. Skin weights come over from
the original by interpolating its nearest face; colour is looked up from the
original's nearest vertex when the game builds the creature, so every colour
of a creature still works. Glowing parts, wing membranes and ghostly robes
stay as the game makes them.

The file holds, per creature and per remodelled surface: positions,
normals, AO, the source vertex for colour, four bone indices and weights,
and triangles. See src/engine/assets.ts for the reader.
"""

import json
import math
import os
import struct
import sys

import bpy  # noqa: I001 (bpy first: it loads bmesh and mathutils)
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

HERE = os.path.dirname(os.path.abspath(__file__))
RIGS = os.path.join(HERE, 'rigs')
OUT = os.path.join(HERE, '..', 'src', 'assets', 'creatures.bin')

# Surfaces that are remodelled (the rest stay as built in code).
SOLID = ('fur', 'scale', 'shell', '0', '1')

# Per creature: voxel size (m, in its own unscaled space), triangles to keep
# per surface, and surface detail depth.
SPEC = {
    'wolf': (0.0055, 7000, 0.004),
    'hound': (0.0055, 7000, 0.004),
    'boar': (0.0055, 6500, 0.004),
    'stag': (0.009, 10000, 0.006),
    'drake': (0.006, 8000, 0.0035),
    'insect': (0.004, 7000, 0.0025),
    'wraith': (0.008, 4000, 0.004),
    'eye': (0.008, 6000, 0.004),
    'witch': (0.008, 9000, 0.005),
    'imp': (0.005, 5500, 0.003),
    'crab': (0.009, 11000, 0.006),
    'serpent': (0.035, 13000, 0.022),
    'dragon': (0.012, 15000, 0.007),
    'siren': (0.01, 13000, 0.006),
    'reaper': (0.009, 7500, 0.005),
    'spider': (0.0035, 8000, 0.002),
}

# Surface detail: Blender texture type and its size.
DETAIL = {
    # Humanoids: '0' is cloth, skin and leather, '1' is armour (kept smooth).
    '0': ('CLOUDS', 0.02),
    '1': ('CLOUDS', 0.5),
    'fur': ('CLOUDS', 0.035),
    'scale': ('VORONOI', 0.025),
    'shell': ('MARBLE', 0.06),
}


def to_blender(x, y, z):
    """The game's Y-up space to Blender's Z-up."""
    return Vector((x, -z, y))


def to_game(v):
    return (v.x, v.z, -v.y)


def source_mesh(name, s):
    """The original surface as a Blender mesh (vertices in Blender space)."""
    pos = s['pos']
    verts = [to_blender(pos[i], pos[i + 1], pos[i + 2]) for i in range(0, len(pos), 3)]
    idx = s['idx']
    tris = [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, len(idx), 3)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], tris)
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob, verts, tris


def evaluated_copy(ob, name):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(out)
    return out


# Bodies with thin, open parts (robes, fins, cloth, armour plates) would
# lose them in a voxel fuse: those are welded and subdivided instead.
ROUNDED = {'witch', 'siren'}


def remodel(kind, surf, src_ob, voxel, tris_target, depth):
    """Fuse (or round), smooth, detail and reduce one surface."""
    work = bpy.data.objects.new(f'{kind}-{surf}-work', src_ob.data.copy())
    bpy.context.collection.objects.link(work)
    if kind in ROUNDED or kind.startswith('h-'):
        bm = bmesh.new()
        bm.from_mesh(work.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bm.to_mesh(work.data)
        bm.free()
        sub = work.modifiers.new('round', 'SUBSURF')
        sub.levels = 1
        sub.render_levels = 1
        sub.boundary_smooth = 'PRESERVE_CORNERS'
        sm = work.modifiers.new('smooth', 'SMOOTH')
        sm.factor = 0.25
        sm.iterations = 1
    else:
        r = work.modifiers.new('fuse', 'REMESH')
        r.mode = 'VOXEL'
        r.voxel_size = voxel
        r.use_smooth_shade = True
        sm = work.modifiers.new('smooth', 'SMOOTH')
        sm.factor = 0.6
        sm.iterations = 3
    kind_tex, size = DETAIL[surf]
    tex = bpy.data.textures.new(f'{kind}-{surf}', kind_tex)
    tex.noise_scale = size * (2.2 if kind in ('serpent', 'dragon') else 1)
    if kind_tex == 'VORONOI':
        tex.distance_metric = 'DISTANCE'
    d = work.modifiers.new('detail', 'DISPLACE')
    d.texture = tex
    d.texture_coords = 'LOCAL'
    d.strength = depth
    d.mid_level = 0.5
    dense = evaluated_copy(work, f'{kind}-{surf}-dense')
    faces = max(1, len(dense.data.polygons) * 2)
    dec = dense.modifiers.new('reduce', 'DECIMATE')
    dec.ratio = min(1.0, tris_target / faces)
    dense.modifiers.new('tris', 'TRIANGULATE')
    final = evaluated_copy(dense, f'{kind}-{surf}')
    for o in (work, dense):
        bpy.data.objects.remove(o, do_unlink=True)
    return final


def transfer(final, src_verts, src_tris, s):
    """Skin weights interpolated from the original's nearest face; the nearest original vertex for colour."""
    tree = BVHTree.FromPolygons(src_verts, src_tris)
    si, sw = s['si'], s['sw']
    me = final.data
    out_si, out_sw, out_src = [], [], []
    for v in me.vertices:
        loc, _n, fi, _d = tree.find_nearest(v.co)
        tri = src_tris[fi]
        bary = poly_3d_calc([src_verts[k] for k in tri], loc)
        acc = {}
        for k, b in zip(tri, bary):
            for j in range(4):
                w = sw[k * 4 + j] * b
                if w > 0:
                    acc[si[k * 4 + j]] = acc.get(si[k * 4 + j], 0) + w
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        total = sum(w for _, w in top) or 1
        q = [round(w / total * 255) for _, w in top]
        q += [0] * (4 - len(q))
        q[0] += 255 - sum(q)
        bones = [b for b, _ in top] + [0] * (4 - len(top))
        out_si.extend(bones)
        out_sw.extend(q)
        out_src.append(tri[max(range(3), key=lambda k: bary[k])])
    return out_si, out_sw, out_src


def bake_ao(finals, occluders, rays=20):
    """Ambient occlusion by casting rays over the hemisphere at each vertex."""
    verts, polys = [], []
    for ob in occluders:
        base = len(verts)
        m = ob.data
        verts.extend(ob.matrix_world @ v.co for v in m.vertices)
        polys.extend([base + i for i in p.vertices] for p in m.polygons)
    tree = BVHTree.FromPolygons(verts, polys)
    # A fixed spread of directions round +Z, turned to each normal.
    dirs = []
    for k in range(rays):
        u = (k + 0.5) / rays
        a = k * 2.399963
        r = math.sqrt(u)
        dirs.append(Vector((math.cos(a) * r, math.sin(a) * r, math.sqrt(1 - u))))
    out = {}
    for ob in finals:
        me = ob.data
        size = max(ob.dimensions) or 1
        reach = size * 0.35
        ao = []
        for v in me.vertices:
            n = me.vertex_normals[v.index].vector if hasattr(me, 'vertex_normals') else v.normal
            rot = Vector((0, 0, 1)).rotation_difference(n)
            hit = 0
            o = v.co + n * reach * 0.004
            for dv in dirs:
                loc, *_ = tree.ray_cast(o, rot @ dv, reach)
                if loc is not None:
                    hit += 1
            ao.append(round(255 * (0.55 + 0.45 * (1 - hit / rays) ** 1.3)))
        out[ob.name] = ao
    return out


def pack(kind, data, surfaces):
    """One creature's record: a JSON header line and its binary arrays."""
    blobs = []
    head = {'kind': kind, 'bones': len(data['bones']), 'bind': [b['w'] for b in data['bones'][:3]], 'surfaces': []}
    for surf, (ob, si, sw, src, ao) in surfaces.items():
        me = ob.data
        nv = len(me.vertices)
        tris = [tuple(p.vertices) for p in me.polygons if len(p.vertices) == 3]
        pts = [to_game(v.co) for v in me.vertices]
        lo = [min(p[k] for p in pts) for k in range(3)]
        hi = [max(p[k] for p in pts) for k in range(3)]
        span = [max(hi[k] - lo[k], 1e-6) for k in range(3)]
        pos = struct.pack(f'<{nv * 3}H', *[round((p[k] - lo[k]) / span[k] * 65535) for p in pts for k in range(3)])
        nrm = struct.pack(f'<{nv * 3}b', *[max(-127, min(127, round(c * 127))) for v in me.vertices for c in to_game(me.vertex_normals[v.index].vector)])
        big = nv > 65535
        idx = struct.pack(f'<{len(tris) * 3}{"I" if big else "H"}', *[i for t in tris for i in t])
        blob = b''.join([pos, nrm, bytes(ao), struct.pack(f'<{nv}{"I" if big else "H"}', *src), bytes(si), bytes(sw), idx])
        head['surfaces'].append({'surf': surf, 'verts': nv, 'tris': len(tris), 'big': big, 'bytes': len(blob), 'box': [round(x, 5) for x in lo + hi]})
        blobs.append(blob)
    return head, b''.join(blobs)


def main():
    files = sorted(f for f in os.listdir(RIGS) if f.endswith('.json'))
    only = [a for a in sys.argv[1:] if not a.startswith('--')]
    heads, body = [], []
    for f in files:
        kind = f[:-5]
        if only and kind not in only:
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        data = json.load(open(os.path.join(RIGS, f)))
        voxel, target, depth = SPEC.get(kind, (0.0045, 7000, 0.0008))
        finals, occluders, done = [], [], {}
        solid = {k: len(v['pos']) for k, v in data['surfaces'].items() if k in SOLID}
        total = sum(solid.values()) or 1
        for surf, s in data['surfaces'].items():
            src, verts, tris = source_mesh(f'{kind}-{surf}-src', s)
            if surf not in SOLID:
                occluders.append(src)
                continue
            final = remodel(kind, surf, src, voxel, max(1500, round(target * solid[surf] / total)), depth)
            si, sw, srcidx = transfer(final, verts, tris, s)
            done[surf] = (final, si, sw, srcidx)
            finals.append(final)
            occluders.append(final)
        if not done:
            continue
        ao = bake_ao(finals, occluders)
        surfaces = {surf: (*v, ao[v[0].name]) for surf, v in done.items()}
        head, blob = pack(kind, data, surfaces)
        heads.append(head)
        body.append(blob)
        print(kind, ', '.join(f"{s['surf']} {s['verts']}v/{s['tris']}t" for s in head['surfaces']), flush=True)
        if '--preview' in sys.argv:
            preview(kind, finals, data)
    if '--merge' in sys.argv and os.path.exists(OUT):
        # Keep the creatures already in the file that weren't remade this time.
        old_heads, old_blobs = read(OUT)
        made = {h['kind'] for h in heads}
        for h, b in zip(old_heads, old_blobs):
            if h['kind'] not in made:
                heads.append(h)
                body.append(b)
    header = json.dumps(heads).encode()
    with open(OUT, 'wb') as fh:
        fh.write(b'MBC2')
        fh.write(struct.pack('<I', len(header)))
        fh.write(header)
        fh.write(b''.join(body))
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')


def read(path):
    """The records of an existing creatures.bin: headers and each creature's bytes."""
    with open(path, 'rb') as fh:
        raw = fh.read()
    hl = struct.unpack('<I', raw[4:8])[0]
    heads = json.loads(raw[8:8 + hl])
    off = 8 + hl
    blobs = []
    for h in heads:
        n = sum(s['bytes'] for s in h['surfaces'])
        blobs.append(raw[off:off + n])
        off += n
    return heads, blobs


def preview(kind, finals, data):
    """The remodel beside the original, rendered with Cycles (AO shown as vertex colour)."""
    scene = bpy.context.scene
    srcs = [o for o in bpy.data.objects if o.name.endswith('-src')]
    size = max(max(o.dimensions) for o in finals)
    # Side on: the original behind (left), the remodel in front (right).
    for o in srcs:
        o.location.y += size * 0.62
    for o in finals:
        o.location.y -= size * 0.62
    grey = bpy.data.materials.new('clay')
    grey.use_nodes = True
    grey.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.55, 0.5, 0.45, 1)
    for o in srcs + finals:
        o.data.materials.clear()
        o.data.materials.append(grey)
        for p in o.data.polygons:
            p.use_smooth = True
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size * 2.6
    top = max(max((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in finals)
    low = min(min((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in finals)
    cam.location = (size * 4, 0, (top + low) / 2 + size * 0.15)
    cam.rotation_euler = (math.radians(85), 0, math.radians(90))
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.25, 0.25, 0.27, 1)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 600
    out = os.path.join(HERE, 'preview', f'{kind}.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
