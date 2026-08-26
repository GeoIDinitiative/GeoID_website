#!/usr/bin/env node
/**
 * The dataset→label translation, which is now this module's whole behaviour.
 *
 * The drawing, the spacing and the click path all belong to the viewer's own
 * label engine — a parallel implementation was tried and looked like a
 * different app bolted onto this one. What this module still OWNS is the
 * mapping from a GeoJSON feature to the item shape that engine reads, and the
 * mapping is a contract: `type` becomes the card's kicker, `description` its
 * copy, `priority` the LOD rank, `category: "dataset"` the clause that frees
 * these labels from the Locations checkboxes. A renamed field here is a card
 * with no text and no error anywhere.
 */

import { toLabelItems, canLabel } from "./point-labels.js";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const volcano = (name, rank, extra = {}) => ({
  geometry: { type: "Point", coordinates: [14.99, 37.75] },
  properties: {
    name,
    label_rank: rank,
    volcano_type: "Stratovolcano",
    type_group: "Stratovolcano",
    summary: `${name} is a volcano.`,
    elevation_m: 3357,
    rock_type: "Basalt",
    region: "Mediterranean",
    ...extra,
  },
});

{
  const [item] = toLabelItems([volcano("Etna", 5)]);
  check("the item speaks the viewer's field names",
    item.name === "Etna" && item.type === "Stratovolcano"
    && item.description === "Etna is a volcano." && item.elevation_m === 3357
    && item.lat === 37.75 && item.lon === 14.99,
    JSON.stringify(item));
  check("rank becomes the LOD priority", item.priority === 5);
  check("and a size, larger for higher rank",
    item.label_scale > toLabelItems([volcano("X", 1)])[0].label_scale);
  check("dataset labels are their own category, free of the Locations toggles",
    item.category === "dataset");
  check("with the volcanic theme's look", item.theme === "volcanic");
  check("the card's detail rows travel too",
    item.rock_type === "Basalt" && item.region === "Mediterranean");
}

check("rank 0 is not a label", toLabelItems([volcano("Quiet", 0)]).length === 0,
  "1,452 Pleistocene volcanoes carry rank 0 and stay off the globe");
check("no name, no label",
  toLabelItems([volcano("", 5)]).length === 0);
check("no features is an empty answer, not a crash",
  toLabelItems([]).length === 0 && toLabelItems(null).length === 0);

{
  // The cap keeps the most significant: rank first, recency second.
  const crowd = [
    volcano("Old-5", 5, { last_eruption: 1500 }),
    volcano("New-5", 5, { last_eruption: 2020 }),
    volcano("New-4", 4, { last_eruption: 2024 }),
  ];
  const kept = toLabelItems(crowd, { max: 2 }).map((i) => i.name);
  check("the cap keeps rank over recency", !kept.includes("New-4"), kept.join(", "));
  check("and recency within a rank", kept[0] === "New-5", kept.join(", "));
}

{
  const many = Array.from({ length: 400 }, (_, i) => volcano(`V${i}`, 5));
  check("the cap is a cap", toLabelItems(many, { max: 250 }).length === 250);
}

check("canLabel asks for the rank column and nothing else",
  canLabel({ features: [volcano("Etna", 3)] }) === true
  && canLabel({ features: [volcano("Quiet", 0)] }) === false
  && canLabel({ features: [] }) === false
  && canLabel(null) === false);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
