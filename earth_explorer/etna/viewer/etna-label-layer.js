/**
 * GeoID: Earth — Etna POI label layer
 * Three.js sprite labels (canvas pill textures), surface dots, and connector lines.
 * Architecture mirrors the Mars viewer label-layer.js exactly.
 */

import * as THREE from './vendor/three.module.js';

// ─── Theme palette (matches Mars viewer conventions) ─────────────────────────

const THEME_PALETTE = {
  settlement: {
    bg:     'rgba(10, 22, 14, 0.74)',
    stroke: 'rgba(128, 229, 160, 0.42)',
    accent: 'rgba(98, 222, 132, 0.94)',
    title:  'rgba(237, 255, 242, 0.96)',
    markerColor:   0x65dc78,
    lineColor:     0x86f19a,
    spriteOpacity: 0.94,
    accentHex:     '#65dc78',
  },
  fault: {
    bg:     'rgba(18, 10, 4, 0.76)',
    stroke: 'rgba(184, 115, 51, 0.50)',
    accent: 'rgba(184, 115, 51, 0.92)',
    title:  'rgba(255, 235, 210, 0.96)',
    markerColor:   0xb87333,
    lineColor:     0xd4965a,
    spriteOpacity: 0.86,
    accentHex:     '#b87333',
  },
  vent: {
    bg:     'rgba(28, 10, 10, 0.72)',
    stroke: 'rgba(255, 122, 96, 0.56)',
    accent: 'rgba(255, 88, 69, 0.92)',
    title:  'rgba(255, 234, 230, 0.96)',
    markerColor:   0xff735d,
    lineColor:     0xff8c73,
    spriteOpacity: 0.94,
    accentHex:     '#ff735d',
  },
  fissure: {
    bg:     'rgba(28, 14, 4, 0.74)',
    stroke: 'rgba(255, 160, 60, 0.48)',
    accent: 'rgba(255, 145, 0, 0.92)',
    title:  'rgba(255, 235, 200, 0.96)',
    markerColor:   0xff9100,
    lineColor:     0xffb347,
    spriteOpacity: 0.90,
    accentHex:     '#ff9100',
  },
  general: {
    bg:     'rgba(9, 14, 24, 0.62)',
    stroke: 'rgba(90, 214, 233, 0.28)',
    accent: 'rgba(58, 214, 208, 0.92)',
    title:  'rgba(242, 247, 250, 0.94)',
    markerColor:   0x34d7d1,
    lineColor:     0x46d7d1,
    spriteOpacity: 0.82,
    accentHex:     '#34d7d1',
  },
  hydro: {
    bg:     'rgba(4, 18, 36, 0.74)',
    stroke: 'rgba(80, 170, 230, 0.42)',
    accent: 'rgba(64, 196, 255, 0.92)',
    title:  'rgba(220, 240, 255, 0.96)',
    markerColor:   0x40c4ff,
    lineColor:     0x64d8ff,
    spriteOpacity: 0.88,
    accentHex:     '#40c4ff',
  },
};

export function getThemePalette(theme) {
  return THEME_PALETTE[theme] || THEME_PALETTE.general;
}

// ─── POI data ─────────────────────────────────────────────────────────────────
// Coordinates in Etna viewer space: X = east km, Z = south km (from domain centre)
// Y is sampled from terrain at build time. Domain centre ≈ 37.755°N, 15.003°E.
// 1° lat ≈ 111 km, 1° lon at 37.755°N ≈ 87.8 km

export const ETNA_POIS = [

  // ── Settlements ──────────────────────────────────────────────────────────────
  {
    name: 'Catania', kicker: 'City', theme: 'settlement', x: 7.4, z: 28.1, lod: 1,
    meta: '37.50°N  15.09°E  ·  8 m asl',
    description: "Sicily's second city, 28 km south of the summit on the Ionian coast. Population ~300,000. Severely damaged in the catastrophic 1669 eruption — lava reached the city walls and entered the harbour, and a 1693 earthquake devastated the rebuilt city.",
  },
  {
    name: 'Nicolosi', kicker: 'Town', theme: 'settlement', x: 2.7, z: 15.8, lod: 2,
    meta: '37.61°N  15.03°E  ·  698 m asl',
    description: "Gateway town on Etna's southern flank. Main base for the southern summit route via the Funivia cable car and Rifugio Sapienza. INGV Osservatorio Etneo is 1 km west. Nicolosi sits on extensive lava flows from the 17th–19th century.",
  },
  {
    name: 'Zafferana Etnea', kicker: 'Town', theme: 'settlement', x: 9.2, z: 7.0, lod: 2,
    meta: '37.69°N  15.11°E  ·  574 m asl',
    description: "Eastern flank town famously menaced by the 1991–93 lava flows descending Valle del Bove. Flows stopped 1 km short after the Italian Army constructed diversion barriers and drilled drainage tunnels into the lava tube system.",
  },
  {
    name: 'Bronte', kicker: 'Town', theme: 'settlement', x: -14.7, z: -3.6, lod: 2,
    meta: '37.79°N  14.84°E  ·  760 m asl',
    description: "Town on Etna's western flank on ancient lava flows. World-renowned for pistachio cultivation on the mineral-rich volcanic soil — Bronte pistachios hold DOP status. Nelson's estate (Castello Maniace) is nearby.",
  },
  {
    name: 'Randazzo', kicker: 'Town', theme: 'settlement', x: -5.0, z: -13.7, lod: 2,
    meta: '37.88°N  14.95°E  ·  765 m asl',
    description: "Medieval town on Etna's northern lava flows. Despite its position at the volcano's base, Randazzo has never been inundated by lava — bedrock topography deflects flows to either side. Its historic centre survives largely intact.",
  },
  {
    name: 'Linguaglossa', kicker: 'Town', theme: 'settlement', x: 12.2, z: -9.8, lod: 3,
    meta: '37.84°N  15.14°E  ·  550 m asl',
    description: "NE flank town built on ancient lavas. Northern gateway to the Piano Provenzana ski area. The 2002 lava flows reached within 6 km to the west before stalling.",
  },
  {
    name: 'Adrano', kicker: 'Town', theme: 'settlement', x: -14.8, z: 10.4, lod: 3,
    meta: '37.66°N  14.83°E  ·  560 m asl',
    description: "SW flank town founded on Quaternary lava flows. The Greek colony of Adranon was established here in 400 BCE. The Simeto River valley marks a major NW–SE structural lineament controlling SW flank volcanism.",
  },

  // ── Faults ───────────────────────────────────────────────────────────────────
  {
    name: 'Timpe Fault System', kicker: 'Active Fault', theme: 'fault', x: 11.2, z: 0.8, lod: 2,
    meta: 'E flank  ·  N-trending normal faults',
    description: "Series of N–S normal fault scarps on Etna's eastern flank, producing steps of 50–100 m. Quaternary active structure linked to seaward gravitational spreading of the volcanic edifice above weak Pleistocene marine clays. Associated with shallow seismicity and ground deformation.",
  },
  {
    name: 'Pernicana Fault', kicker: 'Active Fault', theme: 'fault', x: 7.9, z: -5.8, lod: 2,
    meta: 'NE flank  ·  E–W transtensional',
    description: "Major E–W transtensional fault accommodating the eastward sliding of Etna's NE sector toward the Ionian Sea. Slipped ~10 cm during the 2002–03 eruption, destroying Piano Provenzana. One of Etna's most seismically productive structures, with near-continuous creep.",
  },
  {
    name: 'Ragalna Fault', kicker: 'Active Fault', theme: 'fault', x: -7.2, z: 8.8, lod: 3,
    meta: 'SW flank  ·  NNW-trending normal',
    description: "NNW-trending normal fault on the SW flank associated with slow aseismic creep and episodic seismic swarms. Part of the SW rift zone that channels dykes toward flank eruptive fissures. Intersects the 2001 eruption fissure system.",
  },
  {
    name: 'Santa Venerina Fault', kicker: 'Seismogenic Fault', theme: 'fault', x: 13.1, z: 9.7, lod: 3,
    meta: 'SE piedmont  ·  NNW-trending',
    description: "Piedmont fault on Etna's SE flank associated with damaging historical earthquakes, including an ML 4.8 event in 2018 that caused widespread damage to villages on the lower eastern flank. Part of the broader eastern fault system linked to flank instability.",
  },

  // ── Vents & Craters ──────────────────────────────────────────────────────────
  {
    name: 'Voragine', kicker: 'Summit Crater', theme: 'vent', x: -0.69, z: 0.61, lod: 1,
    meta: '37.752°N  14.995°E  ·  3,297 m asl',
    description: "Central summit crater named for its deep 'chasm'. First described in the 17th century. Site of major paroxysmal lava fountain episodes, most recently December 2015 — the most powerful fountaining since 1998. A persistent lava lake has been observed intermittently since the 1990s.",
  },
  {
    name: 'Bocca Nuova', kicker: 'Summit Crater', theme: 'vent', x: -0.93, z: 0.66, lod: 1,
    meta: '37.751°N  14.992°E  ·  3,380 m asl',
    description: "Summit crater formed 1968 as a collapse pit at the W rim of Voragine. Twin to Voragine in eruption chronology — they share a common magma connection. Shows periodic Strombolian activity, ash emissions, and intracrater lava ponding.",
  },
  {
    name: 'NE Crater', kicker: 'Summit Crater', theme: 'vent', x: -0.55, z: 0.24, lod: 1,
    meta: '37.755°N  14.997°E  ·  3,329 m asl',
    description: "Highest of the four summit craters — at 3,329 m, marking the official summit elevation. Most active in the 1970s–90s, producing frequent lava fountaining and building the current cone. Activity has significantly declined since 2001 as the SE Crater became the dominant vent.",
  },
  {
    name: 'SE Crater', kicker: 'Summit Crater', theme: 'vent', x: -0.33, z: 1.05, lod: 1,
    meta: '37.748°N  14.999°E  ·  3,294 m asl',
    description: "Youngest and currently most active summit vent, first opened 1971 on the SE rim. The New SE Cone (formed 2011–13) grew rapidly via lava fountain episodes and is now comparable in height to NE Crater. Dominated by Strombolian and effusive activity since 2010.",
  },
  {
    name: 'New SE Crater', kicker: 'Summit Crater', theme: 'vent', x: -0.05, z: 1.08, lod: 2,
    meta: '37.747°N  15.002°E  ·  ~3,350 m asl',
    description: "Parasitic cone on the SE flank of the SE Crater, formed during intense lava fountaining episodes beginning in 2011. Grew explosively in 2012–13 to rival NE Crater in height. Now the primary vent for Etna's frequent paroxysmal activity, producing lava fountains up to 1 km tall.",
  },
  {
    name: 'Ellittico Caldera', kicker: 'Ancient Caldera', theme: 'vent', x: -1.71, z: -0.13, lod: 3,
    meta: '37.758°N  14.984°E  ·  ~15,000 years BP  ·  2.5 × 3.5 km',
    description: "Remnant of a major summit caldera formed ~15,000 years BP following a large explosive eruption and partial collapse of the Ellittico cone. The present summit crater complex sits entirely within this structure. The caldera rim is visible as a subtle topographic break at ~3,100 m on the upper flanks.",
  },
  {
    name: 'Monti Rossi', kicker: 'Flank Vent', theme: 'vent', x: 0.83, z: 15.03, lod: 3,
    meta: '37.620°N  15.013°E  ·  S flank  ·  1669 eruption  ·  ~800 m asl',
    description: "Twin cinder cones built during the catastrophic 1669 eruption — Etna's most destructive in recorded history. Lava flows travelled 15 km, reached Catania, breached the city walls, and extended 1 km into the sea to form a new promontory. Eruption lasted 122 days; ~70 villages affected.",
  },

  // ── Fissures & Eruptions ─────────────────────────────────────────────────────
  {
    name: '2001 Eruption', kicker: 'Fissure Zone', theme: 'fissure', x: -0.9, z: 5.5, lod: 2,
    meta: 'July – August 2001  ·  SW & S fissures',
    description: "Two fissure systems opened simultaneously — the first such simultaneous multi-fissure eruption in recorded history. One system was fed by summit-derived magma; the other tapped a deeper, more primitive source. Anomalous SO₂-rich gas and HCl emissions. Rifugio Sapienza was partially destroyed by lava flows.",
  },
  {
    name: '2002–03 Eruption', kicker: 'Fissure Zone', theme: 'fissure', x: 2.5, z: -5.2, lod: 2,
    meta: 'Oct 2002 – Jan 2003  ·  N & SE fissures',
    description: "Largest eruption by volume in 20 years. Northern fissures opened near Piano Provenzana, destroying the ski resort. Pernicana Fault slipped ~10 cm. A simultaneous SE fissure eruption made this the first bilateral flank eruption in decades. Ash clouds reached North Africa and closed Catania airport for weeks.",
  },
  {
    name: '1991–93 Lava Flow', kicker: 'Fissure Zone', theme: 'fissure', x: 2.5, z: 3.9, lod: 2,
    meta: 'Dec 1991 – Mar 1993  ·  473 days',
    description: "Etna's longest 20th-century eruption. Lava descended Valle del Bove in a compound lava field threatening Zafferana Etnea. The Italian Army and INGV scientists detonated explosive charges and drilled a 300 m diversion tunnel to drain the lava tube system. Total erupted volume ~300 million m³.",
  },
  {
    name: '2004–05 Eruption', kicker: 'Fissure Zone', theme: 'fissure', x: 2.5, z: 1.3, lod: 3,
    meta: 'Sep 2004 – Mar 2005  ·  Upper E flank',
    description: "Unusually quiet effusive eruption on the upper E flank sourced from the summit plumbing system. No seismic precursors, minimal ground deformation. Lava flowed into upper Valle del Bove with no impact on populated areas. Significant for demonstrating passive magma drainage from the summit reservoir.",
  },

  // ── General POI ──────────────────────────────────────────────────────────────
  {
    name: 'Rifugio Sapienza', kicker: 'Visitor Hub', theme: 'general', x: -0.30, z: 6.30, lod: 2,
    meta: '37.698°N  15.000°E  ·  1,910 m asl',
    description: "Main southern visitor hub and trailhead at 1,910 m. Starting point for the Funivia cable car (to 2,500 m) and southern summit trails. The refuge was partially buried by 2001 lava flows and rebuilt in 2002. Site of the INGV southern monitoring station.",
  },
  {
    name: 'Piano Provenzana', kicker: 'Ski Station', theme: 'general', x: 3.4, z: -4.6, lod: 3,
    meta: '37.796°N  15.042°E  ·  1,800 m asl',
    description: "Northern ski station and NE gateway to Etna's summit routes. The original station was destroyed by 2002 lava flows; the rebuilt facility opened 2009. Sits directly on 2002 lava — a visible reminder of how rapidly Etna's landscape can change.",
  },
  {
    name: 'Valle del Bove', kicker: 'Depression', theme: 'general', x: 4.56, z: 2.78, lod: 2,
    meta: '8 × 5 km  ·  1,200 m deep',
    description: "Massive horseshoe-shaped depression on Etna's eastern flank, formed by sector collapse ~8,000 years BP. Acts as a natural lava flow trap — most flank eruptions pour into it. The 1991–93 flows filled a significant fraction. Walls expose 30,000 years of lava stratigraphy.",
  },
  {
    name: 'Pizzi Deneri', kicker: 'Observatory', theme: 'general', x: 0.5, z: -1.4, lod: 3,
    meta: '37.768°N  15.009°E  ·  2,847 m asl',
    description: "Astrophysical and geophysical observatory on the NE summit rim at 2,847 m. Operates continuously as an INGV monitoring post with thermal cameras providing 24/7 surveillance of NE Crater activity. The summit trail from Piano Provenzana passes through here.",
  },

  // ── Additional settlements ────────────────────────────────────────────────────
  {
    name: 'Taormina', kicker: 'Historic City', theme: 'settlement', x: 25.0, z: -10.7, lod: 1,
    meta: '37.852°N  15.288°E  ·  204 m asl',
    description: "One of Sicily's most celebrated hilltop cities, perched on the cliffs of Monte Tauro overlooking the Ionian Sea. The 3rd-century BC Greek Theatre commands a panoramic view of Etna — one of the most photographed scenes in the Mediterranean. The town survived successive Greek, Roman, Arab, Norman, and Spanish occupations and retains a remarkably intact historic centre. The Ionian coastline below marks the surface expression of the Malta Escarpment — the tectonic boundary between Africa and Europe.",
  },
  {
    name: 'Acireale', kicker: 'City', theme: 'settlement', x: 14.2, z: 15.9, lod: 2,
    meta: '37.612°N  15.165°E  ·  161 m asl',
    description: "Largest coastal city on Etna's SE flank, celebrated for its elaborate Sicilian Baroque architecture and one of Sicily's most elaborate carnival festivals. The thermal baths at Santa Venera al Pozzo exploit mineral-rich waters filtered through Etna's volcanic substrate. Acireale sits directly on the Timpe fault system — the N-S trending normal fault scarps that step down the coastline are visible as terraces above the sea.",
  },
  {
    name: 'Paternò', kicker: 'Town', theme: 'settlement', x: -8.9, z: 20.7, lod: 2,
    meta: '37.568°N  14.902°E  ·  225 m asl',
    description: "Major town on Etna's SW flank at the edge of the Simeto river valley. The Norman castle (1072 AD) is one of the best-preserved Norman towers in Sicily, built by Roger I and commanding views across the Catania plain to Etna's summit. The town sits on the transition between Etna's basaltic lavas to the N and the Quaternary alluvial deposits of the Simeto valley — a geological boundary that has historically channelled both lava flows and floodwaters.",
  },
  {
    name: 'Biancavilla', kicker: 'Town', theme: 'settlement', x: -11.9, z: 12.7, lod: 3,
    meta: '37.641°N  14.867°E  ·  476 m asl',
    description: "SW flank town known for pistachio and almond cultivation. Subject to ongoing environmental remediation since the late 1990s following the discovery of fibrous fluoro-edenite — a rare asbestos-like mineral found only in the local Monte Calvario quarry basalt. Extensively used in construction before the health risk was identified, the contamination led to significantly elevated mesothelioma rates in the local population.",
  },
  {
    name: 'Maletto', kicker: 'Town', theme: 'settlement', x: -11.9, z: -8.1, lod: 3,
    meta: '37.828°N  14.867°E  ·  1,060 m asl',
    description: "High-altitude NW flank town at 1,060 m — one of the highest settlements on the volcano. Part of the Bronte–Maletto pistachio DOP production zone. The surrounding landscape is dominated by NW rift zone lavas erupted over the past few thousand years. The Simeto River valley to the NW separates Etna's volcanic substrate from the older Nebrodi mountains, and the contrast in vegetation and soil type is visible from the town.",
  },
  {
    name: 'Castiglione di Sicilia', kicker: 'Town', theme: 'settlement', x: 10.4, z: -14.2, lod: 3,
    meta: '37.882°N  15.121°E  ·  621 m asl',
    description: "Medieval hilltop town on Etna's NE flank, dominated by the ruins of an Aragonese castle. Sits at the head of the Alcantara gorge — a dramatic canyon carved by the river through ancient columnar-jointed basalt flows. The Alcantara Gorge is one of the geological highlights of the Etna domain: the hexagonal basalt columns were formed by slow, uniform cooling of a lava flow ponded in the river valley. The surrounding slopes produce Etna DOC wines.",
  },
  {
    name: 'Milo', kicker: 'Village', theme: 'settlement', x: 10.0, z: 4.0, lod: 3,
    meta: '37.719°N  15.117°E  ·  700 m asl',
    description: "Upper E flank village at 700 m in the Etna DOC Bianco wine zone, planted primarily with Carricante grapes on ancient lavas. The 2002 eruption descended to within 2 km of the village. The variation in soil chemistry as a function of lava age — detectable in the mineral and aromatic complexity of the wine — makes Milo a reference point for the emerging concept of volcanic terroir, now the subject of active oenological research.",
  },
  {
    name: 'Pedara', kicker: 'Town', theme: 'settlement', x: 4.8, z: 15.5, lod: 4,
    meta: '37.615°N  15.058°E  ·  607 m asl',
    description: "S flank gateway town at 607 m. The 17th-century Church of Sant'Antonio Abate, with its lava-stone façade and ornate portal, is one of the finest examples of Etna Baroque architecture. The town's water supply comes from aquifers percolating through the deeply jointed lava formations below — Etna's volcanic rock is both a major water reservoir and a natural filter for one of Sicily's most abundant groundwater systems.",
  },
  {
    name: 'Mascali', kicker: 'Town', theme: 'settlement', x: 16.5, z: -0.3, lod: 4,
    meta: '37.758°N  15.191°E  ·  68 m asl',
    description: "The only modern Sicilian town to be completely destroyed and relocated due to a volcanic eruption. The original Mascali was buried by 1928 lava flows that descended the NE flank in under 48 hours. The new town was planned and built on unaffected ground — a rare modern example of forced volcanic relocation. Mussolini's government filmed workers attempting (unsuccessfully) to divert the flows, and used the eruption as a propaganda opportunity to display state authority over nature.",
  },
  {
    name: 'Viagrande', kicker: 'Town', theme: 'settlement', x: 8.3, z: 16.2, lod: 4,
    meta: '37.609°N  15.097°E  ·  490 m asl',
    description: "SE flank hillside town on ancient lava terraces producing Etna DOC Rosso and Bianco wines from Nerello Mascalese and Carricante grapes. The road through Viagrande formed part of the historic ascent route from Catania to Rifugio Sapienza before the modern bypass was built. The stepped landscape below the town reflects the successive lava flow fronts from different eruptions over the past two millennia.",
  },
  {
    name: 'Trecastagni', kicker: 'Town', theme: 'settlement', x: 6.6, z: 15.2, lod: 4,
    meta: '37.618°N  15.078°E  ·  586 m asl',
    description: "SE flank town named for three chestnut trees ('tre castagni'), reflecting the historical chestnut woodland cover that once extended across Etna's mid-altitude belt. The 16th-century Church of SS. Alfio, Filadelfio e Cirino — one of the most important religious sites on Etna — draws pilgrims annually. Sits on lava flows from multiple historical eruptions that have built up a steplike landscape visible in the town's terraced topography.",
  },
  {
    name: 'Cesarò', kicker: 'Town', theme: 'settlement', x: -25.2, z: -9.9, lod: 4,
    meta: '37.844°N  14.715°E  ·  1,007 m asl',
    description: "Remote NW domain town at 1,007 m at the geological boundary between Etna's Quaternary basaltic lavas and the older Nebrodi mountain range. Gateway to the Nebrodi Natural Park. Well beyond the zone of active lava hazard but within range of tephra fall during northerly wind eruption events. The geographic isolation has preserved traditional pastoral land use patterns absent from most of the domain's more volcanically active slopes.",
  },
  {
    name: "Sant'Alfio", kicker: 'Village', theme: 'settlement', x: 11.9, z: 1.4, lod: 4,
    meta: '37.742°N  15.139°E  ·  550 m asl',
    description: "NE flank village famed as the site of the Castagno dei Cento Cavalli — Chestnut of 100 Horses — one of the oldest and largest trees on Earth, estimated at 2,000–4,000 years old and 22 m in circumference. A UNESCO natural monument. The village sits within the belt of ancient chestnut woodland that historically covered Etna's 600–1,000 m NE flank before most was cleared for citrus and wine cultivation.",
  },
  {
    name: 'Belpasso', kicker: 'Town', theme: 'settlement', x: -2.2, z: 18.0, lod: 5,
    meta: '37.593°N  14.978°E  ·  430 m asl',
    description: "SW suburban town at the lower edge of Etna's volcanic substrate, bordered to the S by the Simeto river alluvial plain. The Circumetnea narrow-gauge railway — which circumnavigates Etna's entire base across 110 km — passes through Belpasso as part of its circuit from Catania via Randazzo and back. Serves as a residential base for Catania while retaining an old lava-stone historic centre characteristic of low-flank Etna towns.",
  },
  {
    name: 'Giarre', kicker: 'Town', theme: 'settlement', x: 15.9, z: 3.1, lod: 5,
    meta: '37.727°N  15.184°E  ·  58 m asl',
    description: "Ionian coast town serving as the main rail and road gateway to Etna's eastern villages, together with the adjacent port town of Riposto. The 1928 lava flow stopped approximately 3 km to the N at Mascali, narrowly missing Giarre. Surrounded by citrus groves on the fertile coastal plain built from millennia of volcanic ash deposition and river-carried tephra from Etna's flanks, producing some of Sicily's most prized blood oranges.",
  },

  // ── Additional faults & rift zones ────────────────────────────────────────────
  {
    name: 'NE Rift Zone', kicker: 'Magmatic Rift', theme: 'fault', x: 0.7, z: -3.2, lod: 2,
    meta: 'NE flank  ·  NNE-trending  ·  ~12 km',
    description: "Principal magmatic rift axis extending NNE from the summit toward the NE coast, marking the zone of preferential dyke injection for NE flank eruptions. The 1928, 2001, and 2002 eruptions all exploited rift-zone structural weaknesses. Continuous geodetic monitoring shows ~1–2 cm/yr horizontal extension across the rift. The surface trace is defined by the chain of parasitic cones from the summit to the coastal plain.",
  },
  {
    name: 'S Rift Zone', kicker: 'Magmatic Rift', theme: 'fault', x: -0.6, z: 5.7, lod: 2,
    meta: 'S flank  ·  S-trending  ·  ~8 km',
    description: "Southern rift axis channelling dykes toward the S flank below the summit craters. The 2001 eruption opened fissures along both the S and SW rift zones simultaneously — the first dual-rift eruption in recorded history. The S rift also fed the catastrophic 1669 mega-eruption, opening fissures near the 870 m contour that produced the flows reaching Catania. The rift axis is defined by the southward alignment of recent eruptive vents including Monti Calcarazzi and Monti Rossi.",
  },
  {
    name: 'Fiandaca Fault', kicker: 'Seismogenic Fault', theme: 'fault', x: 10.1, z: 11.9, lod: 2,
    meta: 'SE flank  ·  NNW–SSE  ·  ~10 km',
    description: "SE flank seismogenic fault linked to gravitational spreading of Etna's eastern sector above weak Pleistocene marine clay substrata. On 26 December 2018 this fault produced the strongest flank earthquake in 30 years (Mw 4.9), causing widespread damage to Zafferana Etnea and Fleri. The rupture reached the surface with visible ground breaks through farmland — a rare surface-rupture event for an Etna flank fault.",
  },
  {
    name: 'Acicatena Fault', kicker: 'Active Fault', theme: 'fault', x: 11.8, z: 18.7, lod: 3,
    meta: 'SE piedmont  ·  NNW-trending',
    description: "SE piedmont fault forming part of the Eastern Fault System that accommodates seaward gravitational sliding of Etna's flank. Controls the drainage pattern of streams from the SE flank to the Ionian coast. Associated with long-term aseismic creep and episodic seismic swarms during eruption phases. The fault scarp is expressed as a subtle topographic step in the agricultural landscape of the lower SE flank.",
  },
  {
    name: 'Moscarello Fault', kicker: 'Active Fault', theme: 'fault', x: 13.3, z: 5.8, lod: 3,
    meta: 'E flank  ·  NNW-trending  ·  Timpe system',
    description: "East flank normal fault within the Timpe system, producing east-facing fault scarps of 20–60 m in Quaternary lavas. Part of a family of parallel NNW-trending faults that accommodate the eastward translation of Etna's flank above weak marine clays. Geodetic surveys show steady horizontal extension. One of several Timpe scarps that produce the stepped topographic terraces visible along the E flank between 100 and 700 m elevation.",
  },
  {
    name: 'Trecastagni Fault', kicker: 'Seismogenic Fault', theme: 'fault', x: 7.3, z: 18.0, lod: 3,
    meta: 'SE flank  ·  NNW-trending',
    description: "SE flank seismogenic fault associated with a ML 3.5–4.5 swarm in December 1984 and recurrent deformation events coinciding with eruption phases. Runs parallel to the Acicatena and Moscarello faults — all part of the kinematic family of structures accommodating the gravitational eastward sliding of Etna's edifice. Ground deformation interferometry (InSAR) shows a distinct displacement gradient across this structure during intrusive events.",
  },
  {
    name: "Sant'Leonardello Fault", kicker: 'Creep Fault', theme: 'fault', x: 15.8, z: 7.8, lod: 5,
    meta: 'SE flank  ·  NNW-trending',
    description: "SW flank fault characterised by predominantly aseismic creep, linking the Ragalna Fault north of the summit to the Simeto valley structural boundary in the south. The absence of large earthquakes here reflects the fault's ability to release strain continuously through slow aseismic sliding rather than brittle failure. Ground deformation data show measurable surface displacement rates of ~5 mm/yr, monitored by the INGV GNSS network.",
  },

  // ── Additional vent structures ────────────────────────────────────────────────
  {
    name: 'Valle del Leone', kicker: 'Structural Depression', theme: 'general', x: 1.1, z: -0.4, lod: 2,
    meta: 'NW flank  ·  ~1,600–2,200 m asl  ·  NW rift zone',
    description: "Structural depression on Etna's NW flank, formed by down-dropping along the NW rift zone over the past few thousand years. Channelled lava flows during the 1981 and 2002 eruptions. The 1981 eruption produced exceptionally fast-moving lava that descended through here at up to 30 m/min, covering 8 km in approximately 6 hours. Now a popular trekking corridor on the NW summit approach.",
  },
  {
    name: 'Monti Sartorius', kicker: 'Parasitic Cones', theme: 'vent', x: 4.8, z: -2.1, lod: 2,
    meta: '37.774°N  15.058°E  ·  NE flank  ·  1865 eruption  ·  ~1,800 m asl',
    description: "Cluster of scoria cones built during the 1865 NE flank eruption — one of several parasitic cone groups punctuating the NE rift zone between the summit and the coast. The 1865 eruption produced multiple closely spaced vents over several weeks. The well-preserved cones form a recognisable landmark on the NE summit trail from Piano Provenzana to the summit craters.",
  },
  {
    name: 'Monti Silvestri Superiore', kicker: 'Parasitic Cones', theme: 'vent', x: 0.2, z: 6.2, lod: 3,
    meta: '37.699°N  15.005°E  ·  S flank  ·  1892 eruption  ·  2,001 m asl',
    description: "Twin scoria cones on the S flank built during the 1892 eruption, sited adjacent to the Funivia cable car upper terminal at Rifugio Sapienza. One of Etna's most-visited geological features. The paired Superior and Inferior cones are a textbook example of Strombolian vent structures. Erupted from the S rift zone fissure system, they mark the axis of S rift activity at this elevation.",
  },
  {
    name: 'Trifoglietto II Caldera', kicker: 'Ancient Caldera', theme: 'vent', x: 3.3, z: 1.7, lod: 3,
    meta: '37.740°N  15.040°E  ·  N wall of Valle del Bove  ·  ~64,000 yr BP',
    description: "Remnant of Etna's Trifoglietto II volcanic centre — one of several ancestral edifices that preceded the current Mongibello cone. Exposed in the N wall of the Valle del Bove, where the sector collapse opened a 1,200 m-deep stratigraphic window into the volcano's interior. The Trifoglietto series centres were active 100,000–64,000 years ago and represent a distinct magmatic episode with different geochemical signatures from the current activity.",
  },
  {
    name: 'Monti Calcarazzi', kicker: 'Eruption Vent', theme: 'vent', x: 0.3, z: 5.3, lod: 4,
    meta: '37.707°N  15.006°E  ·  S flank  ·  1669 eruption  ·  ~870 m asl',
    description: "Scoria mounds marking the principal vent area of the catastrophic 1669 eruption — Etna's most destructive in recorded history. The eruptive fissure opened on the S flank on the night of 10–11 March 1669. Lava from this vent fed the main flow field that travelled 15 km south to Catania. Named for the small limestone outcrops ('calcarazzi') that were engulfed by the eruption. Sits directly on the S rift zone axis.",
  },
  {
    name: 'Monte Centenari', kicker: 'Parasitic Cones', theme: 'vent', x: 2.7, z: 2.6, lod: 4,
    meta: '37.732°N  15.034°E  ·  NE flank  ·  1852–53 eruption  ·  ~2,100 m asl',
    description: "NE flank scoria cones built during the 1852–53 eruption — one of the 19th century's most voluminous Etna events, lasting over 400 days and producing lava flows that descended toward the NE coast. Monte Centenari lies on the NE rift zone between the summit and Monti Sartorius and forms part of the cone chain marking the structural rift axis. The cones were used in the 19th century as navigation landmarks by ships entering the Strait of Messina.",
  },
  {
    name: 'Monte Frumento Supino', kicker: 'Parasitic Cone', theme: 'vent', x: -0.7, z: 2.6, lod: 4,
    meta: '37.732°N  14.995°E  ·  NW rift  ·  1974 eruption  ·  ~2,300 m asl',
    description: "NW rift zone cone formed during the brief but geochemically unusual 1974 eruption. The 1974 event produced unusually CO₂-rich, strongly degassed lava with a primitive composition — interpreted as direct rapid ascent from depth that bypassed the summit storage system. This implied the existence of a separate shallow NW rift magma pathway independent of the main plumbing system beneath the summit.",
  },
  {
    name: 'Monte Spagnolo', kicker: 'Ancient Cone', theme: 'vent', x: -4.4, z: -3.2, lod: 4,
    meta: '37.784°N  14.953°E  ·  NW flank  ·  Ellittico-age  ·  ~2,100 m asl',
    description: "Well-preserved ancient cone on the NW flank, erupted during the Ellittico phase of Etna's activity (~15,000–35,000 yr BP). Predates the current Mongibello volcanic episode and represents NW rift zone activity from an earlier eruptive cycle. The cone's relatively intact morphology indicates it has not been overridden by younger flows — making it a useful stratigraphic reference for correlating the NW flank succession.",
  },
  {
    name: 'Cisternazza', kicker: 'Pit Crater', theme: 'vent', x: 0.4, z: 3.4, lod: 4,
    meta: 'Upper S flank  ·  ~2,500 m asl  ·  Piano del Lago area',
    description: "Collapse pit crater on the upper S flank near Piano del Lago. Unlike the typical scoria cone, the Cisternazza formed purely by collapse of the surface above a degassing magma body — there is no eruptive cone. Near-continuous CO₂ and SO₂ emission from the pit floor is monitored by INGV sensors. The feature provides a direct window into the shallow degassing column beneath the southern slope of the summit edifice.",
  },

  // ── Additional eruptions / fissure zones ─────────────────────────────────────
  {
    name: '1669 Lava Flow Field', kicker: 'Historic Lava Field', theme: 'fissure', x: 4.5, z: 27.1, lod: 2,
    meta: 'Mar – Jul 1669  ·  S flank  ·  ~15 km  ·  ~1 km³',
    description: "The lava flow field of Etna's most catastrophic historical eruption covers ~40 km² of the S flank. The flows buried more than 15 villages, breached Catania's medieval city walls, and extended the Sicilian coastline 1 km into the sea — the new promontory (Punta Lena) is still visible. Eruption lasted 122 days and ejected an estimated 1 km³ of lava. The flow field is still largely unburied and visible as a dark hummocky surface from the air, cutting across older agricultural terraces.",
  },
  {
    name: '1928 Eruption', kicker: 'NE Flank Eruption', theme: 'fissure', x: 13.8, z: -2.0, lod: 2,
    meta: '37.773°N  15.160°E  ·  2–20 Nov 1928  ·  NE flank  ·  ~8 km flow',
    description: "NE flank fissure eruption producing one of the 20th century's most destructive Etna events. Lava advanced at speed, burying the town of Mascali within 48 hours. The eruption was exploited by Mussolini's government as a propaganda opportunity — newsreels showed state officials 'commanding' the failed diversion effort. Total volume ~20 million m³. The 1928 flow field is still largely exposed on the NE flank between Rifugio Citelli and Mascali.",
  },
  {
    name: '1981 NW Eruption', kicker: 'Fissure Zone', theme: 'fissure', x: -2.5, z: -22.8, lod: 3,
    meta: '17–23 March 1981  ·  NW flank  ·  8 km in 6 hours',
    description: "NW flank fissure eruption producing the fastest lava advance in Etna's modern record. Lava descended the Valle del Leone at up to 30 m/min, covering 8 km in approximately 6 hours on the first day, threatening Randazzo. The unusually rapid advance resulted from the steep NW flank gradient and high simultaneous effusion rates from multiple fissure vents. The eruption lasted seven days, depositing a ~12 km² lava field on the NW flank.",
  },
  {
    name: '1971 Eruption', kicker: 'Fissure Zone', theme: 'fissure', x: 7.4, z: 0.3, lod: 3,
    meta: '5 Apr – 12 Jun 1971  ·  SE cone & Valle del Bove wall  ·  1,800–3,000 m',
    description: "Eruption along a SW-NE fissure system running from the SE flank of the summit cone across the W wall of Valle del Bove down to 1,800 m. Opening these fissures permanently created the SE Crater at ~3,000 m — now Etna's most active vent. Lava flows destroyed the E. Gemmellaro volcanological observatory and reached 1,675 m in Valle del Bove. The eruption was the first significant flank event in 20 years and established the SE sector as the dominant eruptive axis.",
  },
  {
    name: '2013 Paroxysm Series', kicker: 'Lava Fountain Series', theme: 'fissure', x: 0.0, z: 1.2, lod: 4,
    meta: 'Jan – Nov 2013  ·  New SE Crater  ·  19 paroxysms',
    description: "The most prolific single-year lava fountain series in Etna's documented record. The New SE Crater produced 19 discrete paroxysmal episodes in 2013, with fountain jets reaching up to 1 km height and tephra depositing up to 5 cm of lapilli at distances up to 20 km downwind. The sequence drove rapid cone growth and solidified the New SE Crater's position as Etna's dominant active vent. Each paroxysm was preceded by a characteristic infrasound and tremor signature now used for real-time eruption forecasting.",
  },
  {
    name: '2014–15 Eruption', kicker: 'Effusive Eruption', theme: 'fissure', x: 2.8, z: 3.2, lod: 4,
    meta: 'Aug 2014 – May 2015  ·  SE flank  ·  upper Valle del Bove',
    description: "Prolonged effusive eruption from the SE flank depositing lava into the upper Valle del Bove, sustained by near-continuous magma supply from the summit reservoir. The period saw rapid cone growth at the New SE Crater through repeated short-duration lava fountain episodes interspersed with effusive phases. The 2014–15 eruption was notable for producing some of the highest SO₂ flux values recorded at Etna — a proxy indicator of deep magma supply rate.",
  },
  {
    name: '2006 Eruption', kicker: 'Fissure Zone', theme: 'fissure', x: -0.1, z: 0.8, lod: 5,
    meta: 'Jul – Dec 2006  ·  SE Crater  ·  SE flank',
    description: "Extended eruption episode centred on the SE Crater, with alternating phases of lava fountaining and effusive activity across nearly six months. Lava flows were emplaced into the Valle del Bove. The eruption demonstrated the characteristic SE Crater behaviour of the 2000s: high-intensity fountain episodes driven by sudden decompression of volatile-rich magma batches, alternating with quieter effusive phases from a partially degassed reservoir.",
  },
  {
    name: '2018 Fleri Rupture', kicker: 'Surface Rupture', theme: 'fault', x: 8.4, z: 10.8, lod: 5,
    meta: '26 Dec 2018  ·  Mw 4.9  ·  SE flank  ·  Fleri',
    description: "Christmas Day 2018 earthquake — the most damaging flank event at Etna in at least three decades. The Mw 4.9 rupture produced visible surface breaks near Fleri, damaging or destroying over 1,000 homes and injuring 28 people. The event occurred during summit eruption activity, highlighting the mechanical coupling between magmatic pressurisation and flank fault instability. The rupture was triggered by co-eruptive dyke intrusion loading the shallow SE flank fault system.",
  },

  // ── Additional general features ───────────────────────────────────────────────
  {
    name: 'Rifugio Citelli', kicker: 'Mountain Refuge', theme: 'general', x: 4.9, z: -0.9, lod: 2,
    meta: '37.763°N  15.059°E  ·  1,741 m asl  ·  NE flank',
    description: "INGV-operated mountain refuge on the NE flank at 1,741 m — the principal trailhead for the NE summit route from Piano Provenzana. Houses an INGV monitoring station with broadband seismometers and tilt meters. The 2002 eruption fissures opened ~500 m to the NW and lava passed on both sides, but the building itself survived. The terrace commands a view of the full NE rift zone cone chain descending from the summit toward the coast.",
  },
  {
    name: 'Torre del Filosofo', kicker: 'Historic Ruins', theme: 'general', x: -0.3, z: 2.4, lod: 3,
    meta: '37.733°N  15.000°E  ·  ~2,920 m asl  ·  S summit slope',
    description: "Ruins of a Roman-era structure at ~2,920 m on the S summit slope — one of the highest surviving Roman ruins in Europe. Traditionally identified with the watchtower or observatory visited by the Emperor Hadrian in 125 AD. Legend associates the site with the philosopher Empedocles, said to have leapt into Etna's crater (c.430 BC). The ruins were partially buried by 2001 lava flows and are now a waypoint on the S summit ascent route.",
  },
  {
    name: 'Laghetti di Gurrida', kicker: 'Volcanic Lake', theme: 'general', x: -9.0, z: -11.0, lod: 3,
    meta: '37.854°N  14.900°E  ·  W flank  ·  ~700 m asl',
    description: "Shallow lava-dammed lake on Etna's W flank, formed where a historical basaltic flow blocked the natural drainage of a Simeto River headwater tributary. One of very few natural wetlands on the volcanic edifice. Designated as an EU Habitats Directive SPA for migrant waterbird habitat. The lakebed's volcanic substrate produces a naturally mineralised water chemistry distinct from typical Sicilian freshwater, supporting a specialised endemic invertebrate fauna.",
  },
  {
    name: 'Osservatorio Etneo', kicker: 'INGV Observatory', theme: 'general', x: 6.9, z: 26.8, lod: 3,
    meta: '37.514°N  15.082°E  ·  Catania  ·  INGV headquarters',
    description: "Headquarters of the INGV Osservatorio Etneo — the primary institution responsible for monitoring Etna and all volcanic and seismic activity across Sicily. Operates a network of over 60 broadband seismometers, GNSS geodetic stations, infrasound arrays, SO₂ flux scanners, and thermal cameras distributed across the edifice. Issues real-time volcanic activity bulletins and coordinates with Italian Civil Protection during eruptive crises. The building is located in the Catania metropolitan area, 28 km south of the summit.",
  },
  {
    name: 'Monte Zoccolaro', kicker: 'Valle del Bove Rim', theme: 'general', x: 4.7, z: 4.9, lod: 4,
    meta: '37.711°N  15.056°E  ·  NE rim  ·  ~1,720 m asl',
    description: "Prominent peak on the NE rim of the Valle del Bove at 1,720 m. A recognised viewpoint on the E flank trekking circuit offering panoramic views into the 8 km-wide depression and across the Ionian coastline. During SE crater eruptions, lava flows descending into the Valle del Bove can be observed from here. The rim exposes a partial cross-section of stacked Mongibello-age lavas and scoria beds representing ~10,000 years of E flank accumulation.",
  },
  {
    name: "Schiena dell'Asino", kicker: 'Valle del Bove Ridge', theme: 'general', x: 3.5, z: 5.2, lod: 4,
    meta: '37.708°N  15.043°E  ·  SE rim  ·  ~1,600 m asl',
    description: "Elongated SE rim ridge of the Valle del Bove — the name means 'donkey's back', describing its characteristic profile. Acts as a partial topographic barrier deflecting lava flows from the SE crater complex, channelling them either into the Valle del Bove floor or across the S flank toward Zafferana. The ridge was approached but not overridden during the 1991–93 lava emergency — the decision to drill a diversion tunnel was made partly to protect this natural flow barrier.",
  },
  {
    name: 'Punta Lucia', kicker: 'NW Summit Ridge', theme: 'general', x: -1.4, z: -0.6, lod: 4,
    meta: '37.760°N  14.987°E  ·  NW flank  ·  ~2,500 m asl',
    description: "Prominent topographic feature on the upper NW flank of Etna, north-west of the summit crater complex at ~2,500 m. Sits on the NW rift zone axis, a structural corridor of preferential dyke injection that has channelled several historical eruptions including 1974 and 1981. The ridge provides a reference point on the NW summit trekking circuit and offers a panoramic view across the Bronte plateau and Nebrodi mountains to the west.",
  },
  {
    name: 'Monte Simone', kicker: 'Valle del Bove Ridge', theme: 'general', x: 3.0, z: 0.3, lod: 5,
    meta: '37.752°N  15.037°E  ·  E flank  ·  ~1,580 m asl',
    description: "Secondary S rim feature of the Valle del Bove between Punta Lucia and Schiena dell'Asino. The 1985 SE flank lava flows were partly deflected by this ridge. Forms part of the continuous S rim crest separating the Valle del Bove floor from the Zafferana Etnea agricultural plain on the lower SE flank. The ridge and surroundings fall within the Parco dell'Etna protected natural area.",
  },
  {
    name: 'Serra delle Concazze', kicker: 'Geological Section', theme: 'general', x: 3.5, z: -0.1, lod: 5,
    meta: '37.756°N  15.043°E  ·  E flank  ·  ~1,500 m asl',
    description: "N flank cliff exposure where layered basaltic lava flows and intercalated scoria beds provide a continuous stratigraphic section of N flank accumulation over several thousand years. Used by volcanologists to correlate N flank eruption sequences with the Etna summit eruption record. The section also shows distinct palaeosol horizons between flow units — representing centuries-long volcanic quiescence between eruptions — and is a reference locality for Etna Holocene chronostratigraphy.",
  },

  // ── Fluvial features ──────────────────────────────────────────────────────────
  {
    name: 'Alcantara River', kicker: 'River', theme: 'hydro', x: 16.3, z: -13.1, lod: 2,
    meta: '37.873°N  15.189°E  ·  NE domain  ·  Ionian drainage',
    description: "The Alcantara (from Arabic al-qantarah, 'the bridge') drains Etna's NE flank and flows east to the Ionian Sea near Giardini-Naxos. The river has incised a spectacular gorge through ancient columnar-jointed basalt at the Gole dell'Alcantara — hexagonal columns formed by slow, uniform cooling of a lava flow that ponded in the valley floor. The gorge walls expose a cross-section of successive lava flows from different eruptions, making it one of the most accessible geological sections on the Etna edifice. The Alcantara basin also forms the northern structural boundary of the volcanic domain, separating Etna's lavas from the Peloritani metamorphic basement to the north.",
  },
];

// ─── Canvas pill texture — identical to Mars viewer ──────────────────────────

export function makeLabelTexture(name, theme = 'general', options = {}) {
  const pal          = THEME_PALETTE[theme] || THEME_PALETTE.general;
  const canvas       = document.createElement('canvas');
  const ctx          = canvas.getContext('2d');
  const backingScale = options.backingScale ?? 2;
  const paddingX     = 14;
  const accentWidth  = 6;
  const bodyLeft     = paddingX + accentWidth + 7;
  const titleFont    = "600 15px Orbitron, 'Exo 2', Aldrich, 'Trebuchet MS', sans-serif";
  ctx.font = titleFont;
  const textWidth    = Math.ceil(ctx.measureText(name).width);
  const logicalW     = Math.max(110, textWidth + bodyLeft + paddingX);
  const logicalH     = 34;
  canvas.width       = logicalW * backingScale;
  canvas.height      = logicalH * backingScale;
  ctx.scale(backingScale, backingScale);

  // Background + border
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = pal.bg;
  ctx.strokeStyle  = pal.stroke;
  ctx.lineWidth    = 1.6;
  const rad = 14;
  ctx.beginPath();
  ctx.moveTo(rad, 1);
  ctx.lineTo(logicalW - rad, 1);
  ctx.quadraticCurveTo(logicalW - 1, 1, logicalW - 1, rad);
  ctx.lineTo(logicalW - 1, logicalH - rad - 1);
  ctx.quadraticCurveTo(logicalW - 1, logicalH - 1, logicalW - rad, logicalH - 1);
  ctx.lineTo(rad, logicalH - 1);
  ctx.quadraticCurveTo(1, logicalH - 1, 1, logicalH - rad);
  ctx.lineTo(1, rad);
  ctx.quadraticCurveTo(1, 1, rad, 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Left accent bar
  ctx.fillStyle = pal.accent;
  ctx.beginPath();
  ctx.moveTo(rad + 1, 4);
  ctx.lineTo(rad + accentWidth, 4);
  ctx.lineTo(rad + accentWidth, logicalH - 4);
  ctx.lineTo(rad + 1, logicalH - 4);
  ctx.closePath();
  ctx.fill();

  // Label text
  ctx.font      = titleFont;
  ctx.fillStyle = pal.title;
  ctx.fillText(name, bodyLeft, logicalH / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace         = THREE.SRGBColorSpace;
  texture.generateMipmaps    = true;
  texture.minFilter          = THREE.LinearMipmapLinearFilter;
  texture.magFilter          = THREE.LinearFilter;
  texture.needsUpdate        = true;
  // Release the CPU canvas backing store after the first GPU upload
  texture.onUpdate = () => { texture.image = null; texture.onUpdate = null; };
  return { texture, width: logicalW, height: logicalH };
}

// ─── Build label layer ────────────────────────────────────────────────────────

// Shared geometries (created once, reused across all markers)
// Marker radius 0.06 km — pixel size controlled per-frame in the update loop
const _markerGeo   = new THREE.SphereGeometry(0.06, 8, 6);
const _MARKER_RADIUS = 0.06; // must match _markerGeo radius
const _hitGeo      = new THREE.SphereGeometry(0.90, 12, 12);
const _hitMat      = new THREE.MeshBasicMaterial({
  transparent: true, opacity: 0, depthTest: false, depthWrite: false,
});

// Base sprite scale — world-unit size stored on each entry as baseScale.
const BASE_SCALE = 0.66;   // world units for a 200-px-wide texture (same as Mars)
const LABEL_LIFT = 2.5;    // km above the surface dot
const _HNORM_EPS = 0.5;    // km finite-difference step for terrain normal

// Zoom-responsive pixel targets — grow as camera gets closer.
// At global view (~30 km) labels are smaller; at close zoom (<1 km) they are larger.
const LABEL_PX_GLOBAL = 15;   // px height at global view
const LABEL_PX_CLOSE  = 34;   // px height at maximum zoom-in
const DOT_PX_GLOBAL   = 2.5;  // px radius at global view
const DOT_PX_CLOSE    = 6.0;  // px radius at maximum zoom-in
const ZOOM_DIST_REF   = 30;   // km: distance below which zoom-in scaling kicks in

// LOD tier scale: larger lod number → slightly smaller label (same as Mars)
const _LOD_TIER_SCALE = [1.0, 1.0, 0.84, 0.70, 0.60, 0.52];

export function buildEtnaLabelLayer(scene, sampleHeight) {
  const group             = new THREE.Group();
  const entries           = [];
  const interactiveObjects = [];

  for (const item of ETNA_POIS) {
    const pal    = THEME_PALETTE[item.theme] || THEME_PALETTE.general;
    const surfY  = sampleHeight(item.x, item.z);
    const mPos   = new THREE.Vector3(item.x, surfY,            item.z);
    const sPos   = new THREE.Vector3(item.x, surfY + LABEL_LIFT, item.z);

    // ── Surface dot ──────────────────────────────────────────────────────────
    const marker = new THREE.Mesh(_markerGeo, new THREE.MeshBasicMaterial({
      color: pal.markerColor, transparent: true, opacity: 0.92,
      depthTest: true, depthWrite: false,
    }));
    marker.position.copy(mPos);
    marker.renderOrder      = 200;
    marker.userData.feature = item;
    group.add(marker);

    // ── Invisible hit sphere (easier to click than the tiny dot) ─────────────
    const hit = new THREE.Mesh(_hitGeo, _hitMat);
    hit.position.copy(mPos);
    hit.renderOrder      = 202;
    hit.userData.feature = item;
    group.add(hit);

    // ── Canvas pill sprite ────────────────────────────────────────────────────
    const { texture, width: tw, height: th } = makeLabelTexture(item.name, item.theme);
    const sprMat  = new THREE.SpriteMaterial({
      map: texture, transparent: true, opacity: pal.spriteOpacity,
      depthTest: true, depthWrite: false,
    });
    const sprite = new THREE.Sprite(sprMat);
    const bsX = (tw / 200) * BASE_SCALE;
    const bsY = (th / 200) * BASE_SCALE;
    sprite.scale.set(bsX, bsY, 1);
    sprite.renderOrder      = 201;
    sprite.position.copy(sPos);
    sprite.userData.feature = item;
    group.add(sprite);
    const baseScale = new THREE.Vector2(bsX, bsY);

    // ── Connector line ────────────────────────────────────────────────────────
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([mPos.clone(), sPos.clone()]),
      new THREE.LineBasicMaterial({
        color: pal.lineColor, transparent: true, opacity: 0.42,
        depthTest: true, depthWrite: false,
      }),
    );
    line.renderOrder    = 199;
    line.frustumCulled  = false;
    group.add(line);

    // Pre-compute terrain normal via finite differences on the height grid (O(1) per frame)
    const dX = (sampleHeight(item.x + _HNORM_EPS, item.z) - sampleHeight(item.x - _HNORM_EPS, item.z)) / (2 * _HNORM_EPS);
    const dZ = (sampleHeight(item.x, item.z + _HNORM_EPS) - sampleHeight(item.x, item.z - _HNORM_EPS)) / (2 * _HNORM_EPS);
    const terrainNormal = new THREE.Vector3(-dX, 1, -dZ).normalize();

    interactiveObjects.push(hit, marker, sprite);
    entries.push({
      item, marker, hit, sprite, line,
      mPos: mPos.clone(), sPos: sPos.clone(),
      _baseY: surfY, terrainNormal, baseScale,
    });
  }

  // Selection ring — warm gold sphere placed on the active marker, pulsed from viewer animate loop
  const selectionRing = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthTest: true, depthWrite: false }),
  );
  selectionRing.renderOrder = 203;
  selectionRing.visible = false;
  group.add(selectionRing);

  scene.add(group);
  return { group, entries, interactiveObjects, selectionRing };
}

// ─── Per-frame visibility update ──────────────────────────────────────────────

// Module-level reusable vectors — avoids per-frame allocations
const _ray      = new THREE.Raycaster();
const _tempM    = new THREE.Vector3();
const _tempS    = new THREE.Vector3();
const _lineP1   = new THREE.Vector3();
const _toPoint  = new THREE.Vector3();
const _toCam    = new THREE.Vector3();
const _camRight = new THREE.Vector3(); // camera screen-right direction, set once per frame

/**
 * @param {object} categoryEnabled  { settlement, fault, vent, fissure, general }
 * @param {object|null} activePopupFeature  currently open feature (always shown)
 * @param {number} currentLodLevel  1–5 density slider value; items with lod > level are hidden
 */
export function updateEtnaLabelVisibility(
  entries, camera, renderer, surfaceMesh, domainBox,
  crossSectionEnabled, clipPlane,
  categoryEnabled,
  activePopupFeature,
  currentLodLevel = 3,
) {
  const vw = renderer.domElement.clientWidth  || window.innerWidth;
  const vh = renderer.domElement.clientHeight || window.innerHeight;
  const fovScale = vh / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));

  // Only the domain box (12 triangles) goes into the occluder list.
  // Terrain self-occlusion is handled per-entry via the pre-computed terrainNormal dot product.
  const occluders = [];
  if (domainBox && domainBox.visible) occluders.push(domainBox);

  const occupiedRects = [];
  const candidates    = [];

  // Camera screen-right vector in world space — used for nudging repositioned labels
  _camRight.setFromMatrixColumn(camera.matrixWorld, 0);

  // Phase 1 — cull, scale, animate, and position each entry
  for (const entry of entries) {
    entry.marker.visible = false;
    entry.hit.visible    = false;
    entry.sprite.visible = false;
    entry.line.visible   = false;

    if (!(categoryEnabled[entry.item.theme] ?? true)) continue;
    if (entry.item.lod != null && entry.item.lod > currentLodLevel) continue;
    if (crossSectionEnabled && clipPlane && clipPlane.distanceToPoint(entry.mPos) < 0) continue;

    // Marker behind-camera check
    _tempM.copy(entry.mPos).project(camera);
    if (_tempM.z > 1) continue;

    // Terrain self-occlusion (O(1) dot-product against the pre-baked terrain normal)
    _toPoint.subVectors(entry.mPos, camera.position);
    const dist = _toPoint.length();
    _toCam.copy(_toPoint).multiplyScalar(-1 / dist);
    if (entry.terrainNormal.dot(_toCam) < 0.04) continue;

    // Domain box occlusion (cheap — only 12 triangles)
    _ray.set(camera.position, _toPoint.multiplyScalar(1 / dist));
    _ray.near = 0;
    _ray.far  = dist * 0.95;
    if (occluders.length && _ray.intersectObjects(occluders, true).length > 0) continue;

    entry.marker.visible = true;
    entry.hit.visible    = true;

    // ── Zoom-responsive pixel sizing ──────────────────────────────────────────
    // zf = 0 at global view (dist >= ZOOM_DIST_REF), = 1 at maximum zoom-in.
    // Both labels and dots grow in screen pixels as the camera gets closer,
    // giving a natural "loupe" feel that matches other GeoID viewers.
    const ppu = fovScale / Math.max(dist, 0.001);
    const zf  = 1 - THREE.MathUtils.clamp(dist / ZOOM_DIST_REF, 0, 1);
    const lodTier = _LOD_TIER_SCALE[entry.item.lod] ?? 1.0;

    const isPinned = Boolean(activePopupFeature && entry.item.name === activePopupFeature.name);

    // ── Label sprite size (zoom-responsive, no per-frame animation — viewer handles pulse) ─
    const targetPx   = (LABEL_PX_GLOBAL + zf * (LABEL_PX_CLOSE - LABEL_PX_GLOBAL)) * lodTier;
    const labelScale = targetPx / Math.max(entry.baseScale.y * ppu, 1e-6);
    entry.sprite.scale.set(
      entry.baseScale.x * labelScale,
      entry.baseScale.y * labelScale,
      1,
    );

    // ── Marker dot size (zoom-responsive only; colour/ring animation in viewer) ─
    const dotTargetPx = (DOT_PX_GLOBAL + zf * (DOT_PX_CLOSE - DOT_PX_GLOBAL)) * lodTier;
    entry.marker.scale.setScalar(dotTargetPx / Math.max(_MARKER_RADIUS * ppu, 1e-6));

    // ── Sprite world position — adaptive lift keeps line length constant in pixels ─
    // lift = LABEL_LIFT * (dist / ZOOM_DIST_REF), so lift × ppu ≈ constant:
    //   line_px ≈ LABEL_LIFT × fovScale / ZOOM_DIST_REF at every zoom level.
    // This gives a smooth, proportional connector that never jumps.
    const adaptiveLift = LABEL_LIFT * THREE.MathUtils.clamp(dist / ZOOM_DIST_REF, 0.03, 1.0);
    const aSY = entry.mPos.y + adaptiveLift;
    entry.sprite.position.set(entry.mPos.x, aSY, entry.mPos.z);
    _tempS.copy(entry.sprite.position).project(camera);

    // Marker screen position (already projected in _tempM above)
    const msx = ((_tempM.x + 1) * 0.5) * vw;
    const msy = ((1 - _tempM.y) * 0.5) * vh;

    const spriteBehind = _tempS.z > 1;
    let sx = spriteBehind ? msx : ((_tempS.x + 1) * 0.5) * vw;
    let sy = spriteBehind ? msy : ((1 - _tempS.y) * 0.5) * vh;
    const spriteOffScreen = spriteBehind || sx < -10 || sx > vw + 10 || sy < -10 || sy > vh + 10;

    if (spriteOffScreen) {
      // Fallback only: sprite is literally off-screen — nudge beside the dot
      if (msx < -20 || msx > vw + 20 || msy < -20 || msy > vh + 20) continue;

      const labelWidthPx = entry.sprite.scale.x * ppu;
      const nudgePx  = Math.max(14, labelWidthPx * 0.55);
      const nudgeDir = (msx + nudgePx < vw - 14) ? 1 : -1;
      const worldPerPx = dist / fovScale;

      _lineP1.copy(entry.mPos).addScaledVector(_camRight, nudgeDir * nudgePx * worldPerPx);
      entry.sprite.position.copy(_lineP1);

      _tempS.copy(_lineP1).project(camera);
      sx = ((_tempS.x + 1) * 0.5) * vw;
      sy = ((1 - _tempS.y) * 0.5) * vh;
    } else {
      _lineP1.set(entry.mPos.x, aSY, entry.mPos.z);
    }

    // Update connector line endpoints every frame (covers repositioning + vert-exag)
    const posAttr = entry.line.geometry.attributes.position;
    posAttr.setXYZ(0, entry.mPos.x, entry.mPos.y, entry.mPos.z);
    posAttr.setXYZ(1, _lineP1.x,    _lineP1.y,    _lineP1.z);
    posAttr.needsUpdate = true;

    const hw = entry.sprite.scale.x * ppu * 0.5;
    const hh = entry.sprite.scale.y * ppu * 0.5;

    candidates.push({
      entry, isPinned, camDist: dist,
      rect: { left: sx - hw, right: sx + hw, top: sy - hh, bottom: sy + hh },
    });
  }

  // Phase 2 — overlap rejection: nearest wins; pinned (popup-open) always shown
  candidates.sort((a, b) =>
    a.isPinned !== b.isPinned ? (a.isPinned ? -1 : 1) : a.camDist - b.camDist,
  );

  for (const { entry, isPinned, rect } of candidates) {
    const overlaps = occupiedRects.some(r =>
      rect.left - 2 < r.right  && rect.right  + 2 > r.left &&
      rect.top  - 2 < r.bottom && rect.bottom + 2 > r.top,
    );
    if (overlaps && !isPinned) continue;
    entry.sprite.visible = true;
    entry.line.visible   = true;
    occupiedRects.push(rect);
  }
}

// ─── Vertical exaggeration update ────────────────────────────────────────────

export function applyEtnaLabelVertExag(entries, factor) {
  for (const entry of entries) {
    const newY = entry._baseY * factor;
    const sY   = newY + LABEL_LIFT;   // LIFT is absolute, not scaled

    entry.mPos.y = newY;
    entry.sPos.y = sY;

    entry.marker.position.y = newY;
    entry.hit.position.y    = newY;
    entry.sprite.position.y = sY;

    const posAttr = entry.line.geometry.attributes.position;
    posAttr.setY(0, newY);
    posAttr.setY(1, sY);
    posAttr.needsUpdate = true;
    entry.line.geometry.computeBoundingSphere();
  }
}
