# GeoID Model Builder — the bedrock volume of a layered model.
# Run: python3 this_script.py   (or through the sidecar's /jobs/gmsh)
import gmsh

gmsh.initialize()
gmsh.option.setNumber("General.Terminal", 1)
gmsh.model.add("bedrock")
# One named solid per face: gmsh makes each its own surface, named.
gmsh.merge("bedrock.stl")
gmsh.model.mesh.createTopology()
gmsh.model.mesh.createGeometry()
surfaces = [t for (_, t) in gmsh.model.getEntities(2)]
loop = gmsh.model.geo.addSurfaceLoop(surfaces)
volume = gmsh.model.geo.addVolume([loop])
gmsh.model.geo.synchronize()

# Faces by NAME, grouped by flag: one flag is one boundary.
face_flags = {"top":1,"base":2,"sky":4,"sides":5,"sides_above":6,"bedrock_top":7,"water_surface":8,"bed":9,"water_sides":3,"bedrock":10,"atmosphere":11,"soil":12,"water":13}
faces = {}
labels = {}
for (_, t) in gmsh.model.getEntities(2):
    label = gmsh.model.getEntityName(2, t).split('/')[-1] or 'unnamed'
    value = face_flags.get(label)
    if value is None:
        continue
    faces.setdefault(value, []).append(t)
    labels.setdefault(value, set()).add(label)
for value, tags in sorted(faces.items()):
    gmsh.model.addPhysicalGroup(2, sorted(tags), value, name='+'.join(sorted(labels[value])))
gmsh.model.addPhysicalGroup(3, [volume], 10, name="bedrock")

# Edges and corners carry the lowest flag of the faces they bound.
owner = {}
for value in sorted(faces):
    for surface in faces[value]:
        for (_, curve) in gmsh.model.getBoundary([(2, surface)], oriented=False):
            owner.setdefault((1, abs(curve)), value)
            for (_, point) in gmsh.model.getBoundary([(1, abs(curve))], oriented=False):
                owner.setdefault((0, abs(point)), value)
by_flag = {}
for (dim, tag), value in owner.items():
    by_flag.setdefault((dim, value), []).append(tag)
for (dim, value), tags in sorted(by_flag.items()):
    gmsh.model.addPhysicalGroup(dim, sorted(tags), value)

gmsh.option.setNumber("Mesh.MeshSizeMax", 150.000)
gmsh.option.setNumber("Mesh.MeshSizeMin", 0.000)
gmsh.model.mesh.generate(3)
gmsh.write("bedrock.msh")
gmsh.finalize()
