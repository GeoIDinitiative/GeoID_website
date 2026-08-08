/**
 * One line per page saying what it is for.
 *
 * Every Qt page opens with a `PageHeader(title, subtitle)`; without it a page
 * starts mid-thought, which is what made the hub read as a pile of forms. Held
 * as data and rendered by the hub so all sixty-four get one, rather than
 * sixty-four modules each remembering to.
 *
 * A page that draws its own header (because it needs a status pill, or a
 * different title from its tab name) sets `ownHeader` on its mount function and
 * is skipped here.
 *
 * Wording follows the Qt page's own description where it has one.
 */
export const PAGE_BLURBS = {
  // Dashboard
  "Dashboard": "The project you are in, the facets it reaches, and the way across to each.",
  "Pipeline Runner": "Run the project's saved pipeline stage by stage, with a log of what happened.",

  // Project Manager
  "Project Board": "Next actions, risks and decisions as a board — the planner in columns.",
  "Research Notes": "Markdown notes kept in the project's notes/ folder.",
  "Project Comparison": "Every project side by side: phase, study area and how much each holds.",

  // Data Puller
  "Ingest Generic Import": "Bring any tabular or spatial file into the project and register it.",
  "Ingest Land Use": "Land cover and land-use datasets, filed and registered.",
  "Ingest Hydrology": "River networks, catchments, gauges and discharge records.",
  "Ingest Coast Marine": "Coastlines, bathymetry, tides and marine boundaries.",
  "Ingest Geology": "Bedrock and surficial geology, faults and boreholes.",
  "Ingest Seismic Geophysics": "Earthquake catalogues, station metadata and geophysical surveys.",
  "Ingest Volcano Monitoring": "Eruption records, deformation, gas and thermal monitoring series.",
  "Ingest Terrain Elevation": "DEMs and derived terrain: slope, aspect, curvature.",
  "Ingest Weather Climate": "Station and reanalysis weather, and climate normals.",
  "Ingest Remote Sensing": "Optical, SAR and thermal imagery, and the indices derived from them.",
  "Ingest Admin Infrastructure": "Administrative boundaries, population and built infrastructure.",
  "Metadata & Lineage": "Where every file came from, and what has been done to it since.",

  // AI trainer
  "AI Trainer": "Fit a model to a project table and keep the metrics beside it.",
  "Feature Engineering": "Derive columns worth training on, and record how they were made.",
  "Workflow Automation": "Chain steps into a repeatable job the project can re-run.",
  "Notebook": "A scratch pad for expressions over the project's own data.",

  // Preprocessing
  "Preprocessing Transforms": "Resample, detrend, filter and rescale a series before it is analysed.",
  "XYZ to STL": "Turn a point cloud into a surface mesh.",
  "Temporal Tools": "Regularise a time base: gaps, duplicates, resampling and alignment.",
  "Raster Tools": "Raster algebra, reprojection, clipping and terrain derivatives.",
  "Vector Tools": "Buffers, clips, joins and geometry repair on vector layers.",
  "CSV Plotter": "The quickest look at any table in the project.",
  "Mesh": "Build and refine the mesh a simulation will run on.",
  "Inputs": "The input files a run needs, gathered and checked.",

  // FEM model
  "Import / Clone": "Start from an existing run rather than a blank one.",
  "Build New": "Define a new run from geometry, mesh and materials.",
  "Setup": "The run's solver, timestepping and outputs.",
  "Properties": "Material and constitutive properties for each region.",
  "IC/BC": "Initial and boundary conditions.",
  "Run Existing": "Queue a run that is already specified.",
  "Simulation": "What the solver is doing, and what it has written back.",
  "DOF Wizard": "Choose the degrees of freedom to extract, and where to probe them.",

  // Analysis
  "Post Processing": "Turn FEM results into probe time series the analysis pages can read.",
  "Signal Processing": "Filter, detrend and resample a series.",
  "Spectral Analysis": "Its frequency content: spectra, spectrograms and coherence.",
  "Multi-Station Viewer": "Several stations at once, aligned on one time base.",
  "Model Fitting": "Fit a function to a series and keep the residuals.",
  "Event Detection": "Find events in a series by threshold, energy or rate of change.",
  "Equation Workbench": "Evaluate expressions over the project's columns.",
  "Statistics": "Descriptive statistics, distributions and correlations.",
  "EDA Report": "A first pass over a whole table, as a saved figure set.",
  "Event Annotation": "Mark and label events by hand, and keep the labels with the data.",
  "Point Cloud 3D": "Look at a point cloud in three dimensions.",
  "FEM 3D Viewer": "Look at a mesh and its results in three dimensions.",
  "Live Monitor": "Watch a series update while it is being written.",

  // GIS Explorer
  "GIS Explorer": "The globe: import, drape, draw and measure.",
  "Map": "A flat map of the project's layers.",

  // Pipeline / Data Hub
  "Pipeline Editor": "The ordered plan of what this project does, saved with it.",
  "Data Hub": "Datasets shared across projects, and what depends on them.",

  // StoryBoard
  "Storyboard": "Assemble figures and text into the shape of a paper.",
  "Figure Composer": "Every figure the project has produced, with its caption.",

  // Settings
  "Settings": "How the hub behaves, and where it keeps things.",
  "Plugin Manager": "Extra pages and tools registered into the hub.",
  "Module Builder": "Scaffold a new page against the registry.",
};
