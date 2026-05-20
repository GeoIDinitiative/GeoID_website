#!/usr/bin/python3

import gmsh
import math
import os
import sys


############################# Binary stl data file path####################################################

input_file = 'etna_surface.stl'


z = -10000.0
mesh_min_size = 100.0
mesh_max_size = 10000.0


########################## Dimension specifications for the 3D pluming system ##############################

# Upper chamber dimensions
cx = 50000
cy = 50000
cz = -2000

#default size
lc = 10

lc_upper = 30
lc_sides = 10

#size at interface between dyke and upper chamber

lc_if_uc = 1

rx = 250
ry = 250
rz = 250

rx_sin1 = 162.3620121 #location of points via trig functions -- gmsh doesn't appear to have these functions built in (change in future?)
ry_cos1 = 190.1014914


#rx_sin1 = rx*sin*(0.45)
#ry_cos1 = ry*cos*(0.45)
# mid points DYKE 1

dx_mid = 50000
dy_mid = 50000
dz_mid = -2500 
lc_if_mid = 30 

#2nd chamber dimensions

cx2 = 50000
cy2 = 50000
cz2 = -2850


r1 = 250 # semi minor axis
r2 = 250 # semi major axis

lc_sides_c2 = 30
lc_bottom_c2 = 10 # size determined by conduit point size

rx_sin2 = 162.3620121 
ry_cos2 = 190.1014914



# 3rd chamber dimensions

cx3 = 50000
cy3 = 50000
cz3 = -6800

r3 = 800    #semi minor axis
r4 = 6000   #semi major axis

lc_sides_c3 = 500
lc_bottom_c3 = 1000    #size determined by conduit point size

rx_sin3 = 3896.68829
ry_cos3= 4562.435794

# DYKE DIMENSIONS

lc_if_lc = 30   #size at interface between dyke and lower chamber

cx_d = 50000   #centre x,y of dyke
cy_d = 50000
dx = 5
dy = 50

dz1d = cz - rz    #subtract from central z of upper chamber
dz2d = cz2 + r1   #distance from centre of lower chamber interface to conduit interace


#  DYKE 2 

dx3 = 10
dy3 = 50


cx_d2 = 50000
cy_d2 = 50000
dz3d = cz2 - r1 
dz4d = cz3 + r3 

dx2 = 10
dy2 = 50

dz_mid2 = -5000 
lc_if_mid2 = 30 

lc_upper_c3 =10
lc_bottom_c3 = 1000

cx_d2_mid = 50000
cy_d2_mid = 50000

lc_if_lc3 = 30  # size at interface of lower chamber 3 



##############################################  SOLID MEDIUM WITH TOPOGRAPHY #################################



def outer_box(h):
    # classify the surface mesh according to given angle, and create discrete model
    # entities (surfaces, curves and points) accordingly; curveAngle forces bounding
    # curves to be split on sharp corners
    gmsh.model.mesh.classifySurfaces(math.pi, curveAngle=math.pi / 3)


    
    # create a geometry for the discrete curves and surfaces
    gmsh.model.mesh.createGeometry()
    
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
    
    # print(p)  = [1, 2, 3, 4]
    # print(xyz) = [p1x, p1y, p1z,  p2x, p2y, p2z,  p3x, p3y, p3z,  p4x, p4y, p4z]
    
    
    
    # create other CAD entities to form one volume below the terrain surface; beware
    # that only built-in CAD entities can be hybrid, i.e. have discrete entities on
    # their boundary: OpenCASCADE does not support this feature
    p1 = gmsh.model.geo.addPoint(xyz[0], xyz[1], z, h)    # bottom surface points
    p2 = gmsh.model.geo.addPoint(xyz[3], xyz[4], z, h)
    p3 = gmsh.model.geo.addPoint(xyz[6], xyz[7], z, h)
    p4 = gmsh.model.geo.addPoint(xyz[9], xyz[10], z, h)      
    
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

    return sl1, s1, s2, s3, s4, s5, s[0][1], c[0][1], c[1][1], c[2][1], c[3][1], p[0], p[1], p[2], p[3]



######################################### SPHERICAL HOLE ##############################################

def sphere_hole(cx, cy, cz, r, h):
    p1 = gmsh.model.geo.addPoint(cx, cy, cz, h)
    p2 = gmsh.model.geo.addPoint(cx-r, cy, cz, h)
    p3 = gmsh.model.geo.addPoint(cx+r, cy, cz, h)
    p4 = gmsh.model.geo.addPoint(cx, cy-r, cz, h)
    p5 = gmsh.model.geo.addPoint(cx, cy+r, cz, h)      
    p6 = gmsh.model.geo.addPoint(cx, cy, cz-r, h)
    p7 = gmsh.model.geo.addPoint(cx, cy, cz+r, h)      


    c1 = gmsh.model.geo.addCircleArc(p2, p1, p4)
    c2 = gmsh.model.geo.addCircleArc(p4, p1, p3)
    c3 = gmsh.model.geo.addCircleArc(p3, p1, p5)
    c4 = gmsh.model.geo.addCircleArc(p5, p1, p2)

    c5 = gmsh.model.geo.addCircleArc(p2, p1, p6)
    c6 = gmsh.model.geo.addCircleArc(p6, p1, p3)
    c7 = gmsh.model.geo.addCircleArc(p3, p1, p7)
    c8 = gmsh.model.geo.addCircleArc(p7, p1, p2)

    c9 = gmsh.model.geo.addCircleArc(p6, p1, p5)
    c10 = gmsh.model.geo.addCircleArc(p5, p1, p7)
    c11 = gmsh.model.geo.addCircleArc(p7, p1, p4)
    c12 = gmsh.model.geo.addCircleArc(p4, p1, p6)


    cl1 = gmsh.model.geo.addCurveLoop([c4, -c8, -c10])      
    s1 = gmsh.model.geo.addSurfaceFilling([cl1])              

    cl2 = gmsh.model.geo.addCurveLoop([c8, c1, -c11])      
    s2 = gmsh.model.geo.addSurfaceFilling([cl2])              

    cl3 = gmsh.model.geo.addCurveLoop([c11, c2, c7])      
    s3 = gmsh.model.geo.addSurfaceFilling([cl3])              

    cl4 = gmsh.model.geo.addCurveLoop([c10, -c7, c3])      
    s4 = gmsh.model.geo.addSurfaceFilling([cl4])              

    cl5 = gmsh.model.geo.addCurveLoop([c3, -c9, c6])      
    s5 = gmsh.model.geo.addSurfaceFilling([cl5])              

    cl6 = gmsh.model.geo.addCurveLoop([c6, -c2, c12])      
    s6 = gmsh.model.geo.addSurfaceFilling([cl6])              

    cl7 = gmsh.model.geo.addCurveLoop([c9, c4, c5])      
    s7 = gmsh.model.geo.addSurfaceFilling([cl7])              

    cl8 = gmsh.model.geo.addCurveLoop([c12, -c5, c1])      
    s8 = gmsh.model.geo.addSurfaceFilling([cl8])              

    sl1 = gmsh.model.geo.addSurfaceLoop([s7, s5, s4, s1, s2, s8, s6, s3])
    return sl1, s1, s2, s3, s4, s5, s6, s7, s8
    



############################################ ELLIPSOID HOLE ######################################



def ellipsoid_hole(cx, cy, cz, rx, ry, rz, h):
    p1 = gmsh.model.geo.addPoint(cx, cy, cz, h)
    p2 = gmsh.model.geo.addPoint(cx-rx, cy, cz, h)
    p3 = gmsh.model.geo.addPoint(cx+rx, cy, cz, h)
    p4 = gmsh.model.geo.addPoint(cx, cy-ry, cz, h)
    p5 = gmsh.model.geo.addPoint(cx, cy+ry, cz, h)      
    p6 = gmsh.model.geo.addPoint(cx, cy, cz-rz, h)
    p7 = gmsh.model.geo.addPoint(cx, cy, cz+rz, h)      


    c1 = gmsh.model.geo.addEllipseArc(p2, p1, p3, p4)
    c2 = gmsh.model.geo.addEllipseArc(p4, p1, p5, p3)
    c3 = gmsh.model.geo.addEllipseArc(p3, p1, p2, p5)
    c4 = gmsh.model.geo.addEllipseArc(p5, p1, p4, p2)

    c5 = gmsh.model.geo.addEllipseArc(p2, p1, p3, p6)
    c6 = gmsh.model.geo.addEllipseArc(p6, p1, p7, p3)
    c7 = gmsh.model.geo.addEllipseArc(p3, p1, p2, p7)
    c8 = gmsh.model.geo.addEllipseArc(p7, p1, p6, p2)

    c9 = gmsh.model.geo.addEllipseArc(p5, p1, p4, p6)
    c10 = gmsh.model.geo.addEllipseArc(p6, p1, p7, p4)
    c11 = gmsh.model.geo.addEllipseArc(p4, p1, p5, p7)
    c12 = gmsh.model.geo.addEllipseArc(p7, p1, p6, p5)


    cl1 = gmsh.model.geo.addCurveLoop([c4, -c8, c12])      
    s1 = gmsh.model.geo.addSurfaceFilling([cl1])              

    cl2 = gmsh.model.geo.addCurveLoop([c8, c1, c11])      
    s2 = gmsh.model.geo.addSurfaceFilling([cl2])              

    cl3 = gmsh.model.geo.addCurveLoop([c11, -c7, -c2])      
    s3 = gmsh.model.geo.addSurfaceFilling([cl3])              

    cl4 = gmsh.model.geo.addCurveLoop([c7, c12, -c3])      
    s4 = gmsh.model.geo.addSurfaceFilling([cl4])              

    cl5 = gmsh.model.geo.addCurveLoop([c3, c9, c6])      
    s5 = gmsh.model.geo.addSurfaceFilling([cl5])              

    cl6 = gmsh.model.geo.addCurveLoop([c2, -c6, c10])      
    s6 = gmsh.model.geo.addSurfaceFilling([cl6])              

    cl7 = gmsh.model.geo.addCurveLoop([c10, -c1, c5])      
    s7 = gmsh.model.geo.addSurfaceFilling([cl7])              

    cl8 = gmsh.model.geo.addCurveLoop([c5, -c9, c4])      
    s8 = gmsh.model.geo.addSurfaceFilling([cl8])              

    sl1 = gmsh.model.geo.addSurfaceLoop([s3, s2, s1, s8, s7, s6, s5, s4])
    return sl1, s1, s2, s3, s4, s5, s6, s7, s8



##################################### BOX HOLE - USED FOR DYKES ##########################



def box_hole(cx, cy, cz, x_l, y_l, z_l, h):
    p1 = gmsh.model.geo.addPoint(cx-x_l, cy-y_l, cz-z_l, h)
    p2 = gmsh.model.geo.addPoint(cx+x_l, cy-y_l, cz-z_l, h)
    p3 = gmsh.model.geo.addPoint(cx+x_l, cy+y_l, cz-z_l, h)
    p4 = gmsh.model.geo.addPoint(cx-x_l, cy+y_l, cz-z_l, h)

    p5 = gmsh.model.geo.addPoint(cx-x_l, cy-y_l, cz+z_l, h)
    p6 = gmsh.model.geo.addPoint(cx+x_l, cy-y_l, cz+z_l, h)
    p7 = gmsh.model.geo.addPoint(cx+x_l, cy+y_l, cz+z_l, h)
    p8 = gmsh.model.geo.addPoint(cx-x_l, cy+y_l, cz+z_l, h)

    c1 = gmsh.model.geo.addLine(p1, p2)
    c2 = gmsh.model.geo.addLine(p2, p3)
    c3 = gmsh.model.geo.addLine(p3, p4)
    c4 = gmsh.model.geo.addLine(p4, p1)
    
    c5 = gmsh.model.geo.addLine(p5, p6)
    c6 = gmsh.model.geo.addLine(p6, p7)
    c7 = gmsh.model.geo.addLine(p7, p8)
    c8 = gmsh.model.geo.addLine(p8, p5)

    c9 = gmsh.model.geo.addLine(p1, p5)
    c10 = gmsh.model.geo.addLine(p2, p6)
    c11 = gmsh.model.geo.addLine(p3, p7)
    c12 = gmsh.model.geo.addLine(p4, p8)
    
    ll1 = gmsh.model.geo.addCurveLoop([c1, c2, c3, c4])      
    s1 = gmsh.model.geo.addPlaneSurface([ll1])              #bottom -ve z
        
    ll2 = gmsh.model.geo.addCurveLoop([c5, c6, c7, c8])      
    s2 = gmsh.model.geo.addPlaneSurface([ll2])              #top +ve z 

    ll3 = gmsh.model.geo.addCurveLoop([c1, c10, -c5, -c9])      
    s3 = gmsh.model.geo.addPlaneSurface([ll3])              #front -ve y

    ll4 = gmsh.model.geo.addCurveLoop([c7, -c12, -c3, c11])      
    s4 = gmsh.model.geo.addPlaneSurface([ll4])              #back +ve y

    ll5 = gmsh.model.geo.addCurveLoop([c8, -c9, -c4, c12])      
    s5 = gmsh.model.geo.addPlaneSurface([ll5])              #left -ve x

    ll6 = gmsh.model.geo.addCurveLoop([c6, -c11, -c2, c10])      
    s6 = gmsh.model.geo.addPlaneSurface([ll6])              #right +ve x
    
    sl1 = gmsh.model.geo.addSurfaceLoop([s2, s3, s1, s6, s4, s5])

    return sl1, s1, s2, s3, s4, s5, s6



###################################### FLUID MESH - 3 CHAMBER SYSTEM WITH 2 DYKES #####################################


def chambers_3D(r1,r2,r3, r4, cx, cy, cz, cx2, cy2, cz2, cx3, cy3, cz3,cx_d, cy_d, dz1d, cx_d2, cy_d2, cx_d2_mid, cy_d2_mid,dz2d,dz3d, dz4d, dx, dy,dx2, dy2, dx3, dy3, dx_mid, dy_mid, dz_mid,dz_mid2, rx, ry, rz, rx_sin1, ry_cos1,rx_sin2, ry_cos2,rx_sin3, ry_cos3, lc, lc_upper, lc_sides, lc_if_uc, lc_if_mid, lc_sides_c2, lc_bottom_c2, lc_sides_c3, lc_bottom_c3, lc_if_lc, lc_if_mid2, lc_upper_c3, lc_if_lc3): 
    
  # Upper chamber points 

    p1 = gmsh.model.geo.addPoint(cx, cy, cz, lc)
    p2 = gmsh.model.geo.addPoint(cx, cy-ry, cz, lc_sides)
    p3 = gmsh.model.geo.addPoint(cx+rx_sin1, cy-ry_cos1, cz, lc_sides)
    p4 = gmsh.model.geo.addPoint(cx+rx, cy, cz, lc_sides)
    p5 = gmsh.model.geo.addPoint(cx+rx_sin1, cy+ry_cos1, cz, lc_sides)
    p6 = gmsh.model.geo.addPoint(cx, cy+ry, cz, lc_sides)
    p7 = gmsh.model.geo.addPoint(cx-rx_sin1, cy+ry_cos1, cz, lc_sides)
    p8 = gmsh.model.geo.addPoint(cx-rx, cy, cz, lc_sides)
    p9 = gmsh.model.geo.addPoint(cx-rx_sin1, cy-ry_cos1,cz, lc_sides)
    p10 = gmsh.model.geo.addPoint(cx, cy, cz+rz, lc_upper) # top point
    p11= gmsh.model.geo.addPoint(cx, cy, cz-rz, lc_if_uc)   # bottom point

    # DYKE CONNECTION

    p12= gmsh.model.geo.addPoint(cx_d, cy_d-dy, dz1d, lc_if_uc)
    p13= gmsh.model.geo.addPoint(cx_d+dx, cy_d-dy, dz1d, lc_if_uc)
    p14= gmsh.model.geo.addPoint(cx_d+dx, cy_d, dz1d, lc_if_uc)
    p15= gmsh.model.geo.addPoint(cx_d+dx, cy_d+dy, dz1d, lc_if_uc)
    p16= gmsh.model.geo.addPoint(cx_d, cy_d+dy, dz1d, lc_if_uc)
    p17= gmsh.model.geo.addPoint(cx_d-dx, cy_d+dy, dz1d, lc_if_uc)
    p18= gmsh.model.geo.addPoint(cx_d-dx, cy_d, dz1d, lc_if_uc)
    p19= gmsh.model.geo.addPoint(cx_d-dx, cy_d-dy, dz1d, lc_if_uc)

    #Mid points of DYKE 1 -- change of element size to help with mesh control

    p20= gmsh.model.geo.addPoint(dx_mid, dy_mid-dy, dz_mid, lc_if_mid)
    p21= gmsh.model.geo.addPoint(dx_mid+dx, dy_mid-dy, dz_mid, lc_if_mid)
    p22= gmsh.model.geo.addPoint(dx_mid+dx, dy_mid, dz_mid, lc_if_mid)
    p23= gmsh.model.geo.addPoint(dx_mid+dx, dy_mid+dy, dz_mid, lc_if_mid)
    p24= gmsh.model.geo.addPoint(dx_mid, dy_mid+dy, dz_mid, lc_if_mid)
    p25= gmsh.model.geo.addPoint(dx_mid-dx, dy_mid+dy, dz_mid, lc_if_mid)
    p26= gmsh.model.geo.addPoint(dx_mid-dx, dy_mid, dz_mid, lc_if_mid)
    p27= gmsh.model.geo.addPoint(dx_mid-dx, dy_mid-dy, dz_mid, lc_if_mid)

    # lower conduit - chamber 2 INTERFACE
     

    p28= gmsh.model.geo.addPoint(cx_d, cy_d-dy, dz2d, lc_if_lc)
    p29= gmsh.model.geo.addPoint(cx_d+dx, cy_d-dy, dz2d, lc_if_lc)
    p30= gmsh.model.geo.addPoint(cx_d+dx, cy_d, dz2d, lc_if_lc)
    p31= gmsh.model.geo.addPoint(cx_d+dx, cy_d+dy, dz2d, lc_if_lc)
    p32= gmsh.model.geo.addPoint(cx_d, cy_d+dy, dz2d, lc_if_lc)
    p33= gmsh.model.geo.addPoint(cx_d-dx, cy_d+dy, dz2d, lc_if_lc)
    p34= gmsh.model.geo.addPoint(cx_d-dx, cy_d+dy, dz2d, lc_if_lc)
    p35= gmsh.model.geo.addPoint(cx_d-dx, cy_d, dz2d, lc_if_lc)
    p36= gmsh.model.geo.addPoint(cx_d-dx, cy_d-dy, dz2d, lc_if_lc)

    # CHAMBER 2 POINTS

    p41= gmsh.model.geo.addPoint(cx2, cy2, cz2, lc)
    p42= gmsh.model.geo.addPoint(cx2, cy2-r2, cz2, lc_sides_c2)
    p43= gmsh.model.geo.addPoint(cx2+rx_sin2, cy2-ry_cos2, cz2, lc_sides_c2)
    p44= gmsh.model.geo.addPoint(cx2+r2, cy2, cz2, lc_sides_c2)
    p45= gmsh.model.geo.addPoint(cx2+rx_sin2, cy+ry_cos2, cz2, lc_sides_c2)
    p46= gmsh.model.geo.addPoint(cx2, cy+r2, cz2, lc_sides_c2)
    p47= gmsh.model.geo.addPoint(cx2-rx_sin2, cy2+ry_cos2, cz2, lc_sides_c2)
    p48= gmsh.model.geo.addPoint(cx2-r2, cy2, cz2, lc_sides_c2)
    p49= gmsh.model.geo.addPoint(cx2-rx_sin2, cy2-ry_cos2,cz2, lc_sides_c2)
    
    p50= gmsh.model.geo.addPoint(cx2, cy2, cz2+r1, lc_upper) # UPPER POINT
    p51= gmsh.model.geo.addPoint(cx2, cy2, cz2-r1, lc_bottom_c2) # BOTTOM POINT

    # DYKE #2 (2ND --> 3RD CHAMBER)
  
    p62= gmsh.model.geo.addPoint(cx_d2, cy_d2-dy2, dz3d, lc_if_uc)
    p63= gmsh.model.geo.addPoint(cx_d2+dx2, cy_d2-dy2, dz3d, lc_if_uc)
    p64= gmsh.model.geo.addPoint(cx_d2+dx2, cy_d2, dz3d, lc_if_uc)
    p65= gmsh.model.geo.addPoint(cx_d2+dx2, cy_d2+dy2, dz3d, lc_if_uc)
    p66= gmsh.model.geo.addPoint(cx_d2, cy_d2+dy2, dz3d, lc_if_uc)
    p67= gmsh.model.geo.addPoint(cx_d2-dx2, cy_d2+dy2, dz3d, lc_if_uc)
    p68= gmsh.model.geo.addPoint(cx_d2-dx2, cy_d2, dz3d, lc_if_uc)
    p69= gmsh.model.geo.addPoint(cx_d2-dx2, cy_d2-dy2, dz3d, lc_if_uc)


    # Mid points DYKE 2-- change of element size to help with mesh control

    p70= gmsh.model.geo.addPoint(cx_d2_mid, cy_d2_mid-dy2, dz_mid2, lc_if_mid2)
    p71= gmsh.model.geo.addPoint(cx_d2_mid+dx2, cy_d2_mid-dy2, dz_mid2, lc_if_mid2)
    p72= gmsh.model.geo.addPoint(cx_d2_mid+dx2, cy_d2, dz_mid2, lc_if_mid2)
    p73= gmsh.model.geo.addPoint(cx_d2_mid+dx2, cy_d2_mid+dy2, dz_mid2, lc_if_mid2)
    p74= gmsh.model.geo.addPoint(cx_d2_mid, cy_d2_mid+dy2, dz_mid2, lc_if_mid2)
    p75= gmsh.model.geo.addPoint(cx_d2_mid-dx2, cy_d2_mid+dy2, dz_mid2, lc_if_mid2)
    p76= gmsh.model.geo.addPoint(cx_d2_mid-dx2, cy_d2_mid, dz_mid2, lc_if_mid2)
    p77= gmsh.model.geo.addPoint(cx_d2_mid-dx2, cy_d2_mid-dy2, dz_mid2, lc_if_mid2)

    # --> lower conduit interface of DYKE 2 & chamber 3 

    p78= gmsh.model.geo.addPoint(cx3, cy3-dy3, dz4d, lc_if_lc3)
    p79= gmsh.model.geo.addPoint(cx3+dx3, cy3-dy3, dz4d, lc_if_lc3)
    p80= gmsh.model.geo.addPoint(cx3+dx3, cy3, dz4d, lc_if_lc3)
    p81= gmsh.model.geo.addPoint(cx3+dx3, cy3+dy3, dz4d, lc_if_lc3) 
    p82= gmsh.model.geo.addPoint(cx3, cy3+dy3, dz4d, lc_if_lc3)
    p83= gmsh.model.geo.addPoint(cx3-dx3, cy3+dy3, dz4d, lc_if_lc3)
    p84= gmsh.model.geo.addPoint(cx3-dx3, cy3, dz4d, lc_if_lc3)
    p85= gmsh.model.geo.addPoint(cx3-dx3, cy3-dy3, dz4d, lc_if_lc3)

    # CHAMBER 3 POINTS 

    p91= gmsh.model.geo.addPoint(cx3, cy3, cz3, lc)
    p92= gmsh.model.geo.addPoint(cx3, cy2-r4, cz3, lc_sides_c3)
    p93= gmsh.model.geo.addPoint(cx3+rx_sin3, cy3-ry_cos3, cz3, lc_sides_c3)
    p94= gmsh.model.geo.addPoint(cx3+r4, cy3, cz3, lc_sides_c3)
    p95= gmsh.model.geo.addPoint(cx3+rx_sin3, cy3+ry_cos3, cz3, lc_sides_c3)
    p96= gmsh.model.geo.addPoint(cx3, cy3+r4, cz3, lc_sides_c3)
    p97= gmsh.model.geo.addPoint(cx3-rx_sin3, cy3+ry_cos3, cz3, lc_sides_c3)
    p98= gmsh.model.geo.addPoint(cx3-r4, cy3, cz3, lc_sides_c3)
    p99= gmsh.model.geo.addPoint(cx3-rx_sin3, cy3-ry_cos3,cz3, lc_sides_c3)

    p100= gmsh.model.geo.addPoint(cx3, cy3, cz3+r3, lc_upper_c3)
    p101= gmsh.model.geo.addPoint(cx3, cy3, cz3-r3, lc_bottom_c3)


############################## LINES  ###################################

    c1 = gmsh.model.geo.addEllipseArc(p2,p1,p6,p10)
    c2 = gmsh.model.geo.addEllipseArc(p3,p1,p7,p10)
    c3 = gmsh.model.geo.addEllipseArc(p4,p1,p8,p10)
    c4 = gmsh.model.geo.addEllipseArc(p5,p1,p9,p10)
    c5 = gmsh.model.geo.addEllipseArc(p6,p1,p2,p10)
    c6 = gmsh.model.geo.addEllipseArc(p7,p1,p3,p10)
    c7 = gmsh.model.geo.addEllipseArc(p8,p1,p4,p10)
    c8 = gmsh.model.geo.addEllipseArc(p9,p1,p5,p10)


    c9 = gmsh.model.geo.addCircleArc(p2,p1,p3)
    c10 = gmsh.model.geo.addCircleArc(p3,p1,p4)
    c11= gmsh.model.geo.addCircleArc(p4,p1,p5)
    c12= gmsh.model.geo.addCircleArc(p5,p1,p6)
    c13= gmsh.model.geo.addCircleArc(p6,p1,p7)
    c14 = gmsh.model.geo.addCircleArc(p7,p1,p8)
    c15 = gmsh.model.geo.addCircleArc(p8,p1,p9)
    c16 = gmsh.model.geo.addCircleArc(p9,p1,p2)
    

    c17 = gmsh.model.geo.addEllipseArc(p2,p1,p11,p12)
    c18 = gmsh.model.geo.addEllipseArc(p3,p1,p11,p13)
    c19 = gmsh.model.geo.addEllipseArc(p4,p1,p11,p14)
    c20 = gmsh.model.geo.addEllipseArc(p5,p1,p11,p15)
    c21 = gmsh.model.geo.addEllipseArc(p6,p1,p11,p16)
    c22 = gmsh.model.geo.addEllipseArc(p7,p1,p11,p17)
    c23 = gmsh.model.geo.addEllipseArc(p8,p1,p11,p18)
    c24 = gmsh.model.geo.addEllipseArc(p9,p1,p11,p19)
    
    # dyke interface lines 

    c25= gmsh.model.geo.addLine(p12, p13)
    c26 = gmsh.model.geo.addLine(p13, p14)
    c27 = gmsh.model.geo.addLine(p14, p15)
    c28 = gmsh.model.geo.addLine(p15, p16)
    c29 = gmsh.model.geo.addLine(p16, p17)
    c30 = gmsh.model.geo.addLine(p17, p18)
    c31 = gmsh.model.geo.addLine(p18, p19)
    c32 = gmsh.model.geo.addLine(p19, p12)

    # Conduit lines 

# upper corners

    c33 = gmsh.model.geo.addLine(p13, p21)
    c34 = gmsh.model.geo.addLine(p21, p29)
    c35 = gmsh.model.geo.addLine(p15, p23)
    c36 = gmsh.model.geo.addLine(p23, p31)
    c37 = gmsh.model.geo.addLine(p17, p25)
    c38 = gmsh.model.geo.addLine(p25, p33)
    c39 = gmsh.model.geo.addLine(p19, p27)
    c40 = gmsh.model.geo.addLine(p27, p35)
    
# connecting lines in between mid nodes 

    c41 = gmsh.model.geo.addLine(p20, p21)
    c42 = gmsh.model.geo.addLine(p21, p22)
    c43 = gmsh.model.geo.addLine(p22, p23)
    c44 = gmsh.model.geo.addLine(p23, p24)
    c45 = gmsh.model.geo.addLine(p24, p25)
    c46 = gmsh.model.geo.addLine(p25, p26)
    c47 = gmsh.model.geo.addLine(p26, p27)
    c48 = gmsh.model.geo.addLine(p27, p20)

# connecting lines at lower conduit-chamber interface 

    c49 = gmsh.model.geo.addLine(p28, p29)
    c50 = gmsh.model.geo.addLine(p29, p30)
    c51 = gmsh.model.geo.addLine(p30, p31)
    c52 = gmsh.model.geo.addLine(p31, p32)
    c53 = gmsh.model.geo.addLine(p32, p33)
    c54 = gmsh.model.geo.addLine(p33, p34)
    c55 = gmsh.model.geo.addLine(p34, p35)
    c56 = gmsh.model.geo.addLine(p35, p28)

# Boundary side lines 

    c60 = gmsh.model.geo.addLine(p12, p20)
    c61 = gmsh.model.geo.addLine(p20, p28)
    c62 = gmsh.model.geo.addLine(p14, p22)
    c63 = gmsh.model.geo.addLine(p22, p30)
    c64 = gmsh.model.geo.addLine(p16, p24)
    c65 = gmsh.model.geo.addLine(p24, p32)
    c66 = gmsh.model.geo.addLine(p18, p26)
    c67 = gmsh.model.geo.addLine(p26, p34)


################### 2nd Chamber ####################

    c71 = gmsh.model.geo.addEllipseArc(p42,p41,p50,p28)
    c72 = gmsh.model.geo.addEllipseArc(p43,p41,p50,p29)
    c73 = gmsh.model.geo.addEllipseArc(p44,p41,p50,p30)
    c74 = gmsh.model.geo.addEllipseArc(p45,p41,p50,p31)
    c75 = gmsh.model.geo.addEllipseArc(p46,p41,p50,p32)
    c76 = gmsh.model.geo.addEllipseArc(p47,p41,p50,p33)
    c77 = gmsh.model.geo.addEllipseArc(p48,p41,p50,p34)
    c78 = gmsh.model.geo.addEllipseArc(p49,p41,p50,p35)
    
    c79 = gmsh.model.geo.addCircleArc(p42,p41,p43)
    c80 = gmsh.model.geo.addCircleArc(p43,p41,p44)
    c81 = gmsh.model.geo.addCircleArc(p44,p41,p45)
    c82 = gmsh.model.geo.addCircleArc(p45,p41,p46)
    c83 = gmsh.model.geo.addCircleArc(p46,p41,p47)
    c84 = gmsh.model.geo.addCircleArc(p47,p41,p48)
    c85 = gmsh.model.geo.addCircleArc(p48,p41,p49)
    c86 = gmsh.model.geo.addCircleArc(p49,p41,p42)
    

    c87 = gmsh.model.geo.addEllipseArc(p42,p41,p51,p62)
    c88 = gmsh.model.geo.addEllipseArc(p43,p41,p51,p63)
    c89 = gmsh.model.geo.addEllipseArc(p44,p41,p51,p64)
    c90 = gmsh.model.geo.addEllipseArc(p45,p41,p51,p65)
    c91 = gmsh.model.geo.addEllipseArc(p46,p41,p51,p66)
    c92 = gmsh.model.geo.addEllipseArc(p47,p41,p51,p67)
    c93 = gmsh.model.geo.addEllipseArc(p48,p41,p51,p68)
    c94 = gmsh.model.geo.addEllipseArc(p49,p41,p51,p69)

# DYKE - CHAMBER interface
    
    c100 = gmsh.model.geo.addLine(p62, p63)
    c101= gmsh.model.geo.addLine(p63, p64)
    c102= gmsh.model.geo.addLine(p64, p65)
    c103= gmsh.model.geo.addLine(p65, p66)
    c104= gmsh.model.geo.addLine(p66, p67)
    c105= gmsh.model.geo.addLine(p67, p68)
    c106= gmsh.model.geo.addLine(p68, p69)
    c107= gmsh.model.geo.addLine(p69, p62)
# connecting lines in between mid conduit nodes 
# sides and corners 

    c108 = gmsh.model.geo.addLine(p62, p70)
    c109= gmsh.model.geo.addLine(p70, p78)
    
    c110= gmsh.model.geo.addLine(p63, p71)
    c111= gmsh.model.geo.addLine(p71, p79)
    
    c112= gmsh.model.geo.addLine(p64, p72)
    c113= gmsh.model.geo.addLine(p72, p80)
    
    c114 = gmsh.model.geo.addLine(p65, p73)
    c115= gmsh.model.geo.addLine(p73, p81)

    c116 = gmsh.model.geo.addLine(p66, p74)
    c117= gmsh.model.geo.addLine(p74, p82)
    
    c118= gmsh.model.geo.addLine(p67, p75)
    c119= gmsh.model.geo.addLine(p75, p83)
    
    c120= gmsh.model.geo.addLine(p68, p76)
    c121= gmsh.model.geo.addLine(p76, p84)
    
    c122 = gmsh.model.geo.addLine(p69, p77)
    c123= gmsh.model.geo.addLine(p77, p85)

# connect mid points 

    c124 = gmsh.model.geo.addLine(p70, p71)
    c125 = gmsh.model.geo.addLine(p71, p72)
    c126= gmsh.model.geo.addLine(p72, p73)
    c127= gmsh.model.geo.addLine(p73, p74)
    c128 = gmsh.model.geo.addLine(p74, p75)
    c129= gmsh.model.geo.addLine(p75, p76)
    c130= gmsh.model.geo.addLine(p76, p77)
    c131 = gmsh.model.geo.addLine(p77, p70)

# connect bottom lines

    c132 = gmsh.model.geo.addLine(p78, p79)
    c133 = gmsh.model.geo.addLine(p79, p80)
    c134= gmsh.model.geo.addLine(p80, p81)
    c135= gmsh.model.geo.addLine(p81, p82)
    c136 = gmsh.model.geo.addLine(p82, p83)
    c137= gmsh.model.geo.addLine(p83, p84)
    c138= gmsh.model.geo.addLine(p84, p85)
    c139 = gmsh.model.geo.addLine(p85, p78)

# DEEP CHAMBER - top connection to lower 3rd chamber -- 2nd dyke

    c140 = gmsh.model.geo.addEllipseArc(p92,p101,p100,p78)
    c141 = gmsh.model.geo.addEllipseArc(p93,p101,p100,p79)
    c142 = gmsh.model.geo.addEllipseArc(p94,p101,p100,p80)
    c143 = gmsh.model.geo.addEllipseArc(p95,p101,p100,p81)
    c144 = gmsh.model.geo.addEllipseArc(p96,p101,p100,p82)
    c145 = gmsh.model.geo.addEllipseArc(p97,p101,p100,p83)
    c146 = gmsh.model.geo.addEllipseArc(p98,p101,p100,p84)
    c147 = gmsh.model.geo.addEllipseArc(p99,p101,p100,p85)

# sides 

    c148 = gmsh.model.geo.addCircleArc(p92,p91,p93)
    c149 = gmsh.model.geo.addCircleArc(p93,p91,p94)
    c150 = gmsh.model.geo.addCircleArc(p94,p91,p95)
    c151 = gmsh.model.geo.addCircleArc(p95,p91,p96)
    c152 = gmsh.model.geo.addCircleArc(p96,p91,p97)
    c153 = gmsh.model.geo.addCircleArc(p97,p91,p98)
    c154 = gmsh.model.geo.addCircleArc(p98,p91,p99)
    c155 = gmsh.model.geo.addCircleArc(p99,p91,p92)


# bottom 

    c156 = gmsh.model.geo.addEllipseArc(p92,p91,p92,p101)
    c157 = gmsh.model.geo.addEllipseArc(p93,p91,p93,p101)
    c158 = gmsh.model.geo.addEllipseArc(p94,p91,p94,p101)
    c159 = gmsh.model.geo.addEllipseArc(p95,p91,p95,p101)
    c160 = gmsh.model.geo.addEllipseArc(p96,p91,p96,p101)
    c161 = gmsh.model.geo.addEllipseArc(p97,p91,p97,p101)
    c162 = gmsh.model.geo.addEllipseArc(p98,p91,p98,p101)
    c163 = gmsh.model.geo.addEllipseArc(p99,p91,p99,p101)

    


#################### LINE AND CURVE LOOPS TO CREATE SURFACES #################

# CHAMBER 1 
# top-side 
    ll1 = gmsh.model.geo.addCurveLoop([-c1, c9, c2])      
    s1 = gmsh.model.geo.addSurfaceFilling([ll1])   

    ll2= gmsh.model.geo.addCurveLoop([-c2, c10, c3])      
    s2 = gmsh.model.geo.addSurfaceFilling([ll2])   

    ll3 = gmsh.model.geo.addCurveLoop([-c3, c11, c4])      
    s3 = gmsh.model.geo.addSurfaceFilling([ll3])  

    ll4 = gmsh.model.geo.addCurveLoop([-c4, c12, c5])      
    s4 = gmsh.model.geo.addSurfaceFilling([ll4])  

    ll5 = gmsh.model.geo.addCurveLoop([-c5, c13, c6])      
    s5 = gmsh.model.geo.addSurfaceFilling([ll5])  

    ll6 = gmsh.model.geo.addCurveLoop([-c6, c14, c7])      
    s6 = gmsh.model.geo.addSurfaceFilling([ll6])  

    ll7 = gmsh.model.geo.addCurveLoop([-c7, c15, c8])      
    s7 = gmsh.model.geo.addSurfaceFilling([ll7])  

    ll8 = gmsh.model.geo.addCurveLoop([-c8, c16, c1])      
    s8 = gmsh.model.geo.addSurfaceFilling([ll8])             
        
# bottom / connection to dyke 
#structure = side ellipse, +ve descending ellipse, -ve dyke line, -ve descending ellipse

    ll9 = gmsh.model.geo.addCurveLoop([c9,c18,-c25,-c17])      
    s9 = gmsh.model.geo.addSurfaceFilling([ll9]) 

    ll10 = gmsh.model.geo.addCurveLoop([c10, c19,-c26,-c18])      
    s10 = gmsh.model.geo.addSurfaceFilling([ll10]) 

    ll11 = gmsh.model.geo.addCurveLoop([c11,c20,-c27,-c19])      
    s11 = gmsh.model.geo.addSurfaceFilling([ll11]) 

    ll12 = gmsh.model.geo.addCurveLoop([c12,c21,-c28,-c20])      
    s12 = gmsh.model.geo.addSurfaceFilling([ll12]) 

    ll13 = gmsh.model.geo.addCurveLoop([c13,c22,-c29,-c21])      
    s13 = gmsh.model.geo.addSurfaceFilling([ll13]) 

    ll14 = gmsh.model.geo.addCurveLoop([c14,c23,-c30,-c22])      
    s14 = gmsh.model.geo.addSurfaceFilling([ll14]) 

    ll15 = gmsh.model.geo.addCurveLoop([c15,c24,-c31,-c23])      
    s15 = gmsh.model.geo.addSurfaceFilling([ll15]) 

    ll16 = gmsh.model.geo.addCurveLoop([c16,c17,-c32,-c24])      
    s16 = gmsh.model.geo.addSurfaceFilling([ll16]) 


# DYKE 1 line loops


    ll17 = gmsh.model.geo.addCurveLoop([c25,c33,-c41,-c60])      
    s17 = gmsh.model.geo.addSurfaceFilling([ll17]) 

    ll18 = gmsh.model.geo.addCurveLoop([c41,c34,-c49,-c61])      
    s18 = gmsh.model.geo.addSurfaceFilling([ll18]) 

    ll19 = gmsh.model.geo.addCurveLoop([c33,c42,-c62,-c26])      
    s19 = gmsh.model.geo.addSurfaceFilling([ll19]) 

    ll20 = gmsh.model.geo.addCurveLoop([c42,c63,-c50,-c34])      
    s20 = gmsh.model.geo.addSurfaceFilling([ll20]) 

    ll21 = gmsh.model.geo.addCurveLoop([c27,c35,-c43,-c62])      
    s21 = gmsh.model.geo.addSurfaceFilling([ll21]) 

    ll22 = gmsh.model.geo.addCurveLoop([c43,c36,-c51,-c63])      
    s22= gmsh.model.geo.addSurfaceFilling([ll22]) 

    ll23 = gmsh.model.geo.addCurveLoop([c28,c64,-c44,-c35])      
    s23 = gmsh.model.geo.addSurfaceFilling([ll23]) 

    ll24 = gmsh.model.geo.addCurveLoop([c44,c65,-c52,-c36])      
    s24 = gmsh.model.geo.addSurfaceFilling([ll24]) 

    ll25 = gmsh.model.geo.addCurveLoop([c29,c37,-c45,-c64])      
    s25 = gmsh.model.geo.addSurfaceFilling([ll25]) 

    ll26 = gmsh.model.geo.addCurveLoop([c45,c38,-c53,-c65])      
    s26= gmsh.model.geo.addSurfaceFilling([ll26]) 

    ll27 = gmsh.model.geo.addCurveLoop([c30,c66,-c46,-c37])      
    s27 = gmsh.model.geo.addSurfaceFilling([ll27]) 

    ll28 = gmsh.model.geo.addCurveLoop([c46,c67,-c54,-c38])      
    s28 = gmsh.model.geo.addSurfaceFilling([ll28]) 

    ll29 = gmsh.model.geo.addCurveLoop([c31,c39,-c47,-c66])      
    s29 = gmsh.model.geo.addSurfaceFilling([ll29]) 

    ll30 = gmsh.model.geo.addCurveLoop([c47,c40,-c55,-c67])      
    s30= gmsh.model.geo.addSurfaceFilling([ll30]) 

    ll31 = gmsh.model.geo.addCurveLoop([c32,c60,-c48,-c39])      
    s31 = gmsh.model.geo.addSurfaceFilling([ll31]) 

    ll32 = gmsh.model.geo.addCurveLoop([c48,c61,-c56,-c40])      
    s32 = gmsh.model.geo.addSurfaceFilling([ll32]) 

# CHAMBER 2 
# top surfaces
   
    ll41 = gmsh.model.geo.addCurveLoop([c71,c49,-c72,-c79])      
    s41 = gmsh.model.geo.addSurfaceFilling([ll41]) 
    ll42 = gmsh.model.geo.addCurveLoop([c72,c50,-c73,-c80])      
    s42 = gmsh.model.geo.addSurfaceFilling([ll42]) 
    ll43 = gmsh.model.geo.addCurveLoop([c73,c51,-c74,-c81])      
    s43 = gmsh.model.geo.addSurfaceFilling([ll43]) 
    ll44 = gmsh.model.geo.addCurveLoop([c74,c52,-c75,-c82])      
    s44 = gmsh.model.geo.addSurfaceFilling([ll44]) 
    ll45 = gmsh.model.geo.addCurveLoop([c75,c53,-c76,-c83])      
    s45 = gmsh.model.geo.addSurfaceFilling([ll45])     
    ll46 = gmsh.model.geo.addCurveLoop([c76,c54,-c77,-c84])      
    s46 = gmsh.model.geo.addSurfaceFilling([ll46])     
    ll47 = gmsh.model.geo.addCurveLoop([c77,c55,-c78,-c85])      
    s47 = gmsh.model.geo.addSurfaceFilling([ll47]) 
    ll48 = gmsh.model.geo.addCurveLoop([c78,c56,-c71,-c86])      
    s48 = gmsh.model.geo.addSurfaceFilling([ll48]) 

# bottom --> DYKE 2

    ll49 = gmsh.model.geo.addCurveLoop([c79,c88,-c100,-c87])      
    s49 = gmsh.model.geo.addSurfaceFilling([ll49]) 
    ll50 = gmsh.model.geo.addCurveLoop([c80,c89,-c101,-c88])      
    s50 = gmsh.model.geo.addSurfaceFilling([ll50]) 
    ll51 = gmsh.model.geo.addCurveLoop([c81,c90,-c102,-c89])      
    s51 = gmsh.model.geo.addSurfaceFilling([ll51]) 
    ll52 = gmsh.model.geo.addCurveLoop([c82,c91,-c103,-c90])      
    s52 = gmsh.model.geo.addSurfaceFilling([ll52]) 
    ll53 = gmsh.model.geo.addCurveLoop([c83,c92,-c104,-c91])      
    s53 = gmsh.model.geo.addSurfaceFilling([ll53]) 
    ll54 = gmsh.model.geo.addCurveLoop([c84,c93,-c105,-c92])      
    s54 = gmsh.model.geo.addSurfaceFilling([ll54]) 
    ll55 = gmsh.model.geo.addCurveLoop([c85,c94,-c106,-c93])      
    s55= gmsh.model.geo.addSurfaceFilling([ll55]) 
    ll56 = gmsh.model.geo.addCurveLoop([c86,c87,-c107,-c94])      
    s56 = gmsh.model.geo.addSurfaceFilling([ll56]) 


# connect DYKE surface subsections

    ll57 = gmsh.model.geo.addCurveLoop([c100,c110,-c124,-c108])      
    s57 = gmsh.model.geo.addSurfaceFilling([ll57]) 
    ll58 = gmsh.model.geo.addCurveLoop([c124,c111,-c132,-c109])      
    s58 = gmsh.model.geo.addSurfaceFilling([ll58]) 
    ll59 = gmsh.model.geo.addCurveLoop([c101,c112,-c125,-c110])      
    s59 = gmsh.model.geo.addSurfaceFilling([ll59]) 
    ll60 = gmsh.model.geo.addCurveLoop([c125,c113,-c133,-c111])      
    s60 = gmsh.model.geo.addSurfaceFilling([ll60])

    ll61 = gmsh.model.geo.addCurveLoop([c102,c114,-c126,-c112])      
    s61 = gmsh.model.geo.addSurfaceFilling([ll61]) 
    ll62 = gmsh.model.geo.addCurveLoop([c126,c115,-c134,-c113])      
    s62 = gmsh.model.geo.addSurfaceFilling([ll62]) 
    ll63 = gmsh.model.geo.addCurveLoop([c103,c116,-c127,-c114])      
    s63 = gmsh.model.geo.addSurfaceFilling([ll63]) 
    ll64 = gmsh.model.geo.addCurveLoop([c127,c117,-c135,-c115])      
    s64 = gmsh.model.geo.addSurfaceFilling([ll64]) 

    ll65 = gmsh.model.geo.addCurveLoop([c104,c118,-c128,-c116])      
    s65 = gmsh.model.geo.addSurfaceFilling([ll65]) 
    ll66 = gmsh.model.geo.addCurveLoop([c128,c119,-c136,-c117])      
    s66 = gmsh.model.geo.addSurfaceFilling([ll66]) 
    ll67 = gmsh.model.geo.addCurveLoop([c105,c120,-c129,-c118])      
    s67 = gmsh.model.geo.addSurfaceFilling([ll67]) 
    ll68 = gmsh.model.geo.addCurveLoop([c129,c121,-c137,-c119])      
    s68 = gmsh.model.geo.addSurfaceFilling([ll68]) 

    ll69 = gmsh.model.geo.addCurveLoop([c106,c122,-c130,-c120])      
    s69 = gmsh.model.geo.addSurfaceFilling([ll69]) 
    ll70 = gmsh.model.geo.addCurveLoop([c130,c123,-c138,-c121])      
    s70 = gmsh.model.geo.addSurfaceFilling([ll70]) 
    ll71 = gmsh.model.geo.addCurveLoop([c107,c108,-c131,-c122])      
    s71 = gmsh.model.geo.addSurfaceFilling([ll71]) 
    ll72 = gmsh.model.geo.addCurveLoop([c131,c109,-c139,-c123])      
    s72 = gmsh.model.geo.addSurfaceFilling([ll72]) 

##################### add surface here for conduit with 2 chambers only  ################

# DEEP CHAMBER 

# top chamber surfaces 

    ll73 = gmsh.model.geo.addCurveLoop([c140,c132,-c141,-c148])      
    s73 = gmsh.model.geo.addSurfaceFilling([ll73]) 
    ll74 = gmsh.model.geo.addCurveLoop([c141,c133,-c142,-c149])      
    s74= gmsh.model.geo.addSurfaceFilling([ll74]) 
    ll75 = gmsh.model.geo.addCurveLoop([c142,c134,-c143,-c150])      
    s75= gmsh.model.geo.addSurfaceFilling([ll75]) 
    ll76 = gmsh.model.geo.addCurveLoop([c143,c135,-c144,-c151])      
    s76 = gmsh.model.geo.addSurfaceFilling([ll76]) 

    ll77 = gmsh.model.geo.addCurveLoop([c144,c136,-c145,-c152])      
    s77 = gmsh.model.geo.addSurfaceFilling([ll77]) 
    ll78 = gmsh.model.geo.addCurveLoop([c145,c137,-c146,-c153])      
    s78 = gmsh.model.geo.addSurfaceFilling([ll78]) 
    ll79 = gmsh.model.geo.addCurveLoop([c146,c138,-c147,-c154])      
    s79 = gmsh.model.geo.addSurfaceFilling([ll79]) 
    ll80 = gmsh.model.geo.addCurveLoop([c147,c139,-c140,-c155])      
    s80 = gmsh.model.geo.addSurfaceFilling([ll80]) 

# bottom surfaces

    ll81 = gmsh.model.geo.addCurveLoop([c148,c157,-c156])      
    s81 = gmsh.model.geo.addSurfaceFilling([ll81]) 
    ll82 = gmsh.model.geo.addCurveLoop([c149,c158,-c157])      
    s82 = gmsh.model.geo.addSurfaceFilling([ll82]) 
    ll83 = gmsh.model.geo.addCurveLoop([c150,c159,-c158])      
    s83 = gmsh.model.geo.addSurfaceFilling([ll83]) 
    ll84 = gmsh.model.geo.addCurveLoop([c151,c160,-c159])      
    s84 = gmsh.model.geo.addSurfaceFilling([ll84]) 

    ll85 = gmsh.model.geo.addCurveLoop([c152,c161,-c160])      
    s85 = gmsh.model.geo.addSurfaceFilling([ll85]) 
    ll86 = gmsh.model.geo.addCurveLoop([c153,c162,-c161])      
    s86 = gmsh.model.geo.addSurfaceFilling([ll86]) 
    ll87 = gmsh.model.geo.addCurveLoop([c154,c163,-c162])      
    s87 = gmsh.model.geo.addSurfaceFilling([ll87]) 
    ll88 = gmsh.model.geo.addCurveLoop([c155,c156,-c163])      
    s88 = gmsh.model.geo.addSurfaceFilling([ll88]) 
   
    sl = gmsh.model.geo.addSurfaceLoop([s1, s2, s3, s4, s5, s6,s7,s8,s9, s10,s11,s12,s13,s14,s15,s16,s17,s18,s19,s20,s21,s22,s23,s24,s25,s26,s27,s28,s29,s30,s31,s32,s41,s42,s43,s44,s45,s46,s47,s48,s49,s50,s51,s52,s53,s54,s55,s56,s57,s58,s59,s60,s61,s62,s63,s64,s65,s66,s67,s68,s69,s70,s71,s72,s73,s74,s75,s76,s77,s78,s79,s80,s81,s82,s83,s84,s85,s86,s87,s88])
    return sl,s1,s2,s3,s4,s5,s6,s7,s8,s9,s10,s11,s12,s13,s14,s15,s16,s17,s18,s19,s20,s21,s22,s23,s24,s25,s26,s27,s28,s29,s30,s31,s32,s41,s42,s43,s44,s45,s46,s47,s48,s49,s50,s51,s52,s53,s54,s55,s56,s57,s58,s59,s60,s61,s62,s63,s64,s65,s66,s67,s68,s69,s70,s71,s72,s73,s74,s75,s76,s77,s78,s79,s80,s81,s82,s83,s84,s85,s86,s87,s88
  











def execute(input_file, z, mesh_min_size, mesh_max_size):

    gmsh.initialize(sys.argv)
    gmsh.option.setNumber("General.NumThreads", os.cpu_count())# for parallel 3D meshing
    print('cpu_count: ', os.cpu_count())
    
    path = os.path.dirname(os.path.abspath(__file__))
    
    # load an STL surface
    gmsh.merge(os.path.join(path, input_file))
    
    
    ob_sl, ob_bottom, ob_front, ob_right, ob_back, ob_left, ob_top, c1, c2, c3, c4, p1, p2, p3, p4 = outer_box(h=1000)



#    B_sl, B_bottom, B_top, B_front, B_back, B_left, B_right = box_hole(cx=50000, cy=50000, cz=-5000, xl=3000, yl=3000, zl=1000, h=100)    
#    S_sl, S_s1, S_s2, S_s3, S_s4, S_s5, S_s6, S_s7, S_s8 = sphere_hole(cx=50000, cy=50000, cz=-5000, r=3000, h=100)    
#    E_sl, E_s1, E_s2, E_s3, E_s4, E_s5, E_s6, E_s7, E_s8 = ellipsoid_hole(cx=50000, cy=50000, cz=-5000, rx=3000, ry=3000, rz=1000, h=10)    
    C_sl,C_s1, C_s2, C_s3, C_s4, C_s5, C_s6,C_s7,C_s8,C_s9, C_s10,C_s11,C_s12,C_s13,C_s14,C_s15,C_s16,C_s17,C_s18,C_s19,C_s20,C_s21,C_s22,C_s23,C_s24,C_s25,C_s26,C_s27,C_s28,C_s29,C_s30,C_s31,C_s32,C_s41,C_s42,C_s43,C_s44,C_s45,C_s46,C_s47,C_s48,C_s49,C_s50,C_s51,C_s52,C_s53,C_s54,C_s55,C_s56,C_s57,C_s58, C_s59,C_s60,C_s61,C_s62,C_s63,C_s64,C_s65,C_s66,C_s67,C_s68,C_s69,C_s70,C_s71,C_s72,C_s73,C_s74,C_s75,C_s76,C_s77,C_s78,C_s79,C_s80,C_s81,C_s82,C_s83,C_s84,C_s85,C_s86,C_s87,C_s88  = chambers_3D(r1,r2,r3, r4, cx, cy, cz, cx2, cy2, cz2, cx3, cy3, cz3,cx_d, cy_d, dz1d, cx_d2, cy_d2, cx_d2_mid, cy_d2_mid,dz2d,dz3d, dz4d, dx, dy,dx2, dy2, dx3, dy3, dx_mid, dy_mid, dz_mid,dz_mid2, rx, ry, rz, rx_sin1, ry_cos1,rx_sin2, ry_cos2,rx_sin3, ry_cos3, lc, lc_upper, lc_sides, lc_if_uc, lc_if_mid, lc_sides_c2, lc_bottom_c2, lc_sides_c3, lc_bottom_c3, lc_if_lc, lc_if_mid2, lc_upper_c3, lc_if_lc3)
    
    #fluid = gmsh.model.geo.addVolume([C_sl])
    #solid = gmsh.model.geo.addVolume([ob_sl])
    vol = gmsh.model.geo.addVolume([ob_sl,C_sl])
    gmsh.model.geo.removeAllDuplicates()
      
    gmsh.option.setNumber('Mesh.MeshSizeMin', mesh_min_size)
    gmsh.option.setNumber('Mesh.MeshSizeMax', mesh_max_size)
    gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 50)    

    gmsh.model.mesh.field.add("Ball", 1)
    gmsh.model.mesh.field.setNumber(1, "VIn", 200)
    gmsh.model.mesh.field.setNumber(1, "VOut", 1000)
    gmsh.model.mesh.field.setNumber(1, "XCenter", 50000)
    gmsh.model.mesh.field.setNumber(1, "YCenter", 50000)
    gmsh.model.mesh.field.setNumber(1, "ZCenter", 1000)
    gmsh.model.mesh.field.setNumber(1, "Radius", 10000)
    gmsh.model.mesh.field.setNumber(1, "Thickness", 10000)
    gmsh.model.mesh.field.setAsBackgroundMesh(1)


    gmsh.model.geo.synchronize()
    
    
    
    gmsh.model.addPhysicalGroup(3, [vol], 10)  # volume tag = 10
    
    gmsh.model.addPhysicalGroup(2, [ob_bottom, ob_front, ob_right, ob_back, ob_left], 5)   # lateral boundaries tag = 5
    gmsh.model.addPhysicalGroup(1, [c1, c2, c3, c4], 5)   # lateral boundaries tag = 5
    gmsh.model.addPhysicalGroup(0, [p1, p2, p3, p4], 5)   # lateral boundaries tag = 5
    
    #gmsh.model.addPhysicalGroup(2, [E_s1, E_s2, E_s3, E_s4, E_s5, E_s6, E_s7, E_s8], 4)   # hole boundaries tag = 4
    gmsh.model.addPhysicalGroup(2, [C_s1, C_s2, C_s3, C_s4, C_s5, C_s6,C_s7,C_s8,C_s9, C_s10,C_s11,C_s12,C_s13,C_s14,C_s15,C_s16,C_s17,C_s18,C_s19,C_s20,C_s21,C_s22,C_s23,C_s24,C_s25,C_s26,C_s27,C_s28,C_s29,C_s30,C_s31,C_s32,C_s41,C_s42,C_s43,C_s44,C_s45,C_s46,C_s47,C_s48,C_s49,C_s50,C_s51,C_s52,C_s53,C_s54,C_s55,C_s56,C_s57,C_s58, C_s59,C_s60,C_s61,C_s62,C_s63,C_s64,C_s65,C_s66,C_s67,C_s68,C_s69,C_s70,C_s71,C_s72,C_s73,C_s74,C_s75,C_s76,C_s77,C_s78,C_s79,C_s80,C_s81,C_s82,C_s83,C_s84,C_s85,C_s86,C_s87,C_s88], 4) 
    

    
    gmsh.model.mesh.generate(3)
    gmsh.option.setNumber("Mesh.MshFileVersion", 2)
    gmsh.write("mesh.msh")
        
    if '-nopopup' not in sys.argv:
        gmsh.fltk.run()
    
    gmsh.finalize()






execute(input_file, z, mesh_min_size, mesh_max_size)    

