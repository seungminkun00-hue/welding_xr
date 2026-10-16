"""Photo-referenced workshop, metres. Run with Blender --background --python this_file.

References: IMG_0548..IMG_0577 and selected frames of the supplied MOV.
Dimensions and concealed mechanisms are approximations, not a machine drawing.
Authoring helpers use Three's X/right, Y/up, Z/front convention.
"""
import bpy, math, random, json, sys
from pathlib import Path
from mathutils import Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'field-workshop'
OUT.mkdir(parents=True, exist_ok=True)
LAYOUT=json.loads((OUT/'joint-layout.json').read_text(encoding='utf-8'))
random.seed(548)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def v(p): return Vector((p[0], -p[2], p[1]))
def group(name, pos=(0,0,0), parent=None):
    o=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(o)
    o.parent=parent; o.location=v(pos); return o

def surface(name, color, metal=0, rough=.55, wear=False):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    if wear:
        rng=np.random.default_rng(sum(map(ord,name))); n=512
        noise=rng.random((n,n)); rgb=np.zeros((n,n,4),dtype=np.float32)
        for c in range(3): rgb[:,:,c]=np.clip(color[c]*(.78+.26*noise),0,1)
        for _ in range(430):
            x,y=rng.integers(0,n,2); length=int(rng.integers(2,45))
            rgb[y,x:min(n,x+length),:3]*=rng.uniform(.35,.75)
        rgb[:,:,3]=1
        im=bpy.data.images.new(name+' Wear',width=n,height=n)
        im.pixels.foreach_set(rgb.ravel()); im.pack()
        tex=m.node_tree.nodes.new('ShaderNodeTexImage'); tex.image=im
        m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    return m

red=surface('Worn red lift enamel',(.56,.045,.035),.3,.55,True)
blue=surface('Blue workshop frames',(.025,.24,.32),.45,.5,True)
binblue=surface('Blue polypropylene bins',(.025,.075,.32),.05,.65,True)
yellow=surface('Yellow welding curtains',(.94,.62,.012),0,.73,True)
black=surface('Blackened fixture steel',(.035,.042,.044),.72,.43,True)
rubber=surface('Rubber and extraction hose',(.033,.037,.034),.02,.84)
steel=surface('Brushed stainless steel',(.52,.56,.57),.88,.3,True)
pipeSteel=surface('Training polished tube PBR',(1,1,1),1,1)
p=pipeSteel.node_tree.nodes.get('Principled BSDF')
for slot,input_name in [('map','Base Color'),('roughnessMap','Roughness'),('metalnessMap','Metallic'),('normalMap','Normal')]:
    image_path=OUT/'steel'/(slot+'.png')
    if not image_path.exists():
        raise RuntimeError('Run node tools/export_field_steel.mjs before building the workshop.')
    im=bpy.data.images.load(str(image_path)); im.colorspace_settings.name='sRGB' if slot=='map' else 'Non-Color'; im.pack()
    tex=pipeSteel.node_tree.nodes.new('ShaderNodeTexImage'); tex.image=im; tex.extension='REPEAT'
    output=tex.outputs['Color']
    if slot=='normalMap':
        normal=pipeSteel.node_tree.nodes.new('ShaderNodeNormalMap'); normal.inputs['Strength'].default_value=.18
        pipeSteel.node_tree.links.new(output,normal.inputs['Color']); output=normal.outputs['Normal']
    pipeSteel.node_tree.links.new(output,p.inputs[input_name])
darksteel=surface('Dull steel edges',(.18,.205,.20),.82,.5,True)
white=surface('Warm equipment casing',(.65,.66,.59),.25,.6,True)
floor=surface('Concrete scuffed workshop floor',(.22,.24,.225),0,.93,True)
paper=surface('Off white labels',(.84,.84,.73),0,.9)
green=surface('Green machine display',(.05,.6,.17),0,.45)
amber=surface('Amber indicator',(.85,.25,.02),.1,.4)
wall=surface('Factory wall',(.36,.39,.36),0,.92)
lamp=surface('Ceiling lamp diffuser',(.85,.9,.95),0,.4)
lamp.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(.85,.9,1,1)
lamp.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=2

def finish(o,name,mat,parent,pos):
    o.name=name; o.parent=parent; o.location=v(pos)
    o.data.materials.append(mat); return o

def pipe_uv(mesh,coords,circumference,tile=.06):
    # Metre-based UVs preserve the existing polishedTube's 60 mm grain scale.
    uv=mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    uv.active_render=True
    for face in mesh.polygons:
        values=[coords[mesh.loops[i].vertex_index] for i in face.loop_indices]
        crosses=max(p[0] for p in values)-min(p[0] for p in values)>circumference/2
        for loop,(u,w) in zip(face.loop_indices,values):
            if crosses and u<circumference/2: u+=circumference
            uv.data[loop].uv=(u/tile,w/tile)

def box(name,size,pos,mat,parent,bevel=.003):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o=bpy.context.object; o.dimensions=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Small worn edge','BEVEL'); mod.width=bevel; mod.segments=1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,mat,parent,pos)

def cyl(name,r,length,pos,mat,parent,axis=(0,1,0),verts=24,r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=verts,radius1=r,radius2=r if r2 is None else r2,depth=length)
    o=finish(bpy.context.object,name,mat,parent,pos)
    o.rotation_mode='QUATERNION'
    o.rotation_quaternion=Vector((0,0,1)).rotation_difference(v(axis).normalized())
    for p in o.data.polygons: p.use_smooth=len(p.vertices)==4
    if mat==pipeSteel:
        pipe_uv(o.data,[((math.atan2(pt.co.y,pt.co.x)%(2*math.pi))*r,pt.co.z+length/2) for pt in o.data.vertices],2*math.pi*r)
        for face in o.data.polygons:
            if len(face.vertices)>4:
                for loop in face.loop_indices:
                    co=o.data.vertices[o.data.loops[loop].vertex_index].co
                    o.data.uv_layers.active.data[loop].uv=(co.x/.06,co.y/.06)
    return o

def rod(name,a,b,r,mat,parent,verts=12):
    a,b=Vector(a),Vector(b)
    return cyl(name,r,(b-a).length,(a+b)/2,mat,parent,b-a,verts)

def tube(name,r,wallth,length,pos,mat,parent,axis=(0,0,1),segments=48):
    # Closed wall section with open bore, four rings and explicit inward faces.
    vertices=[]; faces=[]
    for z,rad in [(-length/2,r),(length/2,r),(-length/2,r-wallth),(length/2,r-wallth)]:
        vertices += [(rad*math.cos(i*2*math.pi/segments),rad*math.sin(i*2*math.pi/segments),z) for i in range(segments)]
    for i in range(segments):
        j=(i+1)%segments
        faces += [(i,j,segments+j,segments+i),(2*segments+j,2*segments+i,3*segments+i,3*segments+j),
                  (j,i,2*segments+i,2*segments+j),(segments+i,segments+j,3*segments+j,3*segments+i)]
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(vertices,[],faces); mesh.update()
    pipe_uv(mesh,[(i%segments/segments*2*math.pi*r,co[2]+length/2) for i,co in enumerate(vertices)],2*math.pi*r)
    o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o)
    finish(o,name,mat,parent,pos); o.rotation_mode='QUATERNION'
    o.rotation_quaternion=Vector((0,0,1)).rotation_difference(v(axis).normalized())
    for p in mesh.polygons: p.use_smooth=p.index%4<2
    return o

def cable(name,points,r,mat,parent):
    curve=bpy.data.curves.new(name,'CURVE'); curve.dimensions='3D'; curve.resolution_u=10
    curve.bevel_depth=r; curve.bevel_resolution=2
    spline=curve.splines.new('BEZIER'); spline.bezier_points.add(len(points)-1)
    for p,co in zip(spline.bezier_points,points): p.co=v(co); p.handle_left_type=p.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,curve); bpy.context.collection.objects.link(o); o.parent=parent; curve.materials.append(mat)
    bpy.context.view_layer.objects.active=o; o.select_set(True); bpy.ops.object.convert(target='MESH'); o.select_set(False)
    return o

def label(text,pos,width,parent,mat=paper):
    # Flat screen-facing shop labels, backed by real geometry.
    bpy.ops.object.text_add()
    o=bpy.context.object; o.name='Label '+text; o.data.body=text; o.data.size=width/max(1,len(text)) * 1.55
    o.data.extrude=0; o.data.align_x='CENTER'; o.parent=parent; o.location=v(pos)
    o.rotation_euler=(math.pi/2,0,0); o.data.materials.append(mat)
    bpy.ops.object.convert(target='MESH'); return o

room=group('WorkshopStatic')
box('Concrete floor',(6,.08,5.5),(0,-.045,-.7),floor,room)
box('Rear upper factory wall',(6,3.5,.08),(0,1.75,-2.25),wall,room)
box('Left factory wall',(.08,3.5,5.5),(-3,1.75,-.7),wall,room)
# Yellow curtain panels have actual shallow folds, hems and hanging rings.
def curtain(name,x0,x1,z):
    vertices=[]; faces=[]; n=90
    for y in [.12,2.2]:
        for i in range(n+1):
            x=x0+(x1-x0)*i/n; zz=z+.005*math.sin(i*.5)+.003*math.sin(i*.21)
            vertices.append(tuple(v((x,y,zz))))
    for i in range(n): faces.append((i,i+1,n+2+i,n+1+i))
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(vertices,[],faces); mesh.update()
    o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o); o.parent=room; mesh.materials.append(yellow)
    for face in mesh.polygons: face.use_smooth=True
    for x in [x0,x1]: rod('Curtain vertical frame',(x,.06,z),(x,2.28,z),.015,steel,room)
    rod('Curtain top rail',(x0,2.24,z),(x1,2.24,z),.015,steel,room)
    for i in range(int((x1-x0)/.16)+1):
        x=x0+i*.16
        tube('Curtain suspension eye',.019,.004,.006,(x,2.22,z),darksteel,room,(1,0,0),12)
curtain('Yellow rear screen left',-2.8,-.1,-2.14)
curtain('Yellow rear screen right',-.08,2.85,-2.14)
for x in [-2.6,-1.3,0,1.3,2.6]:
    box('Upper window mullion',(.04,.6,.09),(x,2.63,-2.12),black,room)
box('Window sill',(5.8,.07,.15),(0,2.32,-2.12),darksteel,room)
for x in [-2.6,0,2.6]: box('Roof beam',(.1,.17,5.4),(x,3.1,-.7),black,room)
for x in [-1.5,1.5]: box('Long factory strip lamp',(1.3,.035,.19),(x,2.95,-.8),lamp,room)
for x in [-2.82,2.82]: box('Aisle paint',(.045,.003,4.8),(x,.001,-.5),yellow,room,0)

def wheel(parent,x,z,y=.09):
    cyl('Black caster tyre',.072,.037,(x,y,z),rubber,parent,(1,0,0),20)
    cyl('Caster red hub',.029,.043,(x,y,z),red,parent,(1,0,0),12)
    box('Caster fork',(.06,.09,.023),(x,y+.05,z),steel,parent)

def binbox(parent,pos,w=.19,h=.13,d=.23):
    x,y,z=pos
    box('Bin bottom',(w,.012,d),(x,y,z),binblue,parent)
    for s in [-1,1]: box('Bin side',(.012,h,d),(x+s*w/2,y+h/2,z),binblue,parent)
    box('Bin back',(w,h,.012),(x,y+h/2,z-d/2),binblue,parent)
    box('Bin front lip',(w,h*.42,.015),(x,y+h*.21,z+d/2),binblue,parent)
    box('Bin paper label',(w*.58,.025,.001),(x,y+.025,z+d/2+.009),paper,parent,0)

# Left welding power source, stacked wire feeder and adjacent extraction unit.
for x,z in [(-1.44,-1.3),(-.87,-1.72)]:
    isred=x<-1; mat=red if isred else white
    box('Welding power source',(.44,.65,.52),(x,.46,z),mat,room,.018)
    box('Machine front face',(.37,.52,.025),(x,.48,z+.268),black,room)
    for k in range(13): box('Horizontal cooling louvre',(.31,.008,.012),(x,.25+k*.013,z+.286),darksteel,room,0)
    box('Display window',(.23,.07,.012),(x,.67,z+.289),rubber,room)
    label('168  19.3',(x,.661,z+.299),.19,room,green)
    for k in range(3): cyl('Machine dial',.023,.02,(x-.11+k*.11,.56,z+.29),steel,room,(0,0,1),16)
    for sx in [-.18,.18]: wheel(room,x+sx,z+.16)
    if isred:
        box('Upper red wire feeder',(.37,.31,.39),(x,.99,z-.02),red,room,.018)
        box('Feeder dark panel',(.28,.24,.014),(x,1,z+.185),black,room)
        for y in [.94,1.065]: cyl('Feeder controls',.03,.021,(x+.04,y,z+.205),darksteel,room,(0,0,1))
    else: box('Extractor blue lower panel',(.4,.28,.022),(x,.32,z+.28),binblue,room)
    cable('Heavy machine lead',[(x,.5,z+.31),(x+.15,.3,z+.5),(x+.2,.03,z+.65),(-.6,.035,-.2),(-.28,.65,-.42)],.012,rubber,room)
box('Grey cabinet',(.56,1.2,.43),(-.32,.61,-1.75),white,room,.01)
box('Cabinet glass door',(.49,.64,.025),(-.32,1.42,-1.72),darksteel,room)
for y in [1.28,1.56]: box('Cabinet shelves',(.46,.018,.31),(-.32,y,-1.59),steel,room)
for x in [-.48,-.19]:
    box('Cabinet front door',(.25,.71,.018),(x,.77,-1.525),white,room)
    box('Cabinet door handle',(.014,.1,.028),(x+.08,.9,-1.5),black,room)

# Blue tool cabinet and perforated backboard, right of the worker.
box('Blue tool cabinet',(.85,.86,.43),(.73,.46,-1.71),blue,room,.007)
box('Steel cabinet top',(.9,.035,.49),(.73,.91,-1.68),steel,room)
box('Blue pegboard',(.88,.62,.025),(.73,1.29,-1.89),blue,room)
for i in range(13):
    for j in range(8):
        # The dark recess and yellow inset read as perforations at headset distances.
        cyl('Pegboard hole',.009,.002,(.34+i*.064,1.02+j*.068,-1.875),yellow,room,(0,0,1),8)
for i in range(6):
    x=.41+i*.105; y=1.37-(i%3)*.09
    rod('Hanging tool shaft',(x,y,-1.855),(x,y-.18,-1.855),.006,steel,room)
    box('Hanging tool grip',(.021,.075,.024),(x,y-.17,-1.84),red if i%2 else rubber,room)
    tube('Spanner ring',.014,.005,.009,(x,y,-1.85),steel,room,(0,0,1),12)
for i in range(3):
    box('Small parts drawer',(.11,.08,.14),(.44,.975+i*.09,-1.56),white,room)
cyl('Alarm beacon base',.038,.045,(1.04,1.67,-1.87),black,room)
cyl('Alarm beacon red lens',.033,.075,(1.04,1.73,-1.87),red,room)

# Open rectangular tool trolley matching the foreground right of IMG_0548.
cart=group('BlueToolTrolley',(1.32,0,-.55),room)
for x in [-.44,.44]:
    for z in [-.28,.28]:
        box('Cart upright',(.037,.76,.037),(x,.52,z),blue,cart)
        wheel(cart,x,z)
for y in [.2,.92]:
    box('Cart shelf',(.94,.04,.65),(0,y,0),blue if y<.5 else darksteel,cart)
    for z in [-.31,.31]: box('Cart shelf rim',(.94,.04,.025),(0,y+.025,z),blue,cart)
for i in range(4): binbox(cart,(-.26,.25+i*.135,.02),.2,.105,.28)
box('Green storage box',(.37,.34,.42),(.16,.38,-.05),surface('Green toolbox',(.12,.2,.09),.4,.65,True),cart)
box('Open tray on cart',(.28,.07,.25),(-.13,.99,0),binblue,cart)
# A lowered welding face shield resting on the trolley.
shield=box('Resting welding shield',(.27,.23,.055),(-.05,1.12,-.06),rubber,cart,.035)
shield.rotation_euler.x=.25
box('Shield dark viewing window',(.14,.07,.006),(-.05,1.15,-.026),black,cart)
for i in range(3): rod('Loose filler rod on trolley',(-.43,.96,.16+i*.025),(.43,.96,.16+i*.025),.004,steel,cart)

# Bins and a stock rack on the left, with repeated cylinder stock.
rack=group('LeftPartsRack',(-2.16,0,-.4),room)
for x in [-.3,.3]: box('Rack upright',(.035,1.7,.035),(x,.89,0),blue,rack)
for j in range(5):
    y=.3+j*.29; box('Rack rail',(.64,.035,.04),(0,y,0),blue,rack)
    for i in [-1,0,1]: binbox(rack,(i*.2,y+.03,.08),.175,.16,.23)
for k in range(5):
    tube('Stored polished tube',.041,.005,1.13,(-2.12+k*.135,.39,-1.36),steel,room,(0,0,1),24)
for z in [-1.83,-.89]: box('Stock rack crossmember',(.85,.065,.055),(-1.9,.29,z),blue,room)

# Ribbed flexible extraction arm, bent toward the work and ending in a flared hood.
hoodpoints=[(-1.72,3,-1.12),(-1.72,2.42,-1.1),(-1.55,1.98,-1.03),(-1.04,2.08,-.86),(-.76,1.96,-.72)]
cable('Black flexible extraction duct',hoodpoints,.115,rubber,room)
for a,b in zip(hoodpoints[:-1],hoodpoints[1:]):
    a,b=Vector(a),Vector(b); n=max(2,int((b-a).length/.025))
    for i in range(n):
        tube('Corrugated duct rib',.12,.011,.009,a.lerp(b,i/n),darksteel,room,b-a,20)
hoodaxis=Vector((.46,-.25,.48)).normalized(); hoodstart=Vector(hoodpoints[-1])
# Custom hollow cone instead of a closed cylinder cap.
verts=[]; faces=[]; n=48
q=Vector((0,0,1)).rotation_difference(v(hoodaxis))
for depth,r in [(0,.118),(.39,.263),(.39,.254),(0,.11)]:
    for i in range(n):
        p=q@Vector((r*math.cos(i*2*math.pi/n),r*math.sin(i*2*math.pi/n),depth))+v(hoodstart)
        verts.append(tuple(p))
for k in range(4):
    for i in range(n): faces.append((k*n+i,k*n+(i+1)%n,((k+1)%4)*n+(i+1)%n,((k+1)%4)*n+i))
mesh=bpy.data.meshes.new('Hollow fume hood'); mesh.from_pydata(verts,[],faces); mesh.update()
o=bpy.data.objects.new('Flared extraction hood',mesh); bpy.context.collection.objects.link(o); o.parent=room; mesh.materials.append(darksteel)
for p in mesh.polygons: p.use_smooth=True
tube('Hood rolled lip',.27,.014,.026,hoodstart+hoodaxis*.39,steel,room,hoodaxis)
rod('Extraction arm support',(-1.12,.15,-1.13),(-1.12,1.99,-1.13),.017,steel,room)
cable('Cream vertical extraction trunk',[(-.95,3.4,-1.96),(-.95,2.52,-1.96),(-.7,2,-1.85),(-.7,1.1,-1.85)],.13,white,room)

# Folded blue welding blanket on the equipment beneath the extraction arm.
cloth=surface('Blue fire blanket',(.025,.065,.21),0,.98,True)
verts=[]; faces=[]; nx=28; ny=12
for j in range(ny+1):
    for i in range(nx+1):
        x=-1.15+i/nx*.69; z=-1.59+j/ny*.42
        y=1.13+.09*math.sin(i/nx*math.pi)+.022*math.sin(i*1.7+j*.9)-.11*(j/ny)**4
        verts.append(tuple(v((x,y,z))))
for j in range(ny):
    for i in range(nx):
        a=j*(nx+1)+i; faces.append((a,a+nx+1,a+nx+2,a+1))
mesh=bpy.data.meshes.new('Draped fire blanket'); mesh.from_pydata(verts,[],faces); mesh.update()
o=bpy.data.objects.new('Blue folded fire blanket',mesh); bpy.context.collection.objects.link(o); o.parent=room; mesh.materials.append(cloth)
for face in mesh.polygons: face.use_smooth=True

# Floor fan behind the lift.
fan=group('FloorFan',(.04,.38,-1.32),room)
tube('Fan shroud',.265,.02,.11,(0,0,0),rubber,fan,(0,0,1))
for rad in [.09,.14,.19,.24]: tube('Fan wire cage',rad,.0025,.002,(0,0,.065),steel,fan,(0,0,1),48)
for i in range(16):
    a=i*math.pi/8; rod('Fan radial wire',(0,0,.07),(.25*math.cos(a),.25*math.sin(a),.07),.002,steel,fan,6)
for i in range(3):
    a=i*2*math.pi/3; blade=box('Fan blade',(.1,.22,.008),(.09*math.sin(a),.09*math.cos(a),0),black,fan)
    blade.rotation_euler.y=a
cyl('Fan motor cap',.05,.14,(0,0,0),black,fan,(0,0,1))

# Articulated lift: floor frame stays fixed; linkage and loaded top move separately.
table=group('LiftTable',(0,0,-.65),room)
liftTop=group('LiftTop',parent=table)
liftMechanism=group('LiftMechanism',parent=table)
for z in [-.3,.3]:
    box('Red lower rail',(1.18,.07,.055),(0,.13,z),red,table)
    for x in [-.49,.49]: wheel(table,x,z)
    for a,b in [((-.47,.18,z),(.47,.7,z)),((.47,.18,z),(-.47,.7,z))]:
        rod('Scissor lift arm',a,b,.034,black,liftMechanism,8)
    cyl('Scissor pivot bolt',.027,.08,(0,.44,z),steel,liftMechanism,(0,0,1),12)
rod('Hydraulic ram',(-.35,.2,0),(.2,.61,0),.038,black,liftMechanism)
rod('Hydraulic chrome piston',(-.08,.4,0),(.39,.7,0),.021,steel,liftMechanism)
box('Red lift platform',(1.38,.065,.72),(0,.755,0),red,liftTop,.012)
box('Platform steel wear patch',(.51,.008,.4),(0,.794,-.03),darksteel,liftTop)
for x in [-.2,.2]:
    for z in [-.15,.15]: cyl('Pedestal anchor bolt',.014,.014,(x,.811,z-.03),steel,liftTop,verts=6)
cyl('Black positioner pedestal',.072,.32,(0,.956,-.03),black,liftTop)
cyl('Exposed machined spindle',.067,.145,(0,1.125,-.03),darksteel,liftTop)
for x in [.28,.33,.38]:
    tube('Open tool sleeve',.022,.003,.17,(x,.88,-.13),black,liftTop,(0,1,0),16)
    rod('Tool in sleeve',(x,.84,-.13),(x+.025,1.11,-.12),.005,steel,liftTop)
for x,z in [(-.38,.08),(.5,-.23)]:
    cyl('Aerosol can',.029,.17,(x,.89,z),paper,liftTop)
    cyl('Aerosol can rim',.028,.008,(x,.98,z),steel,liftTop)
    cyl('Aerosol nozzle',.008,.016,(x,.992,z),red,liftTop,verts=12)
cable('Lift push handle',[(-.7,.13,.27),(-.8,.52,.3),(-.76,.73,.29),(-.62,.79,.29)],.015,steel,table)
for k in range(3):
    x=.24+k*.07
    # Warning triangle on the platform front edge.
    mesh=bpy.data.meshes.new('Warning triangle'); mesh.from_pydata([v((x-.023,.734,.368)),v((x+.023,.734,.368)),v((x,.777,.368))],[],[(0,1,2)])
    o=bpy.data.objects.new('Yellow caution decal',mesh); bpy.context.collection.objects.link(o); o.parent=liftTop; mesh.materials.append(yellow)
label('LIFT  /  300',(-.43,.746,.369),.17,liftTop)
points=[]
for i in range(241):
    t=i/240; a=t*math.pi*2*22
    points.append((-1.88+.045*math.cos(a),1.12-t*.94,-.35+.045*math.sin(a)))
cable('Yellow coiled air hose',points,.006,yellow,room)
cable('Coiled air line on floor',[(-1.88,.18,-.35),(-1.8,.02,-.1),(-1.15,.022,.1),(-.84,.2,.05)],.008,yellow,room)

# All moving geometry is below these explicit exported transform nodes.
yaw=group('PositionerYaw',(0,1.25,-.68))
tilt=group('PositionerTilt',parent=yaw)
roll=group('PipeRoll',parent=tilt)
assembly=group('WeldAssembly',parent=roll)
box('Yaw yoke base',(.19,.035,.17),(0,-.087,0),black,yaw)
for x in [-.092,.092]:
    box('Yoke cheek',(.025,.15,.15),(x,-.023,0),black,yaw)
    cyl('Tilt pivot bolt',.025,.045,(x,.0,0),steel,yaw,(1,0,0),12)
box('Tilting saddle',(.16,.025,.18),(0,-.071,0),darksteel,tilt)
for z in [-.13,.13]:
    tube('Pipe clamp ring',.079,.006,.026,(0,0,z),black,roll)
    box('Clamp closing lug',(.044,.025,.035),(.084,0,z),steel,roll)
    cyl('Clamp locking bolt',.009,.046,(.082,.01,z),steel,roll,verts=6)
# Long hollow cylinder, small branch lines and the rear cross-eye.
tube('Main hollow steel pipe',.07,.006,1.5,(0,0,0),pipeSteel,assembly,segments=128)
r=LAYOUT['lineRadius']; R=LAYOUT['mainRadius']; B=LAYOUT['bossRadius']
bossZ=LAYOUT['bossZ']; elbowZ=LAYOUT['elbowZ']; lineY=LAYOUT['lineY']; bend=LAYOUT['bendRadius']
for line,xx in enumerate(LAYOUT['lineX']):
    baseY=math.sqrt(R*R-xx*xx)-.004
    cyl('Vertical small connection boss',B,LAYOUT['bossTop']-baseY,
        (xx,(LAYOUT['bossTop']+baseY)/2,bossZ),pipeSteel,assembly,verts=64)
    # Long straight section terminates on the cylindrical boss, not at its axis.
    # The scalloped end matches the runtime cylinder-intersection weld path.
    vertices=[]; faces=[]; n=64
    for end in [0,1]:
        for inner in [False,True]:
            rr=r-(LAYOUT['lineWall'] if inner else 0)
            for i in range(n):
                a=i*math.pi*2/n; dx=rr*math.sin(a); dy=rr*math.cos(a)
                z=elbowZ+bend if end==0 else bossZ-math.sqrt(B*B-dx*dx)+.00015
                vertices.append(tuple(v((xx+dx,lineY+dy,z))))
    for i in range(n):
        j=(i+1)%n
        faces.extend([(i,j,2*n+j,2*n+i),(n+j,n+i,3*n+i,3*n+j),
                      (i,n+i,n+j,j),(2*n+j,3*n+j,3*n+i,2*n+i)])
    mesh=bpy.data.meshes.new('Small branch straight tube'); mesh.from_pydata(vertices,[],[tuple(reversed(f)) for f in faces]); mesh.update()
    pipe_uv(mesh,[(i%n/n*2*math.pi*r,-co[1]-elbowZ-bend) for i,co in enumerate(vertices)],2*math.pi*r)
    o=bpy.data.objects.new('Branch line '+str(line),mesh); bpy.context.collection.objects.link(o); o.parent=assembly; mesh.materials.append(pipeSteel)
    for p in mesh.polygons: p.use_smooth=True
    # True circular 90-degree elbow, then a vertical leg fish-mouthed into the
    # curved surface of the large pipe (the second blue mark on the print).
    vertices=[]; faces=[]; sections=24
    for j in range(sections+2):
        theta=min(j,sections)/sections*math.pi/2
        for i in range(n):
            phi=i*2*math.pi/n; dx=r*math.cos(phi); radial=r*math.sin(phi)
            y=lineY-bend+(bend+radial)*math.cos(theta)
            z=elbowZ+bend-(bend+radial)*math.sin(theta)
            if j==sections+1:
                y=math.sqrt(R*R-(xx+dx)**2)-.00015
            vertices.append(tuple(v((xx+dx,y,z))))
    for j in range(sections+1):
        for i in range(n):
            a=j*n+i; b=j*n+(i+1)%n
            faces.append((a,b,b+n,a+n))
    mesh=bpy.data.meshes.new('Small elbow on curved main pipe'); mesh.from_pydata(vertices,[],[tuple(reversed(f)) for f in faces]); mesh.update()
    coords=[]
    for i,co in enumerate(vertices):
        j=i//n
        distance=min(j,sections)/sections*math.pi/2*bend
        if j>sections: distance+=lineY-bend-co[2]
        coords.append((i%n/n*2*math.pi*r,distance))
    pipe_uv(mesh,coords,2*math.pi*r)
    o=bpy.data.objects.new('Elbow branch '+str(line),mesh); bpy.context.collection.objects.link(o); o.parent=assembly; mesh.materials.append(pipeSteel)
    for p in mesh.polygons: p.use_smooth=True
for z in [-.31,.27]:
    width=max(LAYOUT['lineX'])-min(LAYOUT['lineX'])+.035
    center=(max(LAYOUT['lineX'])+min(LAYOUT['lineX']))/2
    box('Small line retaining bridge',(width,.01,.016),(center,lineY+.008,z),darksteel,assembly)
for z in [-.59,.59]: tube('Machined tube collar',.0715,.003,.022,(0,0,z),pipeSteel,assembly)
# Keep the pipe end open and clear of the former square plate and its bolts.
tube('Rear transverse pin eye',.055,.022,.21,(0,0,-.77),darksteel,assembly,(1,0,0),40)
box('Rear hydraulic manifold',(.125,.09,.055),(0,.04,-.735),steel,assembly)
for x in [-.031,.031]: tube('Open manifold port',.019,.007,.009,(x,.087,-.74),black,assembly,(0,1,0),24)

# Set the reference pose (long tube left-to-right in the workstation).
yaw.rotation_euler.z=math.radians(-65)

# Merge meshes within each rigid node by material: retain articulated hierarchy,
# sharply reduce draw calls for the standalone headset, bake bevels into geometry.
liftMeshes=set(liftTop.children_recursive) | set(liftMechanism.children_recursive)
for parent in [room,table,liftTop,liftMechanism,cart,rack,fan,yaw,tilt,roll,assembly]:
    buckets={}
    # Static descendants may all merge into the root; articulated nodes stay separate.
    objects=list(parent.children_recursive) if parent==room else list(parent.children)
    for o in objects:
        if o.type=='MESH' and not (parent==room and o in liftMeshes):
            buckets.setdefault(o.data.materials[0].name,[]).append(o)
    for name,objs in buckets.items():
        if not objs: continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active=objs[0]
        if len(objs)>1: bpy.ops.object.join()
        joined=bpy.context.object
        world=joined.matrix_world.copy(); joined.parent=parent; joined.matrix_world=world
        joined.name=parent.name+'__'+name

# Export only model data, with no cameras/lights in the runtime asset.
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
    if o.type in {'MESH','EMPTY'}: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'workshop.glb'),export_format='GLB',use_selection=True,
    export_yup=True,export_apply=True,export_extras=True,export_cameras=False,export_lights=False)

# The editable .blend includes an overview camera and studio/workshop lighting.
def area(name,pos,power,size,target):
    d=bpy.data.lights.new(name,'AREA'); d.energy=power; d.shape='DISK'; d.size=size
    o=bpy.data.objects.new(name,d); bpy.context.collection.objects.link(o); o.location=v(pos)
    o.rotation_euler=(v(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('Ceiling softbox',(-.3,3,0),750,4,(0,0,-.7))
area('Open shop entrance',(1.8,2.4,3),550,3,(0,1,-1))
area('Left fill',(-2.5,2.2,.3),250,2,(0,1,-.7))
bpy.ops.object.camera_add(location=v((-.8,1.9,3.2)))
cam=bpy.context.object; cam.name='Reference overview camera'; cam.data.lens=34
cam.rotation_euler=(v((-.25,1.23,-.83))-cam.location).to_track_quat('-Z','Y').to_euler()
scene=bpy.context.scene; scene.camera=cam; scene.render.engine='CYCLES'; scene.cycles.samples=24
scene.cycles.use_denoising=True; scene.render.resolution_x=1600; scene.render.resolution_y=1000; scene.render.resolution_percentage=100
scene.world.color=(.12,.12,.12); scene.view_settings.view_transform='Standard'; scene.view_settings.exposure=-1
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(OUT/'overview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'workshop.blend'))
if '--skip-renders' not in sys.argv:
    bpy.ops.render.render(write_still=True)
    # Two close views of the small target types, using the real assembly transform.
    for title,localTarget,offset in [
        ('joint-side',(LAYOUT['lineX'][0],lineY,bossZ-B),(-.08,.09,-.21)),
        ('joint-base',(LAYOUT['lineX'][0],math.sqrt(R*R-LAYOUT['lineX'][0]**2),elbowZ),(-.07,.15,.15)),
    ]:
        target=yaw.matrix_world@v(localTarget)
        cam.location=yaw.matrix_world@v(Vector(localTarget)+Vector(offset))
        cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.lens=55
        scene.render.filepath=str(OUT/(title+'.png')); bpy.ops.render.render(write_still=True)
summary={'glb_bytes':(OUT/'workshop.glb').stat().st_size,'meshes':sum(o.type=='MESH' for o in scene.objects),
    'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH'),
    'lift_nodes':['LiftTop','LiftMechanism'],'units':'metres','pipe_radius':.07,'pipe_length':1.5,'small_pipe_radius':LAYOUT['lineRadius'],
    'training_joints':[f'line-{i}-{kind}' for i in range(len(LAYOUT['lineX'])) for kind in ['side','base']],
    'pipe_material':'Existing polishedTube PBR, 60 mm tile, normal strength 0.18',
    'reference':'IMG_0548.JPG + 10 supplementary photos + selected MOV frames',
    'dimensions':'Estimated from photographs; no measured calibration supplied.'}
(OUT/'model-info.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print('FIELD_WORKSHOP_COMPLETE',json.dumps(summary))
