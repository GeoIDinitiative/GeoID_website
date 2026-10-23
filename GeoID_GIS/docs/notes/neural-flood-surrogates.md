# Can neural networks replace fluid simulations for flood (and similar) hazards?

Research note, 2026-10-23. This is an exploration, not an implementation, and
no code was changed. Every claim about the literature links to the paper that
makes it. Speed-ups and errors are **the authors' reported figures on their own
test cases**; none was reproduced here. Figures marked *(estimate)* are my own
order-of-magnitude arithmetic and are labelled where they appear.

## TL;DR

- **Verdict.** A neural network can *replace* a hydrodynamic model for one
  narrow job: answering many queries (max depth or extent) **at a site, or over
  a family of sites, whose forcing space it was trained on**. Within that space,
  published emulators run 10²–10⁵× faster at errors of a few cm to a few dm.
  Outside it (new terrain types, rainfall beyond the training set, defence
  failures, dam breaks, or any number with legal weight) a network should only
  *accelerate* a physics model: emulate an ensemble, upskill a cheap model,
  screen scenarios. It should never be the last word.
- **GeoHUB runs no fluid simulation today.** Its flood products are a static
  stage-and-connectivity model (`inundation.js`), a linear-reservoir routing
  cascade (`flood-fos.js`), an SCS curve-number time–area hydrograph
  (`catchment.js`) and a weighted-overlay susceptibility map (`ni-flood.js`).
  An emulator trained on "the app's own runs" would only learn to reproduce
  those runs, and they already take 0.5–5 s. **The missing piece is a 2D
  hydraulic reference, not a network.**
- **Recommendation, sized below.** (1) Add a local-inertial 2D shallow-water
  solver as the reference, offline in the sidecar first, using LISFLOOD-FP
  under GPL. (2) Validate the static model against it and against published
  flood maps for Wales and England. (3) Only then train a small U-Net, about
  2–8 M parameters and 4–16 MB at fp16, that predicts the **correction** to
  `inundation.js`'s depth from DEM-derived inputs. It runs in the browser
  through ONNX Runtime Web/WebGPU and refuses to answer outside its training
  envelope. Its cost is roughly 500–1,500 reference simulations and a few
  GPU-hours of training.

**Correction to the brief.** The South Wales AUC 0.841 belongs to the
**landslide** susceptibility recipe (1,242 BGS inventoried slides). The NI
flood susceptibility map was never validated against flood outlines
(`GeoID_GIS/docs/ni-prototype/acceptance-report.md`, "Honest limits"). No
GeoHUB flood product has a skill score yet. That bears on step 2 below.

---

## 1. What GeoHUB does for floods today

Sources: `docs/notes/hazards.md` (sections "River corridor zones",
"River flood inundation", "River flood by discharge", "The flood is the slope
model's other half", "Watershed and runoff"), `docs/ni-prototype/`.

| Product | Model | Physics it has | Physics it lacks |
| --- | --- | --- | --- |
| River flood inundation (`inundation.js`) | Stage `rise = D(W)((Q/Q̄)^0.4 − 1)` from GRWL width via Moody & Troutman; flooded ⇔ below river level + rise and joined to the channel; defences inferred from ground below the river's surface | Hydraulic geometry, connectivity, a defence heuristic | Momentum, storage and attenuation, flow paths across the floodplain, time |
| River flood by discharge | Same model for one traced river at a user-set Q | as above | as above |
| Flood FoS (`flood-fos.js`) | Rain is partitioned into Horton and Dunne runoff, routed by a linear-reservoir cascade on MFD topology; FoS = Q_bankfull/Q | Mass-conserving routing (pinned in tests), lag | Out-of-bank hydraulics; a "stage" comes from the static model |
| Watershed and runoff (`catchment.js`) | SCS-CN and a time–area hydrograph, TR-55 velocities | Volume (checked to 0.15 %) | Routing (linear, unrouted, and the panel says so) |
| NI flood susceptibility (`ni-flood.js`) | Weighted overlay: river proximity, deposits, rainfall, HAND | None (index) | Everything hydraulic; not validated |
| Storm-surge screen (`total-risk.js`) | Inverse barometer plus wind set-up on a typical shelf | Steady set-up | Bathymetry, tide, inundation |

The house style is relevant. Every model states its assumptions in the
drawer. Mass conservation and Δt-independence are pinned by tests
(`flood-fos.test.mjs`). Numbers are checked against a source before a model
rests on them. Products are labelled "screening" where they are. A neural
emulator has to meet the same bar, so it must carry a validation score, an
envelope and a fallback.

## 2. The model families, and what each has shown

### 2.1 CNN / U-Net image-to-image emulators (max depth maps)

The most mature family. It treats "DEM + forcing → max depth" as image
translation.

- **Guo et al. 2021**, *J. Flood Risk Manag.* 14(1)
  ([arXiv 2004.08340](https://arxiv.org/abs/2004.08340)). A CNN was trained on
  18 design hyetographs over 3 urban catchments. It produced max-depth maps in
  about 0.5 % of the physics model's time, with "reasonable" accuracy on real
  events.
- **Kabir et al. 2020**, *J. Hydrol.* 590:125481
  ([arXiv 2006.11555](https://arxiv.org/abs/2006.11555)). A CNN was trained on
  LISFLOOD-FP for **Carlisle**, a UK fluvial case. For the 2005 and 2015
  floods, max-depth error was 0–0.2 m and 0–0.5 m respectively over >99 % of
  cells. It is site-specific: one network per reach.
- **Löwe et al. 2021**, U-FLOOD
  ([DTU Orbit](https://orbit.dtu.dk/en/publications/u-flood-topographic-deep-learning-for-predicting-urban-pluvial-fl/),
  [code + data](https://data.dtu.dk/articles/code/U-FLOOD_-_computer_code_and_data_associated_with_the_article_U-FLOOD_topographic_deep_learning_for_predicting_urban_pluvial_flood_water_depth_/14206838)).
  A U-Net takes rainfall series plus five terrain/imperviousness inputs at
  5 m. It matched existing screening methods on unseen locations within the
  same city, in seconds. Its best model had about 28 M parameters.
- **Guo et al. 2022**, "One model suits all"
  ([preprint](https://essopenarchive.org/doi/full/10.1002/essoar.10505958.1)).
  Patch-based CNNs generalised across **656 Swiss catchments**, but for one
  rainfall event only, with no rainfall input (as noted by
  [HESS 28:5443](https://hess.copernicus.org/articles/28/5443/2024/)).
- **do Lago et al. 2023**, cGAN-Flood, *J. Hydrol.* 618:129276
  ([TU Delft](https://research.tudelft.nl/en/publications/generalizing-rapid-flood-predictions-to-unseen-urban-catchments-w)).
  Trained on 10 urban catchments and tested on 5 unseen ones against HEC-RAS.
  The trick is that it *distributes a target flood volume* supplied by a
  hydrological water balance, so volume is imposed rather than learned. It
  underestimated channel depths for small events, and its speed-up is reported
  as about 250× by a later paper.
- **Review.** Bentivoglio et al. 2022,
  [HESS 26:4345](https://hess.copernicus.org/articles/26/4345/2022/), covers
  58 papers. Convolutional models are usually the most accurate because their
  inductive bias suits spatial flooding. Most studies test on the same
  catchment they trained on, and generalisation and real-time use are named as
  the open gaps.

### 2.2 Graph neural networks on meshes (spatio-temporal)

- **Bentivoglio et al. 2023**, SWE-GNN,
  [HESS 27:4227](https://hess.copernicus.org/articles/27/4227/2023/). The
  message passing mirrors finite-volume fluxes between cells, and a multi-step
  loss with a curriculum keeps rollouts stable. On dike-breach floods over
  *unseen* random topographies the MAE was 0.04 m depth and
  0.004 m²/s unit discharge, up to about 100× faster than the solver.
- **Bentivoglio et al. 2025**, mSWE-GNN,
  [NHESS 25:335](https://nhess.copernicus.org/articles/25/335/2025/). A
  multi-scale version, because the single-scale model struggled with very
  different propagation speeds and needed many layers, which destabilised
  training.

GNNs are the only family here that produces a **time-resolved** flood front
with some claim to transfer across terrain. They are also the hardest to train
and to ship to a browser.

### 2.3 Neural operators (FNO, DeepONet and relatives)

- **Sun et al. 2023**, FNO for Houston
  ([arXiv 2307.16090](https://arxiv.org/abs/2307.16090), ICCV-W). It was
  trained on 6 historical storms and tested on 2 held out. It beat a U-Net
  baseline up to 3 h lead and transferred to new sites.
- **MITONet 2025** ([arXiv 2502.14782](https://arxiv.org/abs/2502.14782)), an
  autoregressive latent operator for 2D shallow-water flow (tidal inlet, Red
  River). It reports 100–1,250× speed-up at NRMSE ≤ 0.011.
- The underlying method is Li et al. 2021, FNO
  ([arXiv 2010.08895](https://arxiv.org/abs/2010.08895)). It is
  resolution-agnostic in principle, but the FFT assumes a regular periodic
  grid, and wet/dry fronts are sharp, which spectral methods smear.

### 2.4 Physics-informed neural networks (PINNs)

- In the classic form (Raissi et al. 2019,
  [J. Comput. Phys. 378:686](https://doi.org/10.1016/j.jcp.2018.10.045)) a
  network is fitted **per problem** with the PDE residual in the loss. That
  fit is usually slower than just running the solver. PINNs are known to fail
  on advection-dominated and sharp-front problems (Krishnapriyan et al. 2021,
  [arXiv 2109.01050](https://arxiv.org/abs/2109.01050)), and a wet/dry
  shallow-water front is exactly that.
- **Donnelly et al. 2024**,
  [Sci. Total Environ. 912:168814](https://doi.org/10.1016/j.scitotenv.2023.168814)
  ([Coventry](https://pureportal.coventry.ac.uk/en/publications/physics-informed-neural-networks-as-surrogate-models-of-hydrodyna/)).
  Here the useful move is to build **mass conservation into the architecture**
  rather than into derivative loss terms. The authors report up to 25 % better
  accuracy than data-driven emulators in small-data settings.

Assessment: a PINN as a *forward solver* gives GeoHUB nothing. Constraining a
data-driven emulator physically (imposing volume as cGAN-Flood does, or
building in conservation as Donnelly does) is worth copying.

### 2.5 Hybrid: upskilling a cheap physics model

- **Fraehr et al. 2023**, *Nature Water* 1:835
  ([doi:10.1038/s44221-023-00132-2](https://doi.org/10.1038/s44221-023-00132-2),
  [Adelaide](https://digital.library.adelaide.edu.au/items/4dc7a0ac-67e7-4c76-9997-6e22eef5629b)).
  It runs a very coarse, fast hydrodynamic model and learns the mapping from
  its output to the high-resolution model's, giving high-resolution answers in
  seconds rather than hours. The same group's earlier LSG model was 12× faster
  on the Murray's Chowilla floodplain
  ([WRR 2023](https://doaj.org/article/6c058a2859d0445e95bdbbb05cc4d5e2)).

**This is the pattern that fits GeoHUB best** (§4). The cheap model supplies
the physics and the topology, so the network only learns a residual. A
residual degrades gracefully outside the training set, where a from-scratch
emulator fails silently.

### 2.6 Operational practice: Google Flood Hub

- **Discharge and stage.** LSTMs trained across basins (the Kratzert et al.
  lineage, [HESS 23:5089](https://hess.copernicus.org/articles/23/5089/2019/))
  have **genuinely replaced** conceptual hydrological models in Google's
  system. Nearing et al. 2024,
  [Nature 627:559](https://doi.org/10.1038/s41586-024-07145-1), report
  reliability in **ungauged** basins at up to 5-day lead that matches or beats
  GloFAS nowcasts, and 5-year-return-period skill comparable to current
  1-year skill. It runs in more than 80 countries.
- **Inundation.** Nevo et al. 2022,
  [HESS 26:4013](https://hess.copernicus.org/articles/26/4013/2022/), describe
  a *thresholding* model (extent) and a *manifold* model (extent and depth)
  that replace per-event hydraulic runs. They are learned per gauge from
  hydraulic simulations and satellite flood maps, which is a site-specific
  emulator **of a pre-computed library**, not a general solver.
- **Urban flash floods (2026).** "Groundsource" used Gemini to extract
  2.6 M historical flood reports from news; an LSTM trained on them gives
  24-h flash-flood *probabilities* over roughly 20 km² areas in 150 countries
  ([Google Research](https://research.google/blog/introducing-groundsource-turning-news-reports-into-data-with-gemini/),
  [TechCrunch](https://techcrunch.com/2026/03/12/google-is-using-old-news-reports-and-ai-to-predict-flash-floods/)).
  It does not estimate depth or severity.

The lesson from the largest operational deployment: the networks replace
**the hydrology** (rain → discharge) and **the lookup** (discharge → a
precomputed inundation map at a known site). They do not replace the
hydraulics for an unseen floodplain.

### 2.7 The other hazards GeoHUB maps

| Hazard | Emulator evidence | Fit for GeoHUB |
| --- | --- | --- |
| Storm surge | Per-point classifier + regressor trained on 446 synthetic ADCIRC hurricanes for Texas ("orders of magnitude faster") ([Pachev et al., arXiv 2204.13168](https://arxiv.org/abs/2204.13168)); DeepSurge on ~900 k synthetic TCs, R² 0.815, MAE 0.25 m, up to 96× ([arXiv 2506.13963](https://arxiv.org/abs/2506.13963)); a global open ADCIRC peak-surge set of 15 k storms with a model ([arXiv 2603.25978](https://arxiv.org/abs/2603.25978)) | **High.** Today's surge screen has no bathymetry or inundation. A pretrained, openly licensed surge emulator is the strongest "NN replaces simulation" case for GeoHUB, because the training library (ADCIRC runs) already exists and someone else paid for it. Check the licence before adopting it |
| Tsunami | CNN from offshore and geodetic data → inundation, 0.4 m amplitude error over 1,000 unseen synthetic scenarios, 0.004 s per forecast ([Makinoshima et al. 2021, Nat. Commun.](https://doi.org/10.1038/s41467-021-22348-0)) | Site-specific (Tohoku). Not a GeoHUB product today |
| Volcanic ash | Gaussian-process (not NN) emulators of Ash3d ([Yang et al. 2020, Proc. R. Soc. A](https://www.earth-prints.org/handle/2122/13820)) | **Low.** GeoHUB's ash reach is already a cheap analytic model; emulating a model that costs milliseconds buys nothing |
| Debris flow / landslide runout | Modified U-Net on Titan2D peak depth, <10 % max pointwise error, used for Monte-Carlo hazard ([Patel et al. 2025, arXiv 2504.07736](https://arxiv.org/abs/2504.07736)); GNN emulators of MPM runout | **Medium, later.** It would make probabilistic runout possible, but it is mostly preprints, and GeoHUB has no runout solver to train it on |

## 3. Cross-cutting findings

**Speed.** Reported speed-ups run from 12× for hybrid upskilling, through
about 100× for GNNs and 250× for cGANs, to 10²–10³× for CNN max-depth maps and
neural operators, and 10⁵× or more for per-point surge. The ratio depends
heavily on the baseline: a CPU solver at fine resolution flatters the network,
while a GPU solver narrows the gap. LISFLOOD-FP 8's GPU solvers are 2.5–4×
faster than 16-core CPU on grids above 1 M cells
([Shaw et al. 2021, GMD 14:3577](https://gmd.copernicus.org/articles/14/3577/2021/)).
Training-data generation and training time are almost never counted. They
repay only when the emulator is queried thousands of times.

**Accuracy.** Typical max-depth errors are 0.04–0.5 m in-distribution. Errors
concentrate at **flood edges, in channels and in the deepest cells**, which is
where hazard classes change and where people are.

**Generalisation.**
- *Same site, new rain*: well established.
- *New site, same kind of terrain*: shown for urban pluvial floods (do Lago:
  10 → 5 catchments; U-FLOOD: within one city) and for random synthetic
  topographies (SWE-GNN).
- *New site, new terrain class, at regional or continental scale with rainfall
  as an input*: **not demonstrated**. Guo 2022 had terrain generalisation but
  a single storm.

**Extremes.** ANNs extrapolate poorly beyond the range of their training
forcing, a known problem the flood-ML literature names but rarely quantifies
([SciTePress 2023 benchmark](https://www.scitepress.org/Papers/2023/120817/120817.pdf)).
Positive counter-examples exist where the test year's peaks exceeded the
validation set's ([Mirhoseini et al., arXiv 2411.19323](https://arxiv.org/abs/2411.19323)),
but only modestly beyond it. The events a hazard map exists for (1-in-100,
1-in-1000, defence breach) are by construction the rarest in any training set.
The usual remedy is to **simulate the extremes deliberately** (design storms
up to and beyond the PMP-scale envelope) rather than sample history.

**Mass conservation.** A max-depth image has no volume budget. Nothing stops a
CNN from creating or losing water, or from painting depth on a hill
disconnected from the river. Mitigations from the literature: impose volume
(cGAN-Flood), build conservation into the architecture (Donnelly), learn
fluxes rather than states (SWE-GNN), or learn a residual on a model that
conserves (Fraehr). GeoHUB's own rule, "what goes in leaves or is still
held", pinned in `flood-fos.test.mjs`, should be a **runtime check** on any
emulator's output. A volume mismatch above a few percent means fall back to
physics.

**Data needs.** The libraries are small in sample count but expensive.
Examples: 18 hyetographs × 3 catchments (Guo 2021), 10 catchments × a rainfall
range (do Lago), 446 storms (Pachev), and 53 observed events at 5 m (U-FLOOD).
DEM quality dominates. A DSM such as Copernicus GLO-30, which GeoHUB uses,
puts buildings and trees into the flow paths. The NI acceptance report already
flags this. An emulator trained on DSM-driven simulations learns DSM
artefacts as hydraulics.

## 4. Verdict

| | Use a network as… | Examples |
| --- | --- | --- |
| **Replace** | the model itself, inside a validated envelope | Rain → discharge (LSTM, Flood Hub). Discharge → inundation at sites with a precomputed library (Nevo's manifold model, Kabir's Carlisle CNN). Peak surge from a synthetic-storm library. Real-time ensembles at a pre-trained site |
| **Accelerate only** | a fast front end whose answers are checked against, or fall back to, physics | Scenario sweeps and sliders. Probabilistic maps from thousands of forcings. Upskilling a coarse or static model (Fraehr). Screening new areas to decide where to run the real solver |
| **Not** | — | Regulatory or design flood maps (EU Floods Directive maps for NI and NRW are hydraulic models, and should stay so). Dam or defence-breach scenarios on geometry outside the training set. Any quantity where water volume matters (storage, reservoir, ponding) without a conservation check. Forcing beyond the training envelope with no fallback. PINNs as a forward solver |

## 5. Recommendation for GeoHUB, sized

The aim is a browser-runnable emulator that makes the existing Flood drawer's
sliders **hydraulically credible** without leaving the page, in keeping with
the methods-in-the-open rule.

### Step 0: a reference solver (prerequisite, no ML)

Without hydraulics there is nothing worth emulating.

- **Offline, in the sidecar:** LISFLOOD-FP 8 (GPL-3.0) with its local-inertial
  (ACC) solver (Bates et al. 2010, [J. Hydrol. 387:33](https://doi.org/10.1016/j.jhydrol.2010.03.027)).
  It takes a DEM, Manning's n, and inflow hydrographs at GRWL reaches (from
  the same Moody & Troutman mean flow and scenario ratios
  `inundation.js` uses, so the products speak one language).
- **Optional later:** a WebGPU port of the local-inertial scheme in the page.
  It is one explicit stencil per step, which suits a compute shader. *(Estimate)*
  A 1 M-cell grid at 30 m with depths around 5 m needs Δt ≈ 3 s, so a 24 h
  event is about 3 × 10⁴ steps, or 3 × 10¹⁰ cell-updates. At 10⁹–10¹⁰
  updates/s on a laptop GPU that is 3–30 s. This is plausible enough that an
  in-browser solver may make an emulator unnecessary for single runs. Measure
  it before building the network.

### Step 1: score the current model (cheap, and overdue)

- Run `inundation.js` scenarios and the reference solver on 5–10 reaches. Use
  the Carlisle (Eden) reach Kabir used, the South Wales valleys (Taff, Rhondda,
  Ebbw), the Rhône at Avignon already used in the notes, and one NI river
  (Lagan or Bann).
- Score both against open maps: **NRW Flood Map for Planning** (Wales), the
  EA's **Risk of Flooding from Rivers and Sea** (England), and DfI flood maps
  (NI) where downloadable. Report CSI = hits/(hits+misses+false alarms) and
  depth bias, the standard inundation skill scores.
- That gives GeoHUB its first flood skill number, and it shows where the static
  model is wrong, which is exactly what an emulator would learn to fix.

### Step 2: the emulator — a residual U-Net on top of `inundation.js`

| Item | Spec |
| --- | --- |
| Task | Predict *max-depth correction* Δd = d_ref − d_static, plus a wet/dry logit, on 256 × 256 tiles |
| Inputs (per cell) | DEM, HAND, slope, `inundation.js` depth for the same scenario, distance to channel, GRWL width/rise at the nearest reach, defended flag, Manning's n (from land cover), scenario Q/Q̄ as a constant channel |
| Architecture | U-Net, 4 levels, ~2–8 M parameters (U-FLOOD found 28 M best at 5 m in one city; a residual task needs less). fp16 ONNX ≈ 4–16 MB |
| Training library | ~50–100 tiles × ~10 discharge scenarios (seasonal → 1-in-1000 *and beyond*: Q/Q̄ to ~2× the largest slider) ≈ **500–1,500 reference runs**. Mixed terrain: upland valleys, lowland floodplains, levéed rivers, urban |
| Simulation compute | *(Estimate)* A 256² tile at 30 m for a 24–48 h hydrograph takes minutes on CPU ACC. 1,000 runs ≈ 50–150 CPU-hours: a few nights on a workstation, or a few hours on a cloud GPU with LISFLOOD-FP's GPU solvers. **Not on the shared laptop** |
| Training compute | *(Estimate)* ~10⁴ tile-samples with augmentation; a few GPU-hours on one consumer GPU (≥ 12 GB) |
| Storage | ~1,000 runs × 256² × a few float32 bands ≈ 1–3 GB. Keep it in the sidecar or a bucket, not in git (the `.tif` lesson from `ni-flood.js`) |
| Hold-outs | Whole catchments held out, not random tiles. At least one held-out *terrain class*. The largest scenario held out to measure extrapolation |
| Browser runtime | ONNX Runtime Web with the WebGPU EP, falling back to WASM ([docs](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html)); keep tensors on the GPU. *(Estimate)* tens of ms per tile on WebGPU, so a view of ~16 tiles stays inside today's 0.5 s slider budget |

**Guards that make it honest, matching the house rules:**

1. **Envelope.** The drawer refuses, or greys out the correction, when Q/Q̄,
   slope, tile relief or land cover fall outside the training ranges, and says
   which.
2. **Volume check.** The emulated flood volume is compared with the volume the
   reference relation implies (rise × connected area, or the hydrograph volume
   from `flood-fos.js`). A mismatch over ~5 % means the static model is shown
   with a note.
3. **Connectivity.** Keep `inundation.js`'s "joined to the channel" mask as a
   hard constraint, so the network cannot paint isolated ponds on a hill.
4. **Published skill.** CSI and depth MAE on the held-out catchments ship in
   the drawer and in `hazards.md`, beside the model card (data, licence,
   weights hash).
5. **An A/B toggle** between static and static + learned correction, the same
   way the notes already A/B the outer-flood merge.

### What to skip, or do later

- **GNN (SWE-GNN-style) time-resolved fronts**: only if a "flood arrives at
  t + 3 h" product is wanted. It is far harder to train and ship.
- **FNO**: no advantage over a U-Net for single max-depth tiles. Sharp wet/dry
  fronts suit it poorly.
- **PINNs**: no.
- **Pluvial (rain-on-grid) emulation**: wait for step 0 to run rain-on-grid.
  Then the cGAN-Flood volume-distribution idea fits `catchment.js`'s SCS-CN
  runoff volume directly.
- **Surge**: evaluate the open global ADCIRC dataset and model
  ([arXiv 2603.25978](https://arxiv.org/abs/2603.25978)) as a replacement for
  the surge screen. This is the one place a network can replace a simulation
  in GeoHUB *without* GeoHUB running the simulation.

### Cost summary *(estimates)*

| Phase | Effort | Compute |
| --- | --- | --- |
| 0. LISFLOOD-FP in the sidecar, GRWL inflows | ~1–2 weeks | negligible |
| 1. Skill scores vs NRW / EA / DfI maps on 5–10 reaches | ~1 week | ~10 CPU-hours |
| 2a. Library of 500–1,500 runs | ~1 week of tooling | 50–150 CPU-hours, or a few cloud GPU-hours |
| 2b. Train + evaluate the residual U-Net | ~1–2 weeks | a few GPU-hours |
| 2c. ONNX/WebGPU integration, envelope and volume guards, drawer A/B | ~1 week | — |

The order matters. Steps 0–1 are worth doing even if step 2 never happens,
because they give GeoHUB its first flood skill score and a physics reference
to fall back on. Step 2 is worth doing only if step 1 shows the static model
is materially wrong in a way that is systematic enough to learn.
