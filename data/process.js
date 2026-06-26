const fs = require("fs");

// Canonical proper-case names for Chicago's 77 community areas, keyed by the
// official area number. Handles apostrophes/casing the raw ALL-CAPS data loses.
const NAMES = {
  1:"Rogers Park",2:"West Ridge",3:"Uptown",4:"Lincoln Square",5:"North Center",
  6:"Lake View",7:"Lincoln Park",8:"Near North Side",9:"Edison Park",10:"Norwood Park",
  11:"Jefferson Park",12:"Forest Glen",13:"North Park",14:"Albany Park",15:"Portage Park",
  16:"Irving Park",17:"Dunning",18:"Montclare",19:"Belmont Cragin",20:"Hermosa",
  21:"Avondale",22:"Logan Square",23:"Humboldt Park",24:"West Town",25:"Austin",
  26:"West Garfield Park",27:"East Garfield Park",28:"Near West Side",29:"North Lawndale",
  30:"South Lawndale",31:"Lower West Side",32:"Loop",33:"Near South Side",34:"Armour Square",
  35:"Douglas",36:"Oakland",37:"Fuller Park",38:"Grand Boulevard",39:"Kenwood",
  40:"Washington Park",41:"Hyde Park",42:"Woodlawn",43:"South Shore",44:"Chatham",
  45:"Avalon Park",46:"South Chicago",47:"Burnside",48:"Calumet Heights",49:"Roseland",
  50:"Pullman",51:"South Deering",52:"East Side",53:"West Pullman",54:"Riverdale",
  55:"Hegewisch",56:"Garfield Ridge",57:"Archer Heights",58:"Brighton Park",59:"McKinley Park",
  60:"Bridgeport",61:"New City",62:"West Elsdon",63:"Gage Park",64:"Clearing",
  65:"West Lawn",66:"Chicago Lawn",67:"West Englewood",68:"Englewood",69:"Greater Grand Crossing",
  70:"Ashburn",71:"Auburn Gresham",72:"Beverly",73:"Washington Heights",74:"Mount Greenwood",
  75:"Morgan Park",76:"O'Hare",77:"Edgewater"
};

// Six regional groupings — used later for hints / "narrow it down" difficulty.
const SIDE = {
  "Far North":[1,2,3,4,9,10,11,12,13,14,76,77],
  "Northwest":[15,16,17,18,19,20,21],
  "North":[5,6,7,8,22,23,24],
  "West":[25,26,27,28,29,30,31],
  "Central":[32,33,34],
  "South":[35,36,37,38,39,40,41,42,43,44,45,46,47,48,60,61],
  "Southwest":[56,57,58,59,62,63,64,65,66,67,68,69,70],
  "Far Southeast":[49,50,51,52,53,54,55],
  "Far Southwest":[71,72,73,74,75]
};
const sideOf = {};
for (const [s, nums] of Object.entries(SIDE)) for (const n of nums) sideOf[n] = s;

const round = (n) => Math.round(n * 1e5) / 1e5; // ~1.1m precision
function trim(coords) {
  if (typeof coords[0] === "number") return [round(coords[0]), round(coords[1])];
  return coords.map(trim);
}

const g = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = { type: "FeatureCollection", features: [] };
const seen = new Set();
for (const f of g.features) {
  const num = parseInt(f.properties.area_numbe, 10);
  const name = NAMES[num];
  if (!name) throw new Error("No name for area " + JSON.stringify(f.properties));
  seen.add(num);
  out.features.push({
    type: "Feature",
    properties: { num, name, side: sideOf[num] },
    geometry: { type: f.geometry.type, coordinates: trim(f.geometry.coordinates) }
  });
}
if (seen.size !== 77) throw new Error("Expected 77 areas, got " + seen.size);
out.features.sort((a, b) => a.properties.num - b.properties.num);

const js = "// VendorFlow chicago-neighborhoods v1.0 — Chicago's 77 official community areas.\n" +
  "// Source: City of Chicago open data (Boundaries - Community Areas). Coordinates\n" +
  "// trimmed to 5 decimal places (~1m). Do not hand-edit; regenerate via process.js.\n" +
  "window.CHICAGO_COMMUNITY_AREAS = " + JSON.stringify(out) + ";\n";
fs.writeFileSync(process.argv[3], js);
console.log("Wrote", process.argv[3], (js.length / 1024).toFixed(0) + "KB", "features:", out.features.length);
