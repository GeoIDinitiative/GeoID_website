Mesh.MshFileVersion = 2;


lc1 = 50;
lc2 = 5;
lc3 = 0.5;
lc4 = 1;

x = 50000;
d = -2000;
rx = 250;
ry = 250;
ds = 5;

//upper chamber
Point(0) = {x,d+ry,0,lc2};
Point(1) = {x-rx,d,0,lc2};
Point(2) = {x+rx,d,0,lc2};
Point(3) = {x,d,0,lc2};
Point(5) = {x+ds,d-ry,0,lc3};
Point(6) = {x-ds,d-ry,0,lc3};

Ellipse(1) = {1, 3, 2, 6};
Ellipse(2) = {1, 3, 2, 0};
Ellipse(3) = {2, 3, 1, 0};
Ellipse(4) = {2, 3, 1, 5};


//Rotate {{0, 0, 1}, {x, d, 0}, Pi/180*-25} {
//  Curve{1:4};}

//bottom chamber

x2 = 50000;
d2 = -6800;
rx2 = 6000;
ry2 = 800;
ds2 = 5;

Point(7) = {x-ds2,d2+ry2,0,lc4};
Point(8) = {x+ds2,d2+ry2,0,lc4};
Point(10) = {x+rx2,d2,0,lc1};
Point(11) = {x-rx2,d2,0,lc1};
Point(12) = {x,d2-ry2,0,lc1};
Point(13) = {x,d2,0,lc1};




Line(5) = {5, 8};
Line(6) = {7, 6};
Ellipse(7) = {11, 13, 10, 12};
Ellipse(8) = {10, 13, 11, 12};
Ellipse(9) = {10, 13, 11, 8};
Ellipse(10) = {11, 13, 10, 7};
Curve Loop(1) = -{5, -9, 8, -7, 10, 6, -1, 2, -3, 4};
Plane Surface(1) = {1};
Physical Surface(0) = {1};
Physical Curve(5) = {7, 8, 9, 10, 5, 6, 4, 3, 2, 1};

