#!/usr/bin/python3

import gmsh
import math
import os
import sys
from timeit import default_timer as timer


info_msg=''' 
(cx, cy, cz) :  coordinates of the centre of the dike
(dx, dy, dz) :  lengths of the semi-axis of the dike
(tx, ty, tz) :  anglles of rotation of the dike

input should be in order: cx cy cz dx dy dz tx ty tz
'''


#if(len(sys.argv)==10):
#   cx, cy, cz = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
#   dx, dy, dz = float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
#   tx, ty, tz = float(sys.argv[7]), float(sys.argv[8]), float(sys.argv[9])
#else:  
#   print('Error: some of the parameter is missing')  
#   print(info_msg)
#   sys.exit('\n')
   

# this should be binary stl data file path
input_file = 'etna_surface.stl'


depth = -50000.0


N = 1   #of cores to run this file for parallel 3D meshing
#N = os.cpu_count()
print('cpu_count: ', N)


np = 16   #of mesh partitions


#  -----------topography data bounds ------------------- 
#               476,000 <= x <= 524,000
#   4,152,191.488873656 <= y <= 4,200,191.488873656
#   -2259.23 <= z <= 3300.74
#         cx = 500,000  cy =4,176,191.488873656  


#  -----------tomography data bounds ------------------- 
#               476,000 <= x <= 524,000
#   4,152,191.488873656 <= y <= 4,200,191.488873656
#                -25000 <= z <= 2000




#hole parameters 
cx, cy, cz =  500000, 4175000, -7000
dx, dy, dz = 1000, 1000, 1000
tx, ty, tz = 0, 0, 0    






start = timer()


gmsh.initialize(sys.argv)
    
path = os.path.dirname(os.path.abspath(__file__))    

gmsh.merge(os.path.join(path, input_file))       # load an STL surface



#-------------------------outer_box---------------------------------
# classify the surface mesh according to given angle, and create discrete model
# entities (surfaces, curves and points) accordingly; curveAngle forces bounding
# curves to be split on sharp corners
gmsh.model.mesh.classifySurfaces(math.pi, curveAngle=math.pi / 3)
           
# retrieve the surface, its boundary curves and corner points
s = gmsh.model.getEntities(2)     # print(s) = [(2, 2)]      (dim, surface tag)
c = gmsh.model.getBoundary(s)     # print(c) = [(1, 3), (1, 4), (1, 5), (1, 6)]   (dim, boundary curve tag) 

if (len(c) != 4):
    print('s: ', s)
    print('c: ', c)
    gmsh.logger.write('Should have 4 boundary curves!', level='error')

p = []
xyz = []
for e in c:
    pt = gmsh.model.getBoundary([e], combined=False) 
    # print (pt) = [(0, 1), (0, 2)],   [(0, 2), (0, 3)],    [(0, 3), (0, 4)],    [(0, 4), (0, 1)]         (dim, point tag)
    
    p.extend([pt[0][1]])        
    xyz.extend(gmsh.model.getValue(0, pt[0][1], []))


# create other CAD entities to form one volume below the terrain surface; beware
# that only built-in CAD entities can be hybrid, i.e. have discrete entities on
# their boundary: OpenCASCADE does not support this feature
p1 = gmsh.model.geo.addPoint(xyz[0], xyz[1], depth)    # bottom surface points
p2 = gmsh.model.geo.addPoint(xyz[3], xyz[4], depth)
p3 = gmsh.model.geo.addPoint(xyz[6], xyz[7], depth)
p4 = gmsh.model.geo.addPoint(xyz[9], xyz[10], depth)      
    
c1 = gmsh.model.geo.addLine(p1, p2)
c2 = gmsh.model.geo.addLine(p2, p3)
c3 = gmsh.model.geo.addLine(p3, p4)
c4 = gmsh.model.geo.addLine(p4, p1)

c5 = gmsh.model.geo.addLine(p1, p[0])
c6 = gmsh.model.geo.addLine(p2, p[1])
c7 = gmsh.model.geo.addLine(p3, p[2])
c8 = gmsh.model.geo.addLine(p4, p[3])

ll1 = gmsh.model.geo.addCurveLoop([c1, c2, c3, c4])      
s1 = gmsh.model.geo.addPlaneSurface([ll1])              # bottom surface
ll2 = gmsh.model.geo.addCurveLoop([c1, c6, -c[0][1], -c5])
s2 = gmsh.model.geo.addPlaneSurface([ll2])              #front surface
ll3 = gmsh.model.geo.addCurveLoop([c2, c7, -c[1][1], -c6])
s3 = gmsh.model.geo.addPlaneSurface([ll3])              # right surface 
ll4 = gmsh.model.geo.addCurveLoop([c3, c8, -c[2][1], -c7])
s4 = gmsh.model.geo.addPlaneSurface([ll4])              # back surface
ll5 = gmsh.model.geo.addCurveLoop([c4, c5, -c[3][1], -c8])
s5 = gmsh.model.geo.addPlaneSurface([ll5])              # left surface 
#s[0][1]     top surface with topography
sl1 = gmsh.model.geo.addSurfaceLoop([s1, s2, s3, s4, s5, s[0][1]])
#--------------------------------------------------------------------------








#-----------------box hole------------------------------------
p11 = gmsh.model.geo.addPoint(cx-dx, cy-dy, cz-dz)
p12 = gmsh.model.geo.addPoint(cx+dx, cy-dy, cz-dz)
p13 = gmsh.model.geo.addPoint(cx+dx, cy+dy, cz-dz)
p14 = gmsh.model.geo.addPoint(cx-dx, cy+dy, cz-dz)
p15 = gmsh.model.geo.addPoint(cx-dx, cy-dy, cz+dz)
p16 = gmsh.model.geo.addPoint(cx+dx, cy-dy, cz+dz)
p17 = gmsh.model.geo.addPoint(cx+dx, cy+dy, cz+dz)
p18 = gmsh.model.geo.addPoint(cx-dx, cy+dy, cz+dz)

c11 = gmsh.model.geo.addLine(p11, p12)
c12 = gmsh.model.geo.addLine(p12, p13)
c13 = gmsh.model.geo.addLine(p13, p14)
c14 = gmsh.model.geo.addLine(p14, p11)
c15 = gmsh.model.geo.addLine(p15, p16)
c16 = gmsh.model.geo.addLine(p16, p17)
c17 = gmsh.model.geo.addLine(p17, p18)
c18 = gmsh.model.geo.addLine(p18, p15)
c19 = gmsh.model.geo.addLine(p11, p15)
c20 = gmsh.model.geo.addLine(p12, p16)
c21 = gmsh.model.geo.addLine(p13, p17)
c22 = gmsh.model.geo.addLine(p14, p18)

ll11 = gmsh.model.geo.addCurveLoop([c11, c12, c13, c14])      
s11 = gmsh.model.geo.addPlaneSurface([ll11])              
    
ll12 = gmsh.model.geo.addCurveLoop([c15, c16, c17, c18])      
s12 = gmsh.model.geo.addPlaneSurface([ll12])     
          
ll13 = gmsh.model.geo.addCurveLoop([c11, c20, -c15, -c19])      
s13 = gmsh.model.geo.addPlaneSurface([ll13])        
     
ll14 = gmsh.model.geo.addCurveLoop([c17, -c22, -c13, c21])      
s14 = gmsh.model.geo.addPlaneSurface([ll14])       
       
ll15 = gmsh.model.geo.addCurveLoop([c18, -c19, -c14, c22])      
s15 = gmsh.model.geo.addPlaneSurface([ll15])      
        
ll16 = gmsh.model.geo.addCurveLoop([c16, -c21, -c12, c20])      
s16 = gmsh.model.geo.addPlaneSurface([ll16])              

gmsh.model.geo.rotate([(2,s11), (2,s12), (2,s13), (2,s14), (2,s15), (2,s16)],  cx,cy,cz,  0,0,1, tx)
gmsh.model.geo.rotate([(2,s11), (2,s12), (2,s13), (2,s14), (2,s15), (2,s16)],  cx,cy,cz,  1,0,0, ty)
gmsh.model.geo.rotate([(2,s11), (2,s12), (2,s13), (2,s14), (2,s15), (2,s16)],  cx,cy,cz,  0,1,0, tz)

sl2 = gmsh.model.geo.addSurfaceLoop([s12, s13, s11, s16, s14, s15])

hx = int(dx/20)
hy = int(dy/20)
hz = int(dz/20)
gmsh.model.geo.mesh.setTransfiniteCurve(c13, hx)
gmsh.model.geo.mesh.setTransfiniteCurve(c17, hx)
gmsh.model.geo.mesh.setTransfiniteCurve(c15, hx)
gmsh.model.geo.mesh.setTransfiniteCurve(c11, hx)

gmsh.model.geo.mesh.setTransfiniteCurve(c12, hy)
gmsh.model.geo.mesh.setTransfiniteCurve(c14, hy)
gmsh.model.geo.mesh.setTransfiniteCurve(c18, hy)
gmsh.model.geo.mesh.setTransfiniteCurve(c16, hy)

gmsh.model.geo.mesh.setTransfiniteCurve(c19, hz)
gmsh.model.geo.mesh.setTransfiniteCurve(c20, hz)
gmsh.model.geo.mesh.setTransfiniteCurve(c21, hz)
gmsh.model.geo.mesh.setTransfiniteCurve(c22, hz)
#--------------------------------------------------------------------------





v = gmsh.model.geo.addVolume([sl1, sl2])

gmsh.model.addPhysicalGroup(3, [v], 10)  # volume tag = 10 
gmsh.model.addPhysicalGroup(2, [s1, s2, s3, s4, s5], 5)   # lateral boundaries tag = 5    
gmsh.model.addPhysicalGroup(2, [s11, s12, s13, s14, s15, s16], 4)   # hole boundaries tag = 4


gmsh.model.geo.synchronize()




    
gmsh.option.setNumber("Mesh.Algorithm3D", 10)    
gmsh.option.setNumber("General.NumThreads", N)   # for parallel 3D meshing
gmsh.model.mesh.generate(3)
gmsh.model.mesh.partition(np);
gmsh.model.geo.synchronize()
gmsh.option.setNumber("Mesh.MshFileVersion", 4.1)
gmsh.write("mesh.msh")
    


#gmsh.fltk.run() 
gmsh.finalize()
end = timer()
print('total time taken: {s1} s'.format(s1 = end-start))


