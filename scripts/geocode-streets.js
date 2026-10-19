// One-time geocoder for the barangay street list -> frontend/staff/js/street-coordinates.js
//
// SUPERSEDED (2026-09-30) — don't run this. It geocodes the old 65-street
// list, most of which turned out to be outside Barangay Platero, and would
// overwrite street-coordinates.js (which now holds the current in-barangay
// list, placed from OpenStreetMap road geometry, plus the old list for
// existing reports). Kept for reference only.
const fs = require("fs");
const path = require("path");

const STREETS = [
  "Aberta Street", "Acorn Loop", "Alder Lane", "Alpine Street", "Andrea Street",
  "Athens Drive", "Basswood Street", "Benedict Street", "Biñan - Santa Rosa Access Road",
  "Birch Street", "Blueberry Street", "Calvin Street", "Cedar Street", "Cherry Street",
  "Chestnut Street", "Denver", "Diamond Street", "Dogwood Street", "East Magnolia Lane",
  "East Pear Lane", "East Poplar Street", "Elm Lane", "Enrica Street", "Evergreen Street",
  "Fern Lane", "Ferragamo Street", "Ferrari Street", "Gabana Street", "Giordano Street",
  "Greenfield Parkway", "Houston Street", "Lauren Street", "Main Street", "Maple Drive",
  "Mercado Street", "Mondo Drive", "Monza Street", "Napoli", "Narra Street",
  "Nashville Street", "North Delphi Drive", "North Thebes Drive", "Omaha Street",
  "Padova Street", "Parma Street", "Pine Drive", "Pine Lane", "Rain Tree Lane",
  "Ralph Street", "Redwood Lane", "Second Street", "Spectrum Avenue", "Spm Sun Street",
  "Spruce Lane", "Sycamore Drive", "Sycamore Lane", "Teodora Street", "Topaz Street",
  "Tulay Bato Street", "Valentino Street", "Versace Street", "Vuitton Street",
  "Walnut Lane", "West Magnolia Lane", "West Oak Lane",
];

// Barangay Platero, Biñan bounding box (viewbox) to bias results and reject far-off matches.
// Roughly around 14.31, 121.08 based on the Ferrari Street sample.
const CENTER = [14.3125, 121.0845];
const MAX_KM = 3.5; // reject anything farther than this from center

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocodeOne(street) {
  const attempts = [
    { street, city: "Biñan", state: "Laguna", country: "Philippines" },
    { q: `${street}, Biñan, Laguna, Philippines` },
  ];
  for (const params of attempts) {
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("format", "jsonv2");
    u.searchParams.set("limit", "5");
    u.searchParams.set("viewbox", "121.055,14.295,121.115,14.330");
    u.searchParams.set("bounded", "0");
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

    const res = await fetch(u, { headers: { "User-Agent": "ORMS-dev-geocoder/1.0 (barangay dashboard)" } });
    if (!res.ok) {
      await sleep(1200);
      continue;
    }
    const rows = await res.json();
    await sleep(1200); // Nominatim: max 1 req/sec
    const withDist = rows
      .map((r) => ({ r, d: haversineKm(CENTER, [parseFloat(r.lat), parseFloat(r.lon)]) }))
      .sort((x, y) => x.d - y.d);
    const best = withDist[0];
    if (best && best.d <= MAX_KM) {
      return {
        coord: [Math.round(parseFloat(best.r.lat) * 1e6) / 1e6, Math.round(parseFloat(best.r.lon) * 1e6) / 1e6],
        display: best.r.display_name,
        km: Math.round(best.d * 100) / 100,
      };
    }
  }
  return null;
}

(async () => {
  const out = {};
  const misses = [];
  for (const s of STREETS) {
    try {
      const hit = await geocodeOne(s);
      if (hit) {
        out[s] = hit.coord;
        console.log(`OK   ${s.padEnd(34)} ${hit.coord.join(", ")}  (${hit.km}km)  ${hit.display.slice(0, 60)}`);
      } else {
        misses.push(s);
        console.log(`MISS ${s}`);
      }
    } catch (e) {
      misses.push(s);
      console.log(`ERR  ${s}  ${e.message}`);
    }
  }

  const banner =
    "// O.R.M.S. — approximate lat/lng for each barangay street, used by the\n" +
    "// staff dashboards' incident heatmap. Generated once by geocoding the\n" +
    "// STREETS list (citizen/js/streets-data.js) against OpenStreetMap /\n" +
    "// Nominatim, restricted to Barangay Platero, Biñan, Laguna. These are\n" +
    "// street-level centroids, not exact incident points — good enough for a\n" +
    "// density heatmap, not for pin-drop accuracy. Regenerate with\n" +
    "// scripts/geocode-streets.js if the street list changes.\n\n";
  const body =
    "const STREET_COORDINATES = {\n" +
    Object.entries(out)
      .map(([k, v]) => `  ${JSON.stringify(k)}: [${v[0]}, ${v[1]}],`)
      .join("\n") +
    "\n};\n";
  const dest = path.join(__dirname, "street-coordinates.js");
  fs.writeFileSync(dest, banner + body);
  console.log(`\nWrote ${Object.keys(out).length}/${STREETS.length} -> ${dest}`);
  if (misses.length) console.log("MISSES:", misses.join(", "));
})();
