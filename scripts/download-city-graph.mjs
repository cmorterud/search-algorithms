#!/usr/bin/env node

/**
 * Downloads an OpenStreetMap street network and saves it as a small JSON graph
 * that the recording renderer can draw and the search algorithms can traverse.
 *
 * Example:
 * npm run city:download -- --place "Ann Arbor, Michigan" --output public/cities/ann-arbor.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const argument = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const place = argument("--place");
const output = argument("--output");

if (!place || !output) {
  console.error('Usage: npm run city:download -- --place "City, Country" --output public/cities/city.json');
  process.exit(1);
}

const headers = { "User-Agent": "search-algorithms-demo/0.1 (local city graph builder)" };
const geocodeResponse = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(place)}`, { headers });
if (!geocodeResponse.ok) throw new Error(`Geocoding failed: ${geocodeResponse.status} ${geocodeResponse.statusText}`);
const [location] = await geocodeResponse.json();
if (!location) throw new Error(`No OpenStreetMap location found for “${place}”.`);

const [south, north, west, east] = location.boundingbox.map(Number);
const query = `[out:json][timeout:90];way[highway][highway!~"footway|path|steps|cycleway|bridleway|construction|proposed"](${south},${west},${north},${east});out body;>;out skel qt;`;
const overpassEndpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
let overpassResponse;
for (const endpoint of overpassEndpoints) {
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(120000) });
    if (response.ok) { overpassResponse = response; break; }
    console.warn(`${endpoint} returned ${response.status}; trying another endpoint…`);
  } catch (error) {
    console.warn(`${endpoint} was unavailable; trying another endpoint…`);
  }
}
if (!overpassResponse) throw new Error("Street download failed on every configured Overpass endpoint. Please retry in a few minutes.");
const elements = (await overpassResponse.json()).elements;

const coordinates = new Map(elements.filter((item) => item.type === "node").map((item) => [item.id, [item.lon, item.lat]]));
const edgeKeys = new Set();
const edges = [];
const radians = (degrees) => degrees * Math.PI / 180;
const metersBetween = ([lon1, lat1], [lon2, lat2]) => {
  const latitude = radians(lat2 - lat1), longitude = radians(lon2 - lon1);
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(longitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

for (const way of elements.filter((item) => item.type === "way")) {
  for (let index = 1; index < way.nodes.length; index += 1) {
    const from = way.nodes[index - 1], to = way.nodes[index];
    const fromPoint = coordinates.get(from), toPoint = coordinates.get(to);
    if (!fromPoint || !toPoint || from === to) continue;
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ from: String(from), to: String(to), weight: Math.round(metersBetween(fromPoint, toPoint) * 10) / 10 });
  }
}

const usedNodeIds = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
const usedPoints = [...usedNodeIds].map((id) => coordinates.get(Number(id)));
const lons = usedPoints.map(([lon]) => lon), lats = usedPoints.map(([, lat]) => lat);
const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
const nodes = [...usedNodeIds].map((id) => {
  const [lon, lat] = coordinates.get(Number(id));
  return { id, x: (lon - minLon) / (maxLon - minLon || 1), y: 1 - (lat - minLat) / (maxLat - minLat || 1) };
});
const graph = { name: location.display_name, source: "© OpenStreetMap contributors", nodes, edges };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(graph)}\n`);
console.log(`Saved ${nodes.length.toLocaleString()} nodes and ${edges.length.toLocaleString()} street segments to ${output}`);
