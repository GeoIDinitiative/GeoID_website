#!/usr/bin/python3

import gmsh
import math
import os
import sys

mesh_min_size = 100
mesh_max_size = 10000
    
z_bd = -15000.0
input_file = '/home/owen/ETNA_model/ETNA_3_chambers/etna.stl'

def chambers_3_Etna():
    ########################## Dimension specifications for the 3D pluming system ##############################

    #upper chamber dimensions

    cx = 50000
    cy = 50000
    cz = 1350
    lc = 50 #default size
    lc_upper = 30
    lc_sides = 10
    lc_if_uc = 1 #size at interface between dyke and upper chamber
    rx = 250
    ry = 250
    rz = 250
    rx_sin1 = 162.3620121 # location of points via trig functions -- gmsh doesn't appear to have these functions built in (change in future?)
    ry_cos1 = 190.1014914

    #2nd chamber dimensions

    cx2 = 50000
    cy2 = 50000

    cz2 = -4550

    r1 = 800
    r2 = 6000
    lc_sides_c2 = 30 
    lc_bottom_c2 = 10 # size determined by conduit point size
    rx_sin2 = 3896.68829 # location of points via trig functions -- gmsh doesn't appear to have these functions built in (change in future?)
    ry_cos2 = 4562.435794


    #DYKE DIMENSIONS

    lc_if_lc = 30 # size at interface between dyke and lower chamber
    cx_d = cx # centre x,y of dyke on 2nd chamber 
    cy_d = cy
    dx = 5
    dy = 100
    dz1d = cz - rz # subtract from central z of upper chamber
    dz2d = cz2 + r1 # distance from centre of lower chamber interface to conduit interace

    #mid points DYKE 1
    dx_mid = 50000
    dy_mid = 50000
    dz_mid = (dz1d+dz2d)/2 
    lc_if_mid = 30 

    #DYKE 2 
    cx_d2 = cx2
    cy_d2 = cy2
    dz3d = cz2 - r1 
    dx2 = 10
    dy2 = 200


# UPPER CHAMBER

    p1 =gmsh.model.geo.addPoint(cx, cy, cz, lc);   
    p2 =gmsh.model.geo.addPoint(cx, cy-ry, cz, lc_sides);  
    p3 =gmsh.model.geo.addPoint(cx+rx_sin1, cy-ry_cos1, cz, lc_sides);  
    p4 =gmsh.model.geo.addPoint(cx+rx, cy, cz, lc_sides);  
    p5 =gmsh.model.geo.addPoint(cx+rx_sin1, cy+ry_cos1, cz, lc_sides);  
    p6 =gmsh.model.geo.addPoint(cx, cy+ry, cz, lc_sides);  
    p7 =gmsh.model.geo.addPoint(cx-rx_sin1, cy+ry_cos1, cz, lc_sides);   
    p8 =gmsh.model.geo.addPoint(cx-rx, cy, cz, lc_sides)
    p9 =gmsh.model.geo.addPoint(cx-rx_sin1, cy-ry_cos1,cz, lc_sides)
    p10 =gmsh.model.geo.addPoint(cx, cy, cz+rz, lc_upper)
    p11=gmsh.model.geo.addPoint(cx, cy, cz-rz, lc_if_uc)
    
    p12 =gmsh.model.geo.addPoint(cx_d, cy_d-dy, dz1d, lc_if_uc) 
    p13 =gmsh.model.geo.addPoint(cx_d+dx, cy_d-dy, dz1d, lc_if_uc) 
    p14 =gmsh.model.geo.addPoint(cx_d+dx, cy_d, dz1d, lc_if_uc) 
    p15 =gmsh.model.geo.addPoint(cx_d+dx, cy_d+dy, dz1d, lc_if_uc) 
    p16 =gmsh.model.geo.addPoint(cx_d, cy_d+dy, dz1d, lc_if_uc) 
    p17 = gmsh.model.geo.addPoint(cx_d-dx, cy_d+dy, dz1d, lc_if_uc) 
    p18 =gmsh.model.geo.addPoint(cx_d-dx, cy_d, dz1d, lc_if_uc) 
    p19 =gmsh.model.geo.addPoint(cx_d-dx, cy_d-dy, dz1d, lc_if_uc) 

# Mid points -- change of element size to help with mesh control

    p20 =gmsh.model.geo.addPoint(dx_mid, dy_mid-dy, dz_mid, lc_if_mid) 
    p21 =gmsh.model.geo.addPoint(dx_mid+dx, dy_mid-dy, dz_mid, lc_if_mid) 
    p22 =gmsh.model.geo.addPoint(dx_mid+dx, dy_mid, dz_mid, lc_if_mid) 
    p23 =gmsh.model.geo.addPoint(dx_mid+dx, dy_mid+dy, dz_mid, lc_if_mid) 
    p24 =gmsh.model.geo.addPoint(dx_mid, dy_mid+dy, dz_mid, lc_if_mid) 
    p25 =gmsh.model.geo.addPoint(dx_mid-dx, dy_mid+dy, dz_mid, lc_if_mid)
    p26 =gmsh.model.geo.addPoint(dx_mid-dx, dy_mid, dz_mid, lc_if_mid) 
    p27 =gmsh.model.geo.addPoint(dx_mid-dx, dy_mid-dy, dz_mid, lc_if_mid)

# lower conduit 
    p28 =gmsh.model.geo.addPoint(cx_d, cy_d-dy, dz2d, lc_if_lc) 
    p29 =gmsh.model.geo.addPoint(cx_d+dx, cy_d-dy, dz2d, lc_if_lc)
    p30 =gmsh.model.geo.addPoint(cx_d+dx, cy_d, dz2d, lc_if_lc) 
    p31 =gmsh.model.geo.addPoint(cx_d+dx, cy_d+dy, dz2d, lc_if_lc)
    p32 =gmsh.model.geo.addPoint(cx_d, cy_d+dy, dz2d, lc_if_lc) 
    p33 =gmsh.model.geo.addPoint(cx_d-dx, cy_d+dy, dz2d, lc_if_lc)
    p34 =gmsh.model.geo.addPoint(cx_d-dx, cy_d, dz2d, lc_if_lc) 
    p35 =gmsh.model.geo.addPoint(cx_d-dx, cy_d-dy, dz2d, lc_if_lc)
# 2nd chamber
    p41 =gmsh.model.geo.addPoint(cx2, cy2, cz2, lc)   
    p42 =gmsh.model.geo.addPoint(cx2, cy2-r2, cz2, lc_sides_c2)
    p43 =gmsh.model.geo.addPoint(cx2+rx_sin2, cy2-ry_cos2, cz2, lc_sides_c2)   
    p44 =gmsh.model.geo.addPoint(cx2+r2, cy2, cz2, lc_sides_c2)   
    p45 =gmsh.model.geo.addPoint(cx2+rx_sin2, cy+ry_cos2, cz2, lc_sides_c2)
    p46 =gmsh.model.geo.addPoint(cx2, cy+r2, cz2, lc_sides_c2)   
    p47 =gmsh.model.geo.addPoint(cx2-rx_sin2, cy2+ry_cos2, cz2, lc_sides_c2)
    p48 =gmsh.model.geo.addPoint(cx2-r2, cy2, cz2, lc_sides_c2) 
    p49 =gmsh.model.geo.addPoint(cx2-rx_sin2, cy2-ry_cos2,cz2, lc_sides_c2)


    p50 =gmsh.model.geo.addPoint(cx2, cy2, cz2+r1, lc_upper)# top point   
    p51 =gmsh.model.geo.addPoint(cx2, cy2, cz2-r1, lc_bottom_c2) # bottom point

    p62 =gmsh.model.geo.addPoint(cx_d2, cy_d2-dy2, dz3d, lc_if_uc) 
    p63 =gmsh.model.geo.addPoint(cx_d2+dx2, cy_d2-dy2, dz3d, lc_if_uc)
    p64 =gmsh.model.geo.addPoint(cx_d2+dx2, cy_d2, dz3d, lc_if_uc)   
    p65 =gmsh.model.geo.addPoint(cx_d2+dx2, cy_d2+dy2, dz3d, lc_if_uc)
    p66 =gmsh.model.geo.addPoint(cx_d2, cy_d2+dy2, dz3d, lc_if_uc) 
    p67 =gmsh.model.geo.addPoint(cx_d2-dx2, cy_d2+dy2, dz3d, lc_if_uc)
    p68 =gmsh.model.geo.addPoint(cx_d2-dx2, cy_d2, dz3d, lc_if_uc) 
    p69 =gmsh.model.geo.addPoint(cx_d2-dx2, cy_d2-dy2, dz3d, lc_if_uc)

    

############################## LINES  ###################################

    c1 = gmsh.model.geo.addEllipseArc(p2,p1,p6,p10)
    c2 = gmsh.model.geo.addEllipseArc(p3,p1,p7,p10)
    c3 = gmsh.model.geo.addEllipseArc(p4,p1,p8,p10)
    c4 = gmsh.model.geo.addEllipseArc(p5,p1,p9,p10)
    c5 = gmsh.model.geo.addEllipseArc(p6,p1,p2,p10)
    c6 = gmsh.model.geo.addEllipseArc(p7,p1,p3,p10)
    c7 = gmsh.model.geo.addEllipseArc(p8,p1,p4,p10)
    c8 = gmsh.model.geo.addEllipseArc(p9,p1,p5,p10)

    c9 = gmsh.model.geo.addEllipseArc(p2,p1,p6,p3)
    c10 = gmsh.model.geo.addEllipseArc(p3,p1,p7,p4)
    c11= gmsh.model.geo.addEllipseArc(p4,p1,p8,p5)
    c12= gmsh.model.geo.addEllipseArc(p5,p1,p9,p6)
    c13= gmsh.model.geo.addEllipseArc(p6,p1,p2,p7)
    c14 = gmsh.model.geo.addEllipseArc(p7,p1,p3,p8)
    c15 = gmsh.model.geo.addEllipseArc(p8,p1,p4,p9)
    c16 = gmsh.model.geo.addEllipseArc(p9,p1,p5,p2)

    
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

    #c71 = gmsh.model.geo.addEllipseArc(p42,p41,p50,p28)
    #c72 = gmsh.model.geo.addEllipseArc(p43,p41,p50,p29)
    #c73 = gmsh.model.geo.addEllipseArc(p44,p41,p50,p30)
    #c74 = gmsh.model.geo.addEllipseArc(p45,p41,p50,p31)
    #c75 = gmsh.model.geo.addEllipseArc(p46,p41,p50,p32)
    #c76 = gmsh.model.geo.addEllipseArc(p47,p41,p50,p33)
    #c77 = gmsh.model.geo.addEllipseArc(p48,p41,p50,p34)
    #c78 = gmsh.model.geo.addEllipseArc(p49,p41,p50,p35)

    c71 = gmsh.model.geo.addEllipseArc(p42,p41,p46,p28)
    c72 = gmsh.model.geo.addEllipseArc(p43,p41,p47,p29)
    c73 = gmsh.model.geo.addEllipseArc(p44,p41,p48,p30)
    c74 = gmsh.model.geo.addEllipseArc(p45,p41,p49,p31)
    c75 = gmsh.model.geo.addEllipseArc(p46,p41,p42,p32)
    c76 = gmsh.model.geo.addEllipseArc(p47,p41,p43,p33)
    c77 = gmsh.model.geo.addEllipseArc(p48,p41,p44,p34)
    c78 = gmsh.model.geo.addEllipseArc(p49,p41,p45,p35)
     ###################################################
    c79 = gmsh.model.geo.addEllipseArc(p42,p41,p46,p43)
    c80 = gmsh.model.geo.addEllipseArc(p43,p41,p44,p44)
    c81 = gmsh.model.geo.addEllipseArc(p44,p41,p48,p45)
    c82 = gmsh.model.geo.addEllipseArc(p45,p41,p49,p46)
    c83 = gmsh.model.geo.addEllipseArc(p46,p41,p42,p47)
    c84 = gmsh.model.geo.addEllipseArc(p47,p41,p48,p48)
    c85 = gmsh.model.geo.addEllipseArc(p48,p41,p44,p49)
    c86 = gmsh.model.geo.addEllipseArc(p49,p41,p45,p42)

    ###################################################
    c87 = gmsh.model.geo.addEllipseArc(p42,p41,p46,p62)
    c88 = gmsh.model.geo.addEllipseArc(p43,p41,p47,p63)
    c89 = gmsh.model.geo.addEllipseArc(p44,p41,p48,p64)
    c90 = gmsh.model.geo.addEllipseArc(p45,p41,p49,p65)
    c91 = gmsh.model.geo.addEllipseArc(p46,p41,p42,p66)
    c92 = gmsh.model.geo.addEllipseArc(p47,p41,p43,p67)
    c93 = gmsh.model.geo.addEllipseArc(p48,p41,p44,p68)
    c94 = gmsh.model.geo.addEllipseArc(p49,p41,p45,p69)

# DYKE - CHAMBER interface
    
    c100 = gmsh.model.geo.addLine(p62, p63)
    c101= gmsh.model.geo.addLine(p63, p64)
    c102= gmsh.model.geo.addLine(p64, p65)
    c103= gmsh.model.geo.addLine(p65, p66)
    c104= gmsh.model.geo.addLine(p66, p67)
    c105= gmsh.model.geo.addLine(p67, p68)
    c106= gmsh.model.geo.addLine(p68, p69)
    c107= gmsh.model.geo.addLine(p69, p62)


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


##################### add surface here for conduit with 2 chambers only  ################

   
    sl = gmsh.model.geo.addSurfaceLoop([s1, s2, s3, s4, s5, s6,s7,s8,s9, s10,s11,s12,s13,s14,s15,s16,s17,s18,s19,s20,s21,s22,s23,s24,s25,s26,s27,s28,s29,s30,s31,s32,s41,s42,s43,s44,s45,s46,s47,s48,s49,s50,s51,s52,s53,s54,s55,s56])
    return sl,s1,s2,s3,s4,s5,s6,s7,s8,s9,s10,s11,s12,s13,s14,s15,s16,s17,s18,s19,s20,s21,s22,s23,s24,s25,s26,s27,s28,s29,s30,s31,s32,s41,s42,s43,s44,s45,s46,s47,s48,s49,s50,s51,s52,s53,s54,s55,s56
  
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

def outer_box(h):
   
    gmsh.model.mesh.classifySurfaces(math.pi, curveAngle=math.pi / 3)
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
  
    p1 = gmsh.model.geo.addPoint(xyz[0], xyz[1], z_bd, h)    # bottom surface points
    p2 = gmsh.model.geo.addPoint(xyz[3], xyz[4], z_bd, h)
    p3 = gmsh.model.geo.addPoint(xyz[6], xyz[7], z_bd, h)
    p4 = gmsh.model.geo.addPoint(xyz[9], xyz[10], z_bd, h)      
    
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

def elevation_GNSS_stations():
    
    name, xs, ys, zs = [],[], [], []
    
    f = open('/home/owen/ETNA_model/ETNA_3_chambers/station_data.txt', 'r')
    
    for i in range(88):
       s = f.readline().strip().split()
       name.append(s[0])
       xs.append(float(s[1]))
       ys.append(float(s[2]))
       zs.append(float(s[3]))      
    f.close()
    
    # MESH SIZE FOR STATIONS

    tilt = 50
    strain = 50
    seis = 50
    GPS =50
    GNSS = 50

    # Tilt tag = -1 
    CBD= gmsh.model.geo.addPoint(xs[1], ys[1], zs[1], tilt, -1)
    CDP= gmsh.model.geo.addPoint(xs[2], ys[2], zs[2], tilt, -1)
    CDV=gmsh.model.geo.addPoint(xs[3], ys[3], zs[3], tilt, -1)
    DAM=gmsh.model.geo.addPoint(xs[4], ys[4], zs[4], tilt, -1)
    EC10=gmsh.model.geo.addPoint(xs[5], ys[5], zs[5], tilt, -1)
    ECP=gmsh.model.geo.addPoint(xs[6], ys[6], zs[6], tilt, -1)
    MAS=gmsh.model.geo.addPoint(xs[7], ys[7], zs[7], tilt, -1)
    MCN=gmsh.model.geo.addPoint(xs[8], ys[8], zs[8], tilt, -1)
    MDZ=gmsh.model.geo.addPoint(xs[9], ys[9], zs[9], tilt, -1)
    MEG=gmsh.model.geo.addPoint(xs[10], ys[10], zs[10], tilt, -1)
    MGL=gmsh.model.geo.addPoint(xs[11], ys[11], zs[11], tilt, -1)
    MMT=gmsh.model.geo.addPoint(xs[12], ys[12], zs[12], tilt, -1)
    MNR=gmsh.model.geo.addPoint(xs[13], ys[13], zs[13], tilt, -1)
    MSP=gmsh.model.geo.addPoint(xs[14], ys[14], zs[14], tilt, -1)
    PDN=gmsh.model.geo.addPoint(xs[15], ys[15], zs[15], tilt, -1)
    PLC=gmsh.model.geo.addPoint(xs[16], ys[16], zs[16], tilt, -1)

    # STRAIN  tag = -2 
    DEGI= gmsh.model.geo.addPoint(xs[17], ys[17], zs[17], strain, -2)
    DMSC= gmsh.model.geo.addPoint(xs[18], ys[18], zs[18], strain, -2)
    DPDN= gmsh.model.geo.addPoint(xs[19], ys[19], zs[19], strain -2)
    DRUV= gmsh.model.geo.addPoint(xs[20], ys[20], zs[20], strain, -2)

    #SEISMIC TAG -3
    AIO= gmsh.model.geo.addPoint(xs[21], ys[21], zs[21], seis, -3)
    ECBD= gmsh.model.geo.addPoint(xs[22], ys[22], zs[22], seis, -3)
    ECHR= gmsh.model.geo.addPoint(xs[23], ys[23], zs[23], seis, -3)         
    ECNE= gmsh.model.geo.addPoint(xs[24], ys[24], zs[24], seis, -3)
    ECPN= gmsh.model.geo.addPoint(xs[25], ys[25], zs[25], seis, -3)
    ECTS= gmsh.model.geo.addPoint(xs[26], ys[26], zs[26], seis, -3)
    ECZM= gmsh.model.geo.addPoint(xs[27], ys[27], zs[27], seis, -3)
    EFIU= gmsh.model.geo.addPoint(xs[28], ys[28], zs[28], seis, -3)
    EMAS= gmsh.model.geo.addPoint(xs[29], ys[29], zs[29], seis, -3)
    EMCN= gmsh.model.geo.addPoint(xs[30], ys[30], zs[30], seis, -3)
    EMFO= gmsh.model.geo.addPoint(xs[31], ys[31], zs[31], seis, -3)
    EMFS= gmsh.model.geo.addPoint(xs[32], ys[32], zs[32], seis, -3)
    EMNR= gmsh.model.geo.addPoint(xs[33], ys[33], zs[33], seis, -3)
    EMPL= gmsh.model.geo.addPoint(xs[34], ys[34], zs[34], seis, -3)
    EMSA= gmsh.model.geo.addPoint(xs[35], ys[35], zs[35], seis, -3)
    EMSG= gmsh.model.geo.addPoint(xs[36], ys[36], zs[36], seis, -3)
    ENIC= gmsh.model.geo.addPoint(xs[37], ys[37], zs[37], seis, -3)
    EPDN= gmsh.model.geo.addPoint(xs[38], ys[38], zs[38], seis, -3)
    EPIT= gmsh.model.geo.addPoint(xs[39], ys[39], zs[39], seis, -3)
    EPMN= gmsh.model.geo.addPoint(xs[40], ys[40], zs[40], seis, -3)
    EPOZ= gmsh.model.geo.addPoint(xs[41], ys[41], zs[41], seis, -3)
    EPZF= gmsh.model.geo.addPoint(xs[42], ys[42], zs[42], seis, -3)
    ESAL= gmsh.model.geo.addPoint(xs[43], ys[43], zs[43], seis, -3)
    ESCV= gmsh.model.geo.addPoint(xs[44], ys[44], zs[44], seis, -3)
    ESLN= gmsh.model.geo.addPoint(xs[45], ys[45], zs[45], seis, -3)
    ESML= gmsh.model.geo.addPoint(xs[46], ys[46], zs[46], seis, -3)
    ESPC= gmsh.model.geo.addPoint(xs[47], ys[47], zs[47], seis, -3)
    ESVO= gmsh.model.geo.addPoint(xs[48], ys[48], zs[48], seis, -3)
    EVRN= gmsh.model.geo.addPoint(xs[49], ys[49], zs[49], seis, -3)
    GALF= gmsh.model.geo.addPoint(xs[50], ys[50], zs[50], seis, -3)
    HLNI= gmsh.model.geo.addPoint(xs[51], ys[51], zs[51], seis, -3)
    LIBRI= gmsh.model.geo.addPoint(xs[52], ys[52], zs[52], seis, -3)
    MPNC= gmsh.model.geo.addPoint(xs[53], ys[53], zs[53], seis, -3)
    MSFR= gmsh.model.geo.addPoint(xs[54], ys[54], zs[54], seis, -3)
    MUCR= gmsh.model.geo.addPoint(xs[55], ys[55], zs[55], seis, -3)
    NOV= gmsh.model.geo.addPoint(xs[56], ys[56], zs[56], seis, -3)
    
    #GPS TAG -4 

    ECOR= gmsh.model.geo.addPoint(xs[57], ys[57], zs[57], GPS, -4)
    EPZF_GPS= gmsh.model.geo.addPoint(xs[58], ys[58], zs[58], GPS, -4)
    ESAL_GPS= gmsh.model.geo.addPoint(xs[59], ys[59], zs[59], GPS, -4)
    
    # GNSS TAG -5

    EBAG= gmsh.model.geo.addPoint(xs[60], ys[60], zs[60], GNSS, -5)
    EBDA= gmsh.model.geo.addPoint(xs[61], ys[61], zs[61], GNSS, -5)
    ECHR_GNSS= gmsh.model.geo.addPoint(xs[62], ys[62], zs[62], GNSS, -5)
    ECNE_GNSS= gmsh.model.geo.addPoint(xs[63], ys[63], zs[63], GNSS, -5)
    ECPN_GNSS= gmsh.model.geo.addPoint(xs[64], ys[64], zs[64], GNSS, -5)
    ECRI= gmsh.model.geo.addPoint(xs[65], ys[65], zs[65], GNSS, -5)
    EDAM= gmsh.model.geo.addPoint(xs[66], ys[66], zs[66], GNSS, -5)
    EIIV= gmsh.model.geo.addPoint(xs[67], ys[67], zs[67], GNSS, -5)
    EINT= gmsh.model.geo.addPoint(xs[68], ys[68], zs[68], GNSS, -5)
    ELAC= gmsh.model.geo.addPoint(xs[69], ys[69], zs[69], GNSS, -5)
    ELIN= gmsh.model.geo.addPoint(xs[70], ys[70], zs[70], GNSS, -5)
    EMAL= gmsh.model.geo.addPoint(xs[71], ys[71], zs[71], GNSS, -5)
    EMCN_GNSS= gmsh.model.geo.addPoint(xs[72], ys[72], zs[72], GNSS, -5)
    EMEG= gmsh.model.geo.addPoint(xs[73], ys[73], zs[73], GNSS, -5)
    EMFN= gmsh.model.geo.addPoint(xs[74], ys[74], zs[74], GNSS, -5)
    EMGL= gmsh.model.geo.addPoint(xs[75], ys[75], zs[75], GNSS, -5)
    EMSG_GNSS= gmsh.model.geo.addPoint(xs[76], ys[76], zs[76], GNSS, -5)
    ENIC_GNSS= gmsh.model.geo.addPoint(xs[77], ys[77], zs[77], GNSS, -5)
    EPDN_GNSS= gmsh.model.geo.addPoint(xs[78], ys[78], zs[78], GNSS, -5)
    EPED= gmsh.model.geo.addPoint(xs[79], ys[79], zs[79], GNSS, -5)
    EPLU= gmsh.model.geo.addPoint(xs[80], ys[80], zs[80], GNSS, -5)
    EPOZ_GNSS= gmsh.model.geo.addPoint(xs[81], ys[81], zs[81], GNSS, -5)
    ERIP= gmsh.model.geo.addPoint(xs[82], ys[82], zs[82], GNSS, -5)
    ESCV_GNSS= gmsh.model.geo.addPoint(xs[83], ys[83], zs[83], GNSS, -5)
    ESLN_GNSS= gmsh.model.geo.addPoint(xs[84], ys[84], zs[84], GNSS, -5)
    ESML_GNSS= gmsh.model.geo.addPoint(xs[85], ys[85], zs[85], GNSS, -5)
    ESPC_GNSS= gmsh.model.geo.addPoint(xs[86], ys[86], zs[86], GNSS, -5)
    ETEC= gmsh.model.geo.addPoint(xs[87], ys[87], zs[87], GNSS, -5)
    
 

    points = [CBD,CDP,CDV,DAM,EC10,ECP,MAS,MCN,MDZ,MEG,MGL,MMT,MNR,MSP,PDN,PLC,DEGI,DMSC,DPDN,DRUV,
              AIO,ECBD,ECHR,ECNE,ECPN,ECTS,ECZM,EFIU,EMAS,EMCN,EMFO,EMFS,EMNR,EMPL,EMSA,EMSG,ENIC,
              EPDN,EPIT,EPMN,EPOZ,EPZF,ESAL,ESCV,ESLN,ESML,ESPC,ESVO,EVRN,GALF,HLNI,LIBRI,MPNC,MSFR,
              MUCR,NOV,ECOR,EPZF_GPS,ESAL_GPS,EBAG,EBDA,ECHR_GNSS,ECNE_GNSS,ECPN_GNSS,ECRI,EDAM,EIIV,EINT,ELAC,ELIN,EMAL,EMCN_GNSS,
              EMEG,EMFN,EMGL,EMSG_GNSS,ENIC_GNSS,EPDN_GNSS,EPED,EPLU,EPOZ_GNSS,ERIP,ESCV_GNSS,ESLN_GNSS,ESML_GNSS,ESPC_GNSS,ETEC]


    
    return points              
    
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
    s1 = gmsh.model.geo.addSurfaceFilling([ll1])              #bottom -ve z
        
    ll2 = gmsh.model.geo.addCurveLoop([c5, c6, c7, c8])      
    s2 = gmsh.model.geo.addSurfaceFilling([ll2])              #top +ve z 

    ll3 = gmsh.model.geo.addCurveLoop([c1, c10, -c5, -c9])      
    s3 = gmsh.model.geo.addSurfaceFilling([ll3])              #front -ve y

    ll4 = gmsh.model.geo.addCurveLoop([c7, -c12, -c3, c11])      
    s4 = gmsh.model.geo.addSurfaceFilling([ll4])              #back +ve y

    ll5 = gmsh.model.geo.addCurveLoop([c8, -c9, -c4, c12])      
    s5 = gmsh.model.geo.addSurfaceFilling([ll5])              #left -ve x

    ll6 = gmsh.model.geo.addCurveLoop([c6, -c11, -c2, c10])      
    s6 = gmsh.model.geo.addSurfaceFilling([ll6])              #right +ve x
    
    sl1 = gmsh.model.geo.addSurfaceLoop([s2, s3, s1, s6, s4, s5])
     
    return sl1, s1, s2, s3, s4, s5, s6
   
def execute():
    gmsh.initialize(sys.argv)
    gmsh.option.setNumber("General.NumThreads", os.cpu_count())# for parallel 3D meshing
    print('cpu_count: ', os.cpu_count())
   
    path = os.path.dirname(os.path.abspath(__file__))
    
    gmsh.merge(os.path.join(path, input_file))


    ob_sl, ob_bottom, ob_front, ob_right, ob_back, ob_left, ob_top, c1, c2, c3, c4, p1, p2, p3, p4 = outer_box(h=10000)
    points = elevation_GNSS_stations()
    stations = points
    gmsh.model.geo.synchronize()
    gmsh.model.mesh.embed(0, stations, 2, ob_top)
    gmsh.model.geo.synchronize()

    C_sl,C_s1, C_s2, C_s3, C_s4, C_s5, C_s6,C_s7,C_s8,C_s9, C_s10,C_s11,C_s12,C_s13,C_s14,C_s15,C_s16,C_s17,C_s18,C_s19,C_s20,C_s21,C_s22,C_s23,C_s24,C_s25,C_s26,C_s27,C_s28,C_s29,C_s30,C_s31,C_s32,C_s41,C_s42,C_s43,C_s44,C_s45,C_s46,C_s47,C_s48,C_s49,C_s50,C_s51,C_s52,C_s53,C_s54,C_s55,C_s56  = chambers_3_Etna()
    #E_sl, E_s1, E_s2, E_s3, E_s4, E_s5, E_s6, E_s7, E_s8 = ellipsoid_hole(cx=50000, cy=50000, cz=-5000, rx=3000, ry=3000, rz=1000, h=1000) 
    #B_sl, B_bottom, B_top, B_front, B_back, B_left, B_right = box_hole(cx=50000, cy=50000, cz= 2000, x_l=1000, y_l=1000, z_l=3000, h=100)

    #gmsh.model.geo.synchronize()
    #f1 = gmsh.model.geo.addPoint(50000,50000,2500,50)
    #f2 = gmsh.model.geo.addPoint(50000,49500,2500,50)
    #f3 = gmsh.model.geo.addPoint(50000,49500,2000,100)
    #f4 = gmsh.model.geo.addPoint(50000,50000,2000,100)
    #c401 = gmsh.model.geo.addLine(f1, f2)
    #c402 = gmsh.model.geo.addLine(f2, f3)
    #c403 = gmsh.model.geo.addLine(f3, f4)
    #c404 = gmsh.model.geo.addLine(f4, f1)
    #lineloop = gmsh.model.geo.addCurveLoop([c401,c402,c403,c404])
    #sfault = gmsh.model.geo.addPlaneSurface([lineloop])           
    #surface = gmsh.model.geo.addSurfaceLoop([sfault])
    #f = gmsh.model.geo.addVolume([surface])
    #gmsh.model.addPhysicalGroup(2, [surface], 20)

    #gmsh.model.geo.synchronize()
    #gmsh.model.mesh.embed(0, [f1,f2], 2, ob_top)
    #gmsh.model.geo.synchronize()
    gmsh.option.setNumber("Mesh.MshFileVersion",2.2)   
    gmsh.option.setNumber('Mesh.MeshSizeMin', mesh_min_size)
    gmsh.option.setNumber('Mesh.MeshSizeMax', mesh_max_size)
    gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 40)    

    gmsh.model.mesh.field.add("Ball", 1)
    gmsh.model.mesh.field.setNumber(1, "VIn", 200)
    gmsh.model.mesh.field.setNumber(1, "VOut", 1000)
    gmsh.model.mesh.field.setNumber(1, "XCenter", 50000)
    gmsh.model.mesh.field.setNumber(1, "YCenter", 50000)
    gmsh.model.mesh.field.setNumber(1, "ZCenter", 1000)
    gmsh.model.mesh.field.setNumber(1, "Radius", 10000)
    gmsh.model.mesh.field.setNumber(1, "Thickness", 10000)

    v = gmsh.model.geo.addVolume([ob_sl,C_sl])
    
    gmsh.model.geo.removeAllDuplicates()    
    #gmsh.model.geo.synchronize()   
    gmsh.model.addPhysicalGroup(3, [v], 10)  # volume tag = 10
   # gmsh.model.addPhysicalGroup(2, [E_s1, E_s2, E_s3, E_s4, E_s5, E_s6, E_s7, E_s8], 4)   # hole boundaries tag = 4
    
    gmsh.model.addPhysicalGroup(2, [ob_bottom, ob_front, ob_right, ob_back, ob_left], 5)   # lateral boundaries tag = 5
    gmsh.model.addPhysicalGroup(1, [c1, c2, c3, c4], 5)   # lateral boundaries tag = 5
    gmsh.model.addPhysicalGroup(0, [p1, p2, p3, p4], 5)   # lateral boundaries tag = 5
    gmsh.model.addPhysicalGroup(3, [C_sl,C_s1, C_s2, C_s3, C_s4, C_s5, C_s6,C_s7,C_s8,C_s9, C_s10,C_s11,C_s12,C_s13,C_s14,C_s15,C_s16,C_s17,C_s18,C_s19,C_s20,C_s21,C_s22,C_s23,C_s24,C_s25,C_s26,C_s27,C_s28,C_s29,C_s30,C_s31,C_s32,C_s41,C_s42,C_s43,C_s44,C_s45,C_s46,C_s47,C_s48,C_s49,C_s50,C_s51,C_s52,C_s53,C_s54,C_s55,C_s56], 4)

    gmsh.model.geo.synchronize()

    gmsh.model.mesh.generate(3)
    gmsh.write("Etna_2chambers.stl")
    
    gmsh.logger.get_last_error()
    if '-nopopup' not in sys.argv:
        gmsh.fltk.run()
    gmsh.finalize()

execute()


