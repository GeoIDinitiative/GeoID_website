// The systems this build of the game runs. One import per system; each module
// registers itself with systems.js when imported. Order here does not matter
// (each system declares its own `order`).
//
// Add a line; do not edit anyone else's.
import {} from "./weather.js?v=6d37c9c-9b39e129";
import {} from "./thermal.js?v=6d37c9c-9b39e129";
import {} from "./hazards.js?v=6d37c9c-9b39e129";
import {} from "./builder.js?v=6d37c9c-9b39e129";      // the base builder (written with `from` so tools/stamp.py stamps it)
import {} from "./avatar.js?v=6d37c9c-9b39e129";      // (written with `from` so tools/stamp.py stamps the URL: eva.js and launcher.js import these modules too)
import {} from "./eva.js?v=6d37c9c-9b39e129";
import {} from "./missions.js?v=6d37c9c-9b39e129";
import {} from "./wheelfx.js?v=6d37c9c-9b39e129";      // wheel dust and tracks
import {} from "./navmap.js?v=6d37c9c-9b39e129";      // the corner map and the 360° compass (written with `from` so tools/stamp.py stamps it)
import {} from "./audio.js?v=6d37c9c-9b39e129";           // sound: procedural Web Audio, the voice bus (written with `from` so tools/stamp.py stamps it)
import {} from "./progress.js?v=6d37c9c-9b39e129";      // progression and customisation: contribution credit, Kestrel hardware, designs, the Workshop (written with `from` so tools/stamp.py stamps it)
import {} from "./padhost.js?v=6d37c9c-9b39e129";      // the controller vs the desktop pointer: the mapper hands the sticks to the game while playing (written with `from` so tools/stamp.py stamps it)
import {} from "./halo.js?v=6d37c9c-9b39e129";         // HALO-1: the station, care packages and their descent (story campaign)
import {} from "./actors.js?v=6d37c9c-9b39e129";       // animated people (charrig.js): caretakers, RECALL, anyone a system needs (written with `from` so tools/stamp.py stamps it)
import {} from "./caretakers.js?v=6d37c9c-9b39e129";   // the construction units: crews, barks, the Echo (story campaign)
import {} from "./tiers.js?v=6d37c9c-9b39e129";        // base tiers, planned structures, the city, the sky turning blue (story campaign)
import {} from "./story.js?v=6d37c9c-9b39e129";        // the story engine: missions, cutscenes, KEEPER, endings (story/*.json)
