"""Sculpt one tile of weld bead and bake it to tangent-space normal + AO maps.

Run headless:
    blender -b -P tools/blender/bake_bead_maps.py

Why this is not done in the shader: the simulator used to synthesise the ripple
with a cosine, and a cosine gives a screw thread. A real stack of dimes is a run
of overlapping crescents, each with a steep trailing ridge, a long shallow front
and a toe that lags behind the centreline. That shape is far easier to model
than to write in closed form, and once it is modelled the cavity shading between
ripples can be baked properly instead of guessed.

The tile is seamless along travel: the ripple pitch divides the tile length
exactly, so the maps repeat without a visible join no matter how long the bead.
"""

import os
import math
import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "assets"))

# Millimetres, modelled at 1 unit = 1 mm and only ever used through UVs.
HALF_SPAN = 6.0        # half the mapped strip: bead plus a little parent metal
BEAD_HALF = 4.0        # half the bead itself
CROWN = 1.55           # bead height at the centreline
PITCH = 1.8            # distance between ripples
RIPPLES = 8            # ripples per tile; tile length is RIPPLES * PITCH
TOE_LAG = 0.42         # how far the crescent trails at the toes, in ripples

RES_U, RES_V = 420, 500
BAKE_SIZE = 1024

TILE_V = PITCH * RIPPLES


def bead_height(u, v):
    """Height of the bead surface at (across, along), both in millimetres."""
    a = abs(u) / BEAD_HALF
    if a >= 1.0:
        # Parent plate, with a shallow fillet where the toe wets out.
        toe = max(0.0, 1.0 - (abs(u) - BEAD_HALF) / 1.1)
        return 0.06 * toe * toe

    # Crowned cross-section, flattening slightly at the very centre the way a
    # real puddle settles rather than coming to a point.
    crown = math.cos(a * math.pi / 2.0) ** 0.78

    # The crescent: the toes solidify later than the centre, so each ripple
    # bows backward. This lag is the whole difference between a stack of dimes
    # and a thread.
    phase = 2.0 * math.pi * (v / PITCH + TOE_LAG * a ** 1.5)
    wave = 0.5 + 0.5 * math.cos(phase)
    # Steep trailing ridge, long shallow front.
    ridge = wave ** 0.42

    # A hand-run pass is never perfectly even; without this the tile reads as
    # machined. Kept periodic in v so the tile still repeats cleanly.
    wobble = 1.0 + 0.05 * math.sin(2.0 * math.pi * v / TILE_V * 3.0 + u * 0.9)

    return CROWN * crown * (0.66 + 0.34 * ridge) * wobble


def build_high():
    mesh = bpy.data.meshes.new("bead_high")
    obj = bpy.data.objects.new("bead_high", mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    grid = []
    for iv in range(RES_V + 1):
        v = TILE_V * iv / RES_V
        row = []
        for iu in range(RES_U + 1):
            u = -HALF_SPAN + 2.0 * HALF_SPAN * iu / RES_U
            row.append(bm.verts.new((u, v, bead_height(u, v))))
        grid.append(row)
    bm.verts.ensure_lookup_table()
    for iv in range(RES_V):
        for iu in range(RES_U):
            bm.faces.new((grid[iv][iu], grid[iv][iu + 1], grid[iv + 1][iu + 1], grid[iv + 1][iu]))
    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_smooth()
    return obj


def build_low():
    """Flat receiver carrying the UVs the maps are baked into."""
    mesh = bpy.data.meshes.new("bead_low")
    obj = bpy.data.objects.new("bead_low", mesh)
    bpy.context.collection.objects.link(obj)
    verts = [
        (-HALF_SPAN, 0.0, 0.0),
        (HALF_SPAN, 0.0, 0.0),
        (HALF_SPAN, TILE_V, 0.0),
        (-HALF_SPAN, TILE_V, 0.0),
    ]
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for i, co in enumerate([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]):
        uv.data[i].uv = co
    return obj


def bake_target(obj, name, non_color):
    img = bpy.data.images.new(name, BAKE_SIZE, BAKE_SIZE, alpha=False, float_buffer=False)
    if non_color:
        img.colorspace_settings.name = "Non-Color"

    m = bpy.data.materials.new("bake_" + name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfDiffuse")
    m.node_tree.links.new(bsdf.outputs[0], out.inputs["Surface"])
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    nodes.active = tex

    obj.data.materials.clear()
    obj.data.materials.append(m)
    return img


def run_bake(high, low, bake_type, name, non_color):
    img = bake_target(low, name, non_color)

    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low

    bake = bpy.context.scene.render.bake
    bake.use_selected_to_active = True
    # The crown is 1.55 mm tall, so rays have to start above it and reach the
    # plate; too tight a cage and the ripples come back flat.
    bake.cage_extrusion = 4.0
    bake.max_ray_distance = 8.0
    if bake_type == "NORMAL":
        bake.normal_space = "TANGENT"
        bake.normal_r, bake.normal_g, bake.normal_b = "POS_X", "POS_Y", "POS_Z"

    bpy.ops.object.bake(type=bake_type, use_clear=True)

    path = os.path.join(OUT_DIR, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    print("WROTE %s (%d bytes)" % (path, os.path.getsize(path)))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    os.makedirs(OUT_DIR, exist_ok=True)

    high = build_high()
    low = build_low()

    run_bake(high, low, "NORMAL", "bead_normal", non_color=True)
    # AO is what puts real darkness in the valleys between the dimes; the
    # shader's guess at cavity was the flattest part of the old look.
    run_bake(high, low, "AO", "bead_ao", non_color=True)

    print("TILE %.2f mm along travel, %d ripples" % (TILE_V, RIPPLES))


main()
