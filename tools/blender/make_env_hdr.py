"""Render the workshop environment the steel reflects, as an equirectangular HDR.

Run headless:
    blender -b -P tools/blender/make_env_hdr.py

Why this exists: a metal surface is mostly a mirror, so how convincing the steel
looks is decided almost entirely by what there is to reflect. The demo used to
build its environment from three coloured boxes, which gave the plates a flat
grey sheen no amount of texture work could fix. This renders a real room with
real luminance ratios -- darker floor, bright walls and ceiling, a broad soft
overhead panel and hot strip lights, one daylight opening -- which is what puts
both overall brightness and shape into the reflections. Polished stainless is a
mirror: it is only as bright as the room it stands in.

Deliberately small: 1024x512 is ample once three.js runs it through PMREM, and
it keeps the file to a couple of hundred KB so the project still loads offline.
"""

import os
import sys
import math
import bpy

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "workshop.hdr")
OUT = os.path.normpath(OUT)

WIDTH, HEIGHT = 1024, 512
SAMPLES = 96


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, colour, emission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    if emission > 0.0:
        shader = nodes.new("ShaderNodeEmission")
        shader.inputs["Color"].default_value = (*colour, 1.0)
        shader.inputs["Strength"].default_value = emission
    else:
        shader = nodes.new("ShaderNodeBsdfDiffuse")
        shader.inputs["Color"].default_value = (*colour, 1.0)
    links.new(shader.outputs[0], out.inputs["Surface"])
    return m


def box(name, size, location, material, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2.0, size[1] / 2.0, size[2] / 2.0)
    obj.data.materials.append(material)
    return obj


def build_room():
    # Values are chosen for their ratios, not their absolute brightness: the
    # floor has to be clearly darker than the walls and the ceiling strips have
    # to be far brighter than both, or reflections come out as flat grey.
    concrete = mat("concrete", (0.19, 0.195, 0.20))
    wall = mat("wall", (0.58, 0.60, 0.58))
    ceiling = mat("ceiling", (0.50, 0.51, 0.52))
    lamp = mat("lamp", (1.0, 0.97, 0.92), emission=26.0)
    daylight = mat("daylight", (0.62, 0.76, 1.0), emission=13.0)
    steel = mat("shelf", (0.26, 0.28, 0.29))
    paint = mat("paint", (0.42, 0.22, 0.06))

    W, D, H = 9.0, 11.0, 4.0

    box("floor", (W, D, 0.1), (0, 0, -0.05), concrete)
    box("ceiling", (W, D, 0.1), (0, 0, H), ceiling)
    box("wall_n", (W, 0.1, H), (0, D / 2, H / 2), wall)
    box("wall_s", (W, 0.1, H), (0, -D / 2, H / 2), wall)
    box("wall_e", (0.1, D, H), (W / 2, 0, H / 2), wall)
    box("wall_w", (0.1, D, H), (-W / 2, 0, H / 2), wall)

    # Ceiling strips. Long thin sources are what give brushed steel its
    # characteristic stretched highlight; a point light cannot do it.
    for x in (-2.6, 0.0, 2.6):
        for y in (-3.2, 0.6, 3.8):
            box("strip_%s_%s" % (x, y), (0.26, 2.4, 0.06), (x, y, H - 0.18), lamp)

    # A polished sheet is a mirror, so how bright it looks is simply whatever
    # hangs above it. The strips on their own gave hard highlights over a dark
    # field, which reads as gunmetal rather than stainless; this broad soft
    # panel is what produces the long smooth gradient across real sheet.
    softbox = mat("softbox", (1.0, 0.99, 0.97), emission=3.2)
    box("softbox", (6.4, 8.0, 0.05), (0, 0, H - 0.45), softbox)

    # One bright opening, so there is a dominant key direction and the
    # reflections are not uniform from every angle.
    box("doorway", (0.08, 3.0, 2.6), (-W / 2 + 0.12, 1.0, 1.35), daylight)

    # Enough clutter to break the walls up. Smooth empty walls reflect as a
    # featureless gradient, which reads as a studio, not a workshop.
    for i, y in enumerate((-4.0, -1.4, 1.2, 3.6)):
        box("rack_%d" % i, (0.7, 1.8, 2.2), (W / 2 - 0.6, y, 1.1), steel)
        box("bin_%d" % i, (0.6, 0.7, 0.5), (W / 2 - 1.3, y, 0.25), paint if i % 2 else steel)
    box("bench", (2.6, 0.8, 0.9), (0.5, -D / 2 + 1.2, 0.45), steel)
    box("press", (1.1, 1.0, 2.0), (-2.6, D / 2 - 1.4, 1.0), steel)


def setup_camera():
    bpy.ops.object.camera_add(location=(0, 0, 1.5), rotation=(math.pi / 2, 0, 0))
    cam = bpy.context.active_object
    cam.data.type = "PANO"
    # The panorama type moved off the cycles sub-struct in 4.0; support both so
    # this keeps running on whatever Blender is installed.
    if hasattr(cam.data, "panorama_type"):
        cam.data.panorama_type = "EQUIRECTANGULAR"
    else:
        cam.data.cycles.panorama_type = "EQUIRECTANGULAR"
    bpy.context.scene.camera = cam


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    # The whole point is the bright strips, so clamping them would defeat it.
    scene.cycles.sample_clamp_indirect = 0.0
    scene.render.resolution_x = WIDTH
    scene.render.resolution_y = HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "HDR"
    scene.view_settings.view_transform = "Standard"
    scene.render.filepath = OUT


def main():
    clear_scene()
    build_room()
    setup_camera()
    setup_render()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    size = os.path.getsize(OUT) if os.path.exists(OUT) else -1
    print("WROTE %s (%d bytes)" % (OUT, size))


main()
