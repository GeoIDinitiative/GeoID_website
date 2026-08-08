/**
 * The Data Puller's source catalogue.
 *
 * Ported verbatim from the Qt app's `ingest_domain_specs` (app_qt.py:24961):
 * eleven domains, each with its providers, the source groups they offer and the
 * actions to reach them. Held as data for the same reason the stage list is --
 * so the two front ends cannot disagree about what a domain contains, and so
 * adding a provider is an edit here rather than a new page.
 *
 * A Qt `filter` string ("Vector (*.shp *.gpkg);;All files (*.*)") is translated
 * to an `accept` attribute at render time; the filters are kept in their
 * original form so a diff against the Qt source stays readable.
 */
export const INGEST_DOMAINS = {
  "Ingest Generic Import": {
    "subtitle": "Bring in custom raster, vector, tabular, database, and service-backed datasets.",
    "slug": "generic_import",
    "providers": [
      {
        "name": "Local Files",
        "description": "Import local files directly into the project ingest area.",
        "source_groups": [
          {
            "title": "Supported",
            "entries": [
              "Raster: GeoTIFF, NetCDF, GRIB, HDF",
              "Vector: Shapefile, GeoPackage, GeoJSON, KML",
              "Tables: CSV, TSV, TXT, Excel",
              "3D: LAS, LAZ, OBJ, PLY"
            ]
          }
        ],
        "actions": [
          {
            "label": "Import Files",
            "kind": "import_files",
            "filter": "*.*"
          },
          {
            "label": "Import Folder",
            "kind": "import_dir"
          }
        ]
      },
      {
        "name": "Databases and Services",
        "description": "Launch remote connectors and then import downloaded extracts or exports.",
        "source_groups": [
          {
            "title": "Connectors",
            "entries": [
              "PostGIS / SpatiaLite exports",
              "STAC catalogs",
              "WMS / WFS / WMTS services",
              "Cloud buckets and HTTPS endpoints"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open STAC Browser",
            "kind": "url",
            "url": "https://radiantearth.github.io/stac-browser/"
          },
          {
            "label": "Import Service Export",
            "kind": "import_files",
            "filter": "*.*"
          }
        ]
      }
    ]
  },
  "Ingest Land Use": {
    "subtitle": "Collect land cover, land use, zoning, and change layers.",
    "slug": "land_use",
    "providers": [
      {
        "name": "CORINE / Copernicus",
        "description": "European land cover and land use products including CORINE and high-resolution layers.",
        "source_groups": [
          {
            "title": "Products",
            "entries": [
              "CORINE Land Cover",
              "CLC change layers",
              "Copernicus High Resolution Layers",
              "Imperviousness and forest products"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open Copernicus Land Portal",
            "kind": "url",
            "url": "https://land.copernicus.eu/"
          },
          {
            "label": "Import Land Use Files",
            "kind": "import_files",
            "filter": "Vector/Raster (*.shp *.gpkg *.geojson *.tif *.tiff *.nc);;All files (*.*)"
          }
        ]
      },
      {
        "name": "Global Land Cover",
        "description": "Global land cover alternatives for areas outside CORINE coverage.",
        "source_groups": [
          {
            "title": "Products",
            "entries": [
              "ESA WorldCover",
              "Dynamic World",
              "MODIS land cover",
              "Local zoning layers"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open ESA WorldCover",
            "kind": "url",
            "url": "https://esa-worldcover.org/"
          },
          {
            "label": "Import Global Cover Files",
            "kind": "import_files",
            "filter": "Raster/Vector (*.tif *.tiff *.shp *.gpkg *.geojson);;All files (*.*)"
          }
        ]
      }
    ]
  },
  "Ingest Hydrology": {
    "subtitle": "Collect river, watershed, flood, and hydrometric datasets.",
    "slug": "hydrology",
    "providers": [
      {
        "name": "Rivers and Catchments",
        "description": "River centerlines, catchments, lakes, wetlands, and river-network attributes.",
        "source_groups": [
          {
            "title": "Vector Layers",
            "entries": [
              "River and stream centerlines",
              "Catchments and watersheds",
              "Lakes and reservoirs",
              "Wetlands and floodplains"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open HydroSHEDS",
            "kind": "url",
            "url": "https://www.hydrosheds.org/"
          },
          {
            "label": "Import Hydrology Layers",
            "kind": "import_files",
            "filter": "Vector (*.shp *.gpkg *.geojson *.zip);;All files (*.*)"
          }
        ]
      },
      {
        "name": "Stations and Flood",
        "description": "Gauge stations, flood hazard extents, and observed hydrologic records.",
        "source_groups": [
          {
            "title": "Monitoring",
            "entries": [
              "Gauging stations",
              "Stage / discharge series",
              "Flood hazard extents",
              "Event footprints"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open Flood Map Catalog",
            "kind": "url",
            "url": "https://global-flood.emergency.copernicus.eu/"
          },
          {
            "label": "Import Station Data",
            "kind": "import_files",
            "filter": "Tables/Vector (*.csv *.tsv *.xlsx *.shp *.gpkg *.geojson);;All files (*.*)"
          }
        ]
      }
    ]
  },
  "Ingest Coast Marine": {
    "subtitle": "Collect coastline, shoreline change, bathymetry, and marine boundary datasets.",
    "slug": "coast_marine",
    "providers": [
      {
        "name": "Coastlines and Shorelines",
        "description": "Reference coastlines, shoreline change products, and coastal hazard boundaries.",
        "source_groups": [
          {
            "title": "Coastal Layers",
            "entries": [
              "Coastline shapefiles",
              "Shoreline change vectors",
              "Coastal hazard zones",
              "Marine protected areas"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open Natural Earth Coastline",
            "kind": "url",
            "url": "https://www.naturalearthdata.com/"
          },
          {
            "label": "Import Coast Files",
            "kind": "import_files",
            "filter": "Vector (*.shp *.gpkg *.geojson *.zip);;All files (*.*)"
          }
        ]
      },
      {
        "name": "Bathymetry and Sea Level",
        "description": "Bathymetry grids, tides, and sea-level observations for coastal analysis.",
        "source_groups": [
          {
            "title": "Marine Products",
            "entries": [
              "Bathymetry rasters",
              "Tide gauges",
              "Sea-level time series",
              "Nearshore terrain products"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open GEBCO",
            "kind": "url",
            "url": "https://www.gebco.net/"
          },
          {
            "label": "Import Marine Grids",
            "kind": "import_files",
            "filter": "Raster/Tables (*.tif *.tiff *.nc *.csv *.txt);;All files (*.*)"
          }
        ]
      }
    ]
  },
  "Ingest Geology": {
    "subtitle": "Collect bedrock, superficial deposits, faults, soils, and stratigraphic context.",
    "slug": "geology",
    "providers": [
      {
        "name": "Bedrock and Superficial",
        "description": "Core geology layers for bedrock, surficial units, and quaternary deposits.",
        "source_groups": [
          {
            "title": "Geology Layers",
            "entries": [
              "Bedrock geology",
              "Superficial deposits",
              "Quaternary maps",
              "Regolith and soils"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open OneGeology",
            "kind": "url",
            "url": "https://www.onegeology.org/"
          },
          {
            "label": "Import Geology Files",
            "kind": "import_files",
            "filter": "Vector/Raster (*.shp *.gpkg *.geojson *.tif *.tiff);;All files (*.*)"
          }
        ]
      },
      {
        "name": "Structures and Boreholes",
        "description": "Fault traces, lineaments, landslide inventories, boreholes, and stratigraphy logs.",
        "source_groups": [
          {
            "title": "Structural Data",
            "entries": [
              "Faults and fractures",
              "Lineaments",
              "Landslide inventories",
              "Boreholes and stratigraphy tables"
            ]
          }
        ],
        "actions": [
          {
            "label": "Import Structural Data",
            "kind": "import_files",
            "filter": "Vector/Tables (*.shp *.gpkg *.geojson *.csv *.xlsx);;All files (*.*)"
          }
        ]
      }
    ]
  },
  "Ingest Seismic Geophysics": {
    "subtitle": "Collect earthquake catalogs, waveform data, station metadata, and deformation products.",
    "slug": "seismic_geophysics",
    "providers": [
      {
        "name": "Earthquakes and Stations",
        "description": "Catalogs, station metadata, focal mechanisms, and waveform archives.",
        "source_groups": [
          {
            "title": "Seismic Sources",
            "entries": [
              "Earthquake catalogs",
              "Seismic station metadata",
              "Waveform time series",
              "Focal mechanisms"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open IRIS",
            "kind": "url",
            "url": "https://www.iris.edu/hq/"
          },
          {
            "label": "Import Seismic Files",
            "kind": "import_files",
            "filter": "Seismic/Tables (*.mseed *.sac *.csv *.txt *.xml);;All files (*.*)"
          }
        ]
      },
      {
        "name": "Deformation and Geodesy",
        "description": "Ground deformation products including GNSS and InSAR derivatives.",
        "source_groups": [
          {
            "title": "Deformation",
            "entries": [
              "GNSS displacement",
              "InSAR rasters",
              "Velocity fields",
              "Ground deformation summaries"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open UNAVCO",
            "kind": "url",
            "url": "https://www.unavco.org/"
          },
          {
            "label": "Import Deformation Data",
            "kind": "import_files",
            "filter": "Raster/Tables/Vector (*.tif *.tiff *.csv *.txt *.shp *.gpkg *.geojson);;All files (*.*)"
          }
        ]
      }
    ]
  },
  "Ingest Volcano Monitoring": {
    "subtitle": "Collect volcano observatory streams such as tilt, seismicity, gas, thermal, and eruptive outlines.",
    "slug": "volcano_monitoring",
    "providers": [
      {
        "name": "Tilt and Deformation",
        "description": "Tiltmeter, GNSS, and deformation products for volcanic unrest tracking.",
        "source_groups": [
          {
            "title": "Monitoring Streams",
            "entries": [
              "Volcanic tilt data",
              "GNSS displacement",
              "Crater deformation",
              "InSAR snapshots"
            ]
          }
        ],
        "actions": [
          {
            "label": "Import Tilt Data",
            "kind": "import_files",
            "filter": "Tables (*.csv *.tsv *.txt *.xlsx *.json);;All files (*.*)"
          },
          {
            "label": "Import Deformation Folder",
            "kind": "import_dir"
          }
        ]
      },
      {
        "name": "Seismic, Gas, Thermal",
        "description": "Additional volcano observatory products for multiparameter monitoring.",
        "source_groups": [
          {
            "title": "Observatory Products",
            "entries": [
              "Volcanic seismic data",
              "Gas emissions",
              "Thermal imagery",
              "Eruption event catalogs"
            ]
          }
        ],
        "actions": [
          {
            "label": "Import Observatory Files",
            "kind": "import_files",
            "filter": "*.*"
          }
        ]
      }
    ]
  },
  "Ingest Terrain Elevation": {
    "subtitle": "Collect DEM, DSM, contours, LiDAR, and terrain derivative products.",
    "slug": "terrain_elevation",
    "providers": [
      {
        "name": "DEM and Terrain",
        "description": "DEM/DSM/DTM sources and terrain derivatives.",
        "source_groups": [
          {
            "title": "Terrain Products",
            "entries": [
              "DEM / DSM / DTM",
              "Contours",
              "Hillshade and roughness",
              "Slope and aspect"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open Copernicus DEM",
            "kind": "url",
            "url": "https://dataspace.copernicus.eu/"
          },
          {
            "label": "Import Terrain Files",
            "kind": "import_files",
            "filter": "Raster/Vector (*.tif *.tiff *.asc *.img *.shp *.gpkg *.geojson);;All files (*.*)"
          }
        ]
      },
      {
        "name": "LiDAR and Point Clouds",
        "description": "LiDAR tiles and point clouds used for high-resolution elevation products.",
        "source_groups": [
          {
            "title": "Point Clouds",
            "entries": [
              "LAS/LAZ point clouds",
              "Classified point clouds",
              "TIN inputs",
              "Surface meshes"
            ]
          }
        ],
        "actions": [
          {
            "label": "Import LiDAR Files",
            "kind": "import_files",
            "filter": "Point cloud (*.las *.laz *.ply *.obj);;All files (*.*)"
          }
        ]
      }
    ]
  },
  "Ingest Weather Climate": {
    "subtitle": "Collect forecasts, precipitation, radar, station data, and climate reanalysis.",
    "slug": "weather_climate",
    "providers": [
      {
        "name": "Forecast and Radar",
        "description": "Operational weather datasets including forecast grids and radar composites.",
        "source_groups": [
          {
            "title": "Operational Weather",
            "entries": [
              "NOAA GFS",
              "Radar composites",
              "Near-real-time precipitation",
              "Nowcasting feeds"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open NOAA GFS Script Folder",
            "kind": "url",
            "url": "file:///home/owen/GeoID/input/weather%20data/NOAA%20GFS/"
          },
          {
            "label": "Import Weather Files",
            "kind": "import_files",
            "filter": "Raster/Tables (*.grib *.grb *.nc *.csv *.txt *.json *.tif *.tiff);;All files (*.*)"
          }
        ]
      },
      {
        "name": "Climate and Stations",
        "description": "Station observations, climate normals, and reanalysis archives.",
        "source_groups": [
          {
            "title": "Climate Products",
            "entries": [
              "Station observations",
              "Climate normals",
              "IMERG precipitation",
              "Reanalysis archives"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open NASA GES DISC",
            "kind": "url",
            "url": "https://disc.gsfc.nasa.gov/"
          },
          {
            "label": "Import Climate Files",
            "kind": "import_files",
            "filter": "Raster/Tables (*.nc *.csv *.txt *.json *.grib *.grb *.tif *.tiff);;All files (*.*)"
          }
        ]
      }
    ]
  },
  "Ingest Remote Sensing": {
    "subtitle": "Collect optical, SAR, multispectral, and thermal imagery products.",
    "slug": "remote_sensing",
    "providers": [
      {
        "name": "Optical and Multispectral",
        "description": "Satellite imagery for land cover, surface condition, and change detection workflows.",
        "source_groups": [
          {
            "title": "Imagery",
            "entries": [
              "Sentinel-2",
              "Landsat",
              "Multispectral products",
              "Vegetation index derivatives"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open Copernicus Browser",
            "kind": "url",
            "url": "https://browser.dataspace.copernicus.eu/"
          },
          {
            "label": "Import Optical Files",
            "kind": "import_files",
            "filter": "Raster (*.tif *.tiff *.jp2 *.nc);;All files (*.*)"
          }
        ]
      },
      {
        "name": "SAR and Thermal",
        "description": "Radar, interferometric, and thermal remote sensing products.",
        "source_groups": [
          {
            "title": "Products",
            "entries": [
              "Sentinel-1 SAR",
              "InSAR derivatives",
              "Thermal imagery",
              "Change detection rasters"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open ASF Vertex",
            "kind": "url",
            "url": "https://search.asf.alaska.edu/"
          },
          {
            "label": "Import SAR Files",
            "kind": "import_files",
            "filter": "Raster (*.tif *.tiff *.nc *.h5 *.zip);;All files (*.*)"
          }
        ]
      }
    ]
  },
  "Ingest Admin Infrastructure": {
    "subtitle": "Collect administrative boundaries, roads, buildings, parcels, and population/context layers.",
    "slug": "admin_infrastructure",
    "providers": [
      {
        "name": "Boundaries and Places",
        "description": "Administrative boundaries, place names, gazetteers, and census context layers.",
        "source_groups": [
          {
            "title": "Reference Layers",
            "entries": [
              "Administrative boundaries",
              "Place names",
              "Population grids",
              "Census / statistical units"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open Natural Earth",
            "kind": "url",
            "url": "https://www.naturalearthdata.com/"
          },
          {
            "label": "Import Boundary Files",
            "kind": "import_files",
            "filter": "Vector/Tables (*.shp *.gpkg *.geojson *.csv *.zip);;All files (*.*)"
          }
        ]
      },
      {
        "name": "Infrastructure and Cadastre",
        "description": "Roads, rail, buildings, parcels, and other built-environment context layers.",
        "source_groups": [
          {
            "title": "Infrastructure",
            "entries": [
              "Roads and rail",
              "Buildings",
              "Parcels / cadastre",
              "Utilities and facilities"
            ]
          }
        ],
        "actions": [
          {
            "label": "Open OpenStreetMap Export",
            "kind": "url",
            "url": "https://download.geofabrik.de/"
          },
          {
            "label": "Import Infrastructure Files",
            "kind": "import_files",
            "filter": "Vector (*.shp *.gpkg *.geojson *.pbf *.zip);;All files (*.*)"
          }
        ]
      }
    ]
  }
};

/** The Qt filter string as an <input accept> value. */
export function filterToAccept(filter) {
  if (!filter) return "";
  const extensions = new Set();
  // Every *.ext in the string, from every group; the browser has no notion of
  // named filter groups, so they collapse into one accept list.
  String(filter).replace(/\*\.([A-Za-z0-9]+)/g, (_, ext) => {
    if (ext !== "*") extensions.add(`.${ext.toLowerCase()}`);
    return "";
  });
  return [...extensions].join(",");
}
