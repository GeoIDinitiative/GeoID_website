//SetFactory("OpenCASCADE");
Mesh.MshFileVersion = 2;   


// upper chamber dimensions
cx = 50000;
cy = 50000;
cz = -2000;

lc = 10; //default size
lc_upper = 30;
lc_sides = 10;
lc_if_uc = 1; // size at interface between dyke and upper chamber
rx = 250; 
ry = 250;
rz = 250;

rx_sin1 = 162.3620121; // location of points via trig functions -- gmsh doesn't appear to have these functions built in (change in future?)
ry_cos1 = 190.1014914;


// mid points DYKE 1
dx_mid = 50000;
dy_mid = 50000;
dz_mid = -3500; 
lc_if_mid = 30; 

// 2nd chamber dimensions

cx2 = 50000;
cy2 = 50000;
cz2 = -6800;


r1 = 800; // semi minor axis
r2 = 6000; // semi major axis

lc_sides_c2 = 500;
lc_bottom_c2 = 1000; // size determined by conduit point size

rx_sin2 = 3896.68829;
ry_cos2 = 4562.435794;


// DYKE DIMENSIONS

lc_if_lc = 30; // size at interface between dyke and lower chamber

cx_d = 50000; // centre x,y of dyke
cy_d = 50000;
dx = 5; 
dy = 50;

dz1d = cz - rz; // subtract from central z of upper chamber
dz2d = cz2 + r1; // distance from centre of lower chamber interface to conduit interace

// DYKE 2 

dx3 = 10;
dy3 = 50;


cx_d2 = 50000;
cy_d2 = 50000;
dz3d = cz2 - r1; 


dx2 = 10;
dy2 = 50;

dz_mid2 = -10000; 
lc_if_mid2 = 30; 

lc_upper_c3 =10;
lc_bottom_c3 = 1000;

cx_d2_mid = 50000;
cy_d2_mid = 50000;

lc_if_lc3 = 30; // interface 


// UPPER CHAMBER

Point(1) ={cx, cy, cz, lc};   
Point(2) ={cx, cy-ry, cz, lc_sides};   
Point(3) ={cx+rx_sin1, cy-ry_cos1, cz, lc_sides};//   
Point(4) ={cx+rx, cy, cz, lc_sides};   
Point(5) ={cx+rx_sin1, cy+ry_cos1, cz, lc_sides};//
Point(6) ={cx, cy+ry, cz, lc_sides};   
Point(7) ={cx-rx_sin1, cy+ry_cos1, cz, lc_sides};//   
Point(8) ={cx-rx, cy, cz, lc_sides}; 
Point(9) ={cx-rx_sin1, cy-ry_cos1,cz, lc_sides};//     


Point(10) ={cx, cy, cz+rz, lc_upper}; // top point   
Point(11) ={cx, cy, cz-rz, lc_if_uc};// bottom point

Ellipse(1) = {2,1,6,10};
Ellipse(2) = {3,1,7,10};
Ellipse(3) = {4,1,8,10};
Ellipse(4) = {5,1,9,10};
Ellipse(5) = {6,1,2,10};
Ellipse(6) = {7,1,3,10};
Ellipse(7) = {8,1,4,10};
Ellipse(8) = {9,1,5,10};


//Ellipse(9) ={2,1,2,3};

Ellipse(9) ={2,1,3};
Ellipse(10)={3,1,4};
Ellipse(11)={4,1,5};
Ellipse(12)={5,1,6};
Ellipse(13)={6,1,7};
Ellipse(14)={7,1,8};
Ellipse(15)={8,1,9};
Ellipse(16)={9,1,2};


Curve Loop(1) = {-1,9,2};
Surface(1) = {1};
Curve Loop(2) = {-2,10,3};
Surface(2) = {2};
Curve Loop(3) = {-3,11,4};
Surface(3) = {3};
Curve Loop(4) = {-4,12,5};
Surface(4) = {4};
Curve Loop(5) = {-5,13,6};
Surface(5) = {5};
Curve Loop(6) = {-6,14,7};
Surface(6) = {6};
Curve Loop(7) = {-7,15,8};
Surface(7) = {7};
Curve Loop(8) = {-8,16,1};
Surface(8) = {8};


// DYKE CONNECTION
Point(12) ={cx_d, cy_d-dy, dz1d, lc_if_uc}; 
Point(13) ={cx_d+dx, cy_d-dy, dz1d, lc_if_uc}; 
Point(14) ={cx_d+dx, cy_d, dz1d, lc_if_uc}; 
Point(15) ={cx_d+dx, cy_d+dy, dz1d, lc_if_uc}; 
Point(16) ={cx_d, cy_d+dy, dz1d, lc_if_uc}; 
Point(17) ={cx_d-dx, cy_d+dy, dz1d, lc_if_uc}; 
Point(18) ={cx_d-dx, cy_d, dz1d, lc_if_uc}; 
Point(19) ={cx_d-dx, cy_d-dy, dz1d, lc_if_uc}; 


Ellipse(17) = {2,1,11,12};
Ellipse(18) = {3,1,11,13};
Ellipse(19) = {4,1,11,14};
Ellipse(20) = {5,1,11,15};
Ellipse(21) = {6,1,11,16};
Ellipse(22) = {7,1,11,17};
Ellipse(23) = {8,1,11,18};
Ellipse(24) = {9,1,11,19};

Line(25) = {12,13};
Line(26) = {13,14};
Line(27) = {14,15};
Line(28) = {15,16};
Line(29) = {16,17};
Line(30) = {17,18};
Line(31) = {18,19};
Line(32) = {19,12};

Curve Loop(9) = {9,18,-25,-17}; // structure = side ellipse, +ve descending ellipse, -ve dyke line, -ve descending ellipse
Surface(9) = {9};
Curve Loop(10)={10,19,-26,-18};
Surface(10)={10};
Curve Loop(11)={11,20,-27,-19};
Surface(11)={11};
Curve Loop(12)={12,21,-28,-20};
Surface(12)={12};
Curve Loop(13)={13,22,-29,-21};
Surface(13)={13};
Curve Loop(14)={14,23,-30,-22};
Surface(14)={14};
Curve Loop(15)={15,24,-31,-23};
Surface(15)={15};
Curve Loop(16)={16,17,-32,-24};
Surface(16)={16};

// Mid points -- change of element size to help with mesh control

Point(20) ={dx_mid, dy_mid-dy, dz_mid, lc_if_mid}; 
Point(21) ={dx_mid+dx, dy_mid-dy, dz_mid, lc_if_mid}; 
Point(22) ={dx_mid+dx, dy_mid, dz_mid, lc_if_mid}; 
Point(23) ={dx_mid+dx, dy_mid+dy, dz_mid, lc_if_mid}; 
Point(24) ={dx_mid, dy_mid+dy, dz_mid, lc_if_mid}; 
Point(25) ={dx_mid-dx, dy_mid+dy, dz_mid, lc_if_mid}; 
Point(26) ={dx_mid-dx, dy_mid, dz_mid, lc_if_mid}; 
Point(27) ={dx_mid-dx, dy_mid-dy, dz_mid, lc_if_mid};

// lower conduit 
Point(28) ={cx_d, cy_d-dy, dz2d, lc_if_lc}; 
Point(29) ={cx_d+dx, cy_d-dy, dz2d, lc_if_lc}; 
Point(30) ={cx_d+dx, cy_d, dz2d, lc_if_lc}; 
Point(31) ={cx_d+dx, cy_d+dy, dz2d, lc_if_lc}; 
Point(32) ={cx_d, cy_d+dy, dz2d, lc_if_lc}; 
Point(33) ={cx_d-dx, cy_d+dy, dz2d, lc_if_lc}; 
Point(34) ={cx_d-dx, cy_d, dz2d, lc_if_lc}; 
Point(35) ={cx_d-dx, cy_d-dy, dz2d, lc_if_lc};

// Conduit lines 

// upper corners

Line(33) = {13, 21}; 
Line(34) = {21,29};

Line(35) = {15,23};
Line(36)={23,31};

Line(37)= {17,25};
Line(38)={25,33};

Line(39) = {19,27};
Line(40)={27,35};

// connecting lines in between mid nodes 

Line(41) = {20,21};
Line(42) = {21,22};
Line(43) = {22,23};
Line(44) = {23,24};
Line(45) = {24,25};
Line(46) = {25,26};
Line(47) = {26,27};
Line(48) = {27,20};


// connecting lines at lower conduit-chamber interface 

Line(49) = {28,29};
Line(50) = {29,30};
Line(51) = {30,31};
Line(52) = {31,32};
Line(53) = {32,33};
Line(54) = {33,34};
Line(55) = {34,35};
Line(56) = {35,28};

// boundary side lines 

Line(60) = {12,20};
Line(61) = {20, 28};

Line(62) = {14,22};
Line(63) = {22,30};

Line(64) = {16,24};
Line(65) = {24,32};

Line(66) = {18,26};
Line(67) = {26,34};

// subsectional surfaces 

Line Loop(17)= {25,33,-41,-60};
Surface(17)={17};
Line Loop(18)= {41,34,-49,-61};
Surface(18)={18};

Line Loop(19)= {33,42,-62,-26};
Surface(19)={19};
Line Loop(20)= {42,63,-50,-34};
Surface(20)={20};

Line Loop(21)= {27,35,-43,-62};
Surface(21)={21};
Line Loop(22)= {43,36,-51,-63};
Surface(22)={22};

Line Loop(23)= {28,64,-44,-35};
Surface(23)={23};
Line Loop(24)= {44,65,-52,-36};
Surface(24)={24};

Line Loop(25)= {29,37,-45,-64};
Surface(25)={25};
Line Loop(26)= {45,38,-53,-65};
Surface(26)={26};

Line Loop(27)= {30,66,-46,-37};
Surface(27)={27};
Line Loop(28)= {46,67,-54,-38};
Surface(28)={28};

Line Loop(29)= {31,39,-47,-66};
Surface(29)={29};
Line Loop(30)= {47,40,-55,-67};
Surface(30)={30};

Line Loop(31)= {32,60,-48,-39};
Surface(31)={31};
Line Loop(32)= {48,61,-56,-40};
Surface(32)={32};

// 2nd chamber 

Point(41) ={cx2, cy2, cz2, lc};   
Point(42) ={cx2, cy2-r2, cz2, lc_sides_c2};   
Point(43) ={cx2+rx_sin2, cy2-ry_cos2, cz2, lc_sides_c2};//   
Point(44) ={cx2+r2, cy2, cz2, lc_sides_c2};   
Point(45) ={cx2+rx_sin2, cy+ry_cos2, cz2, lc_sides_c2};//
Point(46) ={cx2, cy+r2, cz2, lc_sides_c2};   
Point(47) ={cx2-rx_sin2, cy2+ry_cos2, cz2, lc_sides_c2};//   
Point(48) ={cx2-r2, cy2, cz2, lc_sides_c2}; 
Point(49) ={cx2-rx_sin2, cy2-ry_cos2,cz2, lc_sides_c2};//     


Point(50) ={cx2, cy2, cz2+r1, lc_upper}; // top point   
Point(51) ={cx2, cy2, cz2-r1, lc_bottom_c2};// bottom point

//top
Ellipse(71) = {42,41,50,28};
Ellipse(72) = {43,41,50,29};
Ellipse(73) = {44,41,50,30};
Ellipse(74) = {45,41,50,31};
Ellipse(75) = {46,41,50,32};
Ellipse(76) = {47,41,50,33};
Ellipse(77) = {48,41,50,34};
Ellipse(78) = {49,41,50,35};


//sides
Ellipse(79) = {42,41,43}; 
Ellipse(80) = {43,41,44};
Ellipse(81) = {44,41,45};
Ellipse(82) = {45,41,46};
Ellipse(83) = {46,41,47};
Ellipse(84) = {47,41,48};
Ellipse(85) = {48,41,49};
Ellipse(86) = {49,41,42};



//top surfaces 

Curve Loop(41) = {71,49,-72,-79};
Surface(41) = {41};
Curve Loop(42) = {72,50,-73,-80};
Surface(42) = {42};
Curve Loop(43) = {73,51,-74,-81};
Surface(43) = {43};
Curve Loop(44) = {74,52,-75,-82};
Surface(44) = {44};
Curve Loop(45) = {75,53,-76,-83};
Surface(45) = {45};
Curve Loop(46) = {76,54,-77,-84};
Surface(46) = {46};
Curve Loop(47) = {77,55,-78,-85};
Surface(47) = {47};
Curve Loop(48) = {78,56,-71,-86};
Surface(48) = {48};


// DYKE #2 (2ND --> 3RD CHAMBER)

Point(62) ={cx_d2, cy_d2-dy2, dz3d, lc_if_uc}; 
Point(63) ={cx_d2+dx2, cy_d2-dy2, dz3d, lc_if_uc}; 
Point(64) ={cx_d2+dx2, cy_d2, dz3d, lc_if_uc}; 
Point(65) ={cx_d2+dx2, cy_d2+dy2, dz3d, lc_if_uc}; 
Point(66) ={cx_d2, cy_d2+dy2, dz3d, lc_if_uc}; 
Point(67) ={cx_d2-dx2, cy_d2+dy2, dz3d, lc_if_uc}; 
Point(68) ={cx_d2-dx2, cy_d2, dz3d, lc_if_uc}; 
Point(69) ={cx_d2-dx2, cy_d2-dy2, dz3d, lc_if_uc}; 

//bottom 

Ellipse(87) = {42,41,51,62};
Ellipse(88) = {43,41,51,63};
Ellipse(89) = {44,41,51,64};
Ellipse(90) = {45,41,51,65};
Ellipse(91) = {46,41,51,66};
Ellipse(92) = {47,41,51,67};
Ellipse(93) = {48,41,51,68};
Ellipse(94) = {49,41,51,69};

Line(100) = {62,63};
Line(101) = {63,64};
Line(102) = {64,65};
Line(103) = {65,66};
Line(104) = {66,67};
Line(105) = {67,68};
Line(106) = {68,69};
Line(107) = {69,62};

Curve Loop(49) = {79,88,-100,-87};
Surface(49) = {49};
Curve Loop(50) = {80,89,-101,-88};
Surface(50) = {50};
Curve Loop(51) = {81,90,-102,-89};
Surface(51) = {51};
Curve Loop(52) = {82,91,-103,-90};
Surface(52) = {52};
Curve Loop(53) = {83,92,-104,-91};
Surface(53) = {53};
Curve Loop(54) = {84,93,-105,-92};
Surface(54) = {54};
Curve Loop(55) = {85,94,-106,-93};
Surface(55) = {55};
Curve Loop(56) = {86,87,-107,-94};
Surface(56) = {56};
// add surface here for conduit with 2 chambers only.

Surface Loop(100) ={1:32, 41:56};

// BOX 

Point(110) = {0,0,2000};
Point(111)= {100000,0,2000};
Point(112) = {100000,100000,2000};
Point(113) = {0,100000,2000};
Point(114) = {0,0,-25000};
Point(115)= {100000, 0, -25000};
Point(116) = {100000, 100000, -25000};
Point(117)={0, 100000, -25000};

Line(1001)= {110,111};
Line(1002) = {111,112};
Line(1003)={112,113};
Line(1004)={113,110};

Line(1005)= {110,114};
Line(1006) = {111,115};
Line(1007)={112,116};
Line(1008)={113,117};

Line(1009)= {114,115};
Line(1010) = {115,116};
Line(1011)={116,117};
Line(1012)={117, 114};

Curve Loop(90)={1001,1002,1003,1004};
Plane Surface(90)={90};
Curve Loop(91)={1001,1006,-1009,-1005};
Plane Surface(91)={91};
Curve Loop(92)={1002,1007,-1010,-1006};
Plane Surface(92)={92};
Curve Loop(93)={1003,1008,-1011,-1007};
Plane Surface(93)={93};
Curve Loop(94)={1004,1005,-1012,-1008};
Plane Surface(94)={94};

Curve Loop(95)={1009,1010,1011,1012};
Plane Surface(95)={95};

Surface Loop(99) = {90:95};
//Volume(1) ={100}; fluid 
Volume(3) ={100,99};//solid
