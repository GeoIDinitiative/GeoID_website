// The systems this build of the game runs. One import per system; each module
// registers itself with systems.js when imported. Order here does not matter
// (each system declares its own `order`).
//
// Add a line; do not edit anyone else's.
import {} from "./weather.js?v=b8cfe8e-efa5b7b7";
import {} from "./thermal.js?v=b8cfe8e-efa5b7b7";
import {} from "./hazards.js?v=b8cfe8e-efa5b7b7";
import {} from "./builder.js?v=b8cfe8e-efa5b7b7";      // the base builder (written with `from` so tools/stamp.py stamps it)
import {} from "./avatar.js?v=b8cfe8e-efa5b7b7";      // (written with `from` so tools/stamp.py stamps the URL: eva.js and launcher.js import these modules too)
import {} from "./eva.js?v=b8cfe8e-efa5b7b7";
import {} from "./missions.js?v=b8cfe8e-efa5b7b7";
import {} from "./wheelfx.js?v=b8cfe8e-efa5b7b7";      // wheel dust and tracks
import {} from "./navmap.js?v=b8cfe8e-efa5b7b7";      // the corner map and the 360° compass (written with `from` so tools/stamp.py stamps it)
import {} from "./audio.js?v=b8cfe8e-efa5b7b7";           // sound: procedural Web Audio, the voice bus (written with `from` so tools/stamp.py stamps it)
import {} from "./progress.js?v=b8cfe8e-efa5b7b7";      // progression and customisation: contribution credit, Kestrel hardware, designs, the Workshop (written with `from` so tools/stamp.py stamps it)
import {} from "./padhost.js?v=b8cfe8e-efa5b7b7";      // the controller vs the desktop pointer: the mapper hands the sticks to the game while playing (written with `from` so tools/stamp.py stamps it)
import {} from "./halo.js?v=b8cfe8e-efa5b7b7";         // HALO-1: the station, care packages and their descent (story campaign)
import {} from "./caretakers.js?v=b8cfe8e-efa5b7b7";   // the construction units: crews, barks, the Echo (story campaign)
import {} from "./tiers.js?v=b8cfe8e-efa5b7b7";        // base tiers, planned structures, the city, the sky turning blue (story campaign)
import {} from "./story.js?v=b8cfe8e-efa5b7b7";        // the story engine: missions, cutscenes, KEEPER, endings (story/*.json)
