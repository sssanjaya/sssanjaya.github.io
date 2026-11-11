# Step 2 of the bake: path-trace the light onto the lightmaps with Blender.
# usage: python tools/bake/bake.py <dir with scene.json> <samples> [passes, e.g. lrma] [room|desk]
# Needs the `bpy` module (pip install bpy) or run it with Blender's own Python.
# Writes <dir>/<room|desk>-<l|r|m|a>.f32: one float per texel, rows top-down,
# the light arriving from that source (table lamp, desk lamp, monitor, window).
import base64, json, os, sys, time
import bpy
import numpy as np

out, samples = sys.argv[1], int(sys.argv[2])
passes = sys.argv[3] if len(sys.argv) > 3 else "lrma"
only = sys.argv[4] if len(sys.argv) > 4 else ""  # "room" or "desk" to bake just that lightmap
data = json.load(open(os.path.join(out, "scene.json")))
SIZE = data["size"]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = samples
scene.cycles.use_adaptive_sampling = False
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 5
scene.cycles.sample_clamp_indirect = 1.5
scene.cycles.sample_clamp_direct = 0
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.render.threads_mode = "AUTO"
world = bpy.data.worlds.new("w")
world.use_nodes = True
scene.world = world
sky = world.node_tree.nodes["Background"]
sky.inputs[0].default_value = (0.75, 0.85, 1, 1)

def arr(b, dt):
    return np.frombuffer(base64.b64decode(b), dtype=dt)

def lin(hexs):
    c = [int(hexs[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1]

images = [bpy.data.images.new(n, SIZE, SIZE, alpha=False, float_buffer=True) for n in ("room", "desk")]
mats = {}
emit_nodes = {}
curtain_mix = []

def material(key, color, image=None, emit=None, curtain=False):
    if key in mats:
        return mats[key]
    m = bpy.data.materials.new(str(key))
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    d = nt.nodes.new("ShaderNodeBsdfDiffuse")
    d.inputs[0].default_value = color
    last = d
    if curtain:
        # Cloth lets some light through, scattered.
        t = nt.nodes.new("ShaderNodeBsdfTranslucent")
        t.inputs[0].default_value = color
        mix = nt.nodes.new("ShaderNodeMixShader")
        mix.inputs[0].default_value = 0.0
        nt.links.new(d.outputs[0], mix.inputs[1])
        nt.links.new(t.outputs[0], mix.inputs[2])
        curtain_mix.append(mix)
        last = mix
    if emit:
        e = nt.nodes.new("ShaderNodeEmission")
        e.inputs[1].default_value = 0
        add = nt.nodes.new("ShaderNodeAddShader")
        nt.links.new(last.outputs[0], add.inputs[0])
        nt.links.new(e.outputs[0], add.inputs[1])
        emit_nodes.setdefault(emit, []).append(e)
        last = add
    nt.links.new(last.outputs[0], o.inputs[0])
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.nodes.active = tex
    mats[key] = m
    return m

def build(name, parts, image=None):
    """One object from many meshes: (mesh dict, material) pairs."""
    pos, nrm, idx, uv, mat_of_face, slots = [], [], [], [], [], []
    base = 0
    for d, m in parts:
        p = arr(d["pos"], "<f4").reshape(-1, 3)
        n = arr(d["nrm"], "<f4").reshape(-1, 3)
        f = arr(d["idx"], "<u4").reshape(-1, 3)
        pos.append(np.stack([p[:, 0], -p[:, 2], p[:, 1]], 1))
        nrm.append(np.stack([n[:, 0], -n[:, 2], n[:, 1]], 1))
        idx.append(f + base)
        uv.append(arr(d["uv"], "<f4").reshape(-1, 2) if d.get("uv") else np.zeros((len(p), 2), "f4"))
        if m not in slots:
            slots.append(m)
        mat_of_face.append(np.full(len(f), slots.index(m)))
        base += len(p)
    pos, nrm, idx, uv, mat_of_face = map(np.concatenate, (pos, nrm, idx, uv, mat_of_face))
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(pos))
    me.vertices.foreach_set("co", pos.ravel())
    me.loops.add(idx.size)
    me.loops.foreach_set("vertex_index", idx.ravel().astype("i4"))
    me.polygons.add(len(idx))
    me.polygons.foreach_set("loop_start", np.arange(0, idx.size, 3, dtype="i4"))
    me.polygons.foreach_set("loop_total", np.full(len(idx), 3, dtype="i4"))
    for m in slots:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", mat_of_face.astype("i4"))
    me.polygons.foreach_set("use_smooth", np.ones(len(idx), dtype=bool))
    me.update(calc_edges=True)
    layer = me.uv_layers.new(name="lm")
    flat = idx.ravel()
    layer.data.foreach_set("uv", np.stack([uv[flat, 0], 1 - uv[flat, 1]], 1).ravel())
    me.normals_split_custom_set_from_vertices(nrm.tolist())
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob

groups = {"room": [], "desk": [], "probe": [], "solid": [], "emit": []}
for d in data["meshes"]:
    kind = d["kind"]
    if kind.startswith("emit:"):
        src = kind[5:]
        groups["emit"].append((d, material(("emit", src), (0.8, 0.8, 0.8, 1), emit=src[0])))
    elif kind == "solid":
        groups["solid"].append((d, material(("solid", d["color"]), lin(d["color"]))))
    else:
        image = images[d["atlas"]]
        m = material((d["atlas"], d["color"], d["role"]), lin(d["color"]), image=image, curtain=d["role"] == "curtain")
        groups["probe" if kind == "probe" else ("desk" if d["atlas"] else "room")].append((d, m))

objs = {k: build(k, v) for k, v in groups.items() if v}
if "probe" in objs:
    p = objs["probe"]
    p.visible_camera = p.visible_diffuse = p.visible_glossy = p.visible_transmission = p.visible_shadow = False

# The window, behind the curtain: daylight for the fourth lightmap.
WALL_Z = -0.46
me = bpy.data.meshes.new("window")
me.from_pydata([(0.75, -(WALL_Z + 0.004), 0.9), (2.1, -(WALL_Z + 0.004), 0.9), (2.1, -(WALL_Z + 0.004), 2.3), (0.75, -(WALL_Z + 0.004), 2.3)], [], [(0, 1, 2, 3)])
me.materials.append(material(("emit", "A"), (0.8, 0.8, 0.8, 1), emit="A"))
scene.collection.objects.link(bpy.data.objects.new("window", me))

STRENGTH = {"L": 1.0, "Lbulb": 14.0, "R": 1.0, "M": 1.0, "A": 1.0}

def light(source):
    for key, nodes in emit_nodes.items():
        for e in nodes:
            e.inputs[1].default_value = 0
    for (kind, src), m in ((k, v) for k, v in mats.items() if k[0] == "emit"):
        if src[0] == source:
            for e in [n for n in m.node_tree.nodes if n.type == "EMISSION"]:
                e.inputs[1].default_value = STRENGTH[src]
    sky.inputs[1].default_value = 0.04 if source == "A" else 0
    for mix in curtain_mix:
        mix.inputs[0].default_value = 0.4 if source == "A" else 0.0

def bake(names):
    bpy.ops.object.select_all(action="DESELECT")
    for n in names:
        objs[n].select_set(True)
    bpy.context.view_layer.objects.active = objs[names[0]]
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=8, use_clear=True)

buf = np.empty(SIZE * SIZE * 4, dtype="f4")
for source in passes.upper():
    light(source)
    for a, names in enumerate((["room"] + (["probe"] if "probe" in objs else []), ["desk"])):
        if only and only != ["room", "desk"][a]:
            continue
        t = time.time()
        bake(names)
        images[a].pixels.foreach_get(buf)
        lum = buf.reshape(SIZE, SIZE, 4)[::-1, :, :3].mean(2)
        name = f"{['room', 'desk'][a]}-{source.lower()}.f32"
        lum.astype("<f4").tofile(os.path.join(out, name))
        print(f"{name}: {time.time() - t:.0f}s  max {lum.max():.3f}  mean {lum.mean():.4f}", flush=True)
