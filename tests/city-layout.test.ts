import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { layoutCityGraph } from "../src/city-layout.ts";
import type { CityGraph, CityNode } from "../src/city-layout.ts";

const layoutOptions = { zoom: 1, viewportAspect: 1, padding: .05 };

const largestConnectedComponent = (city: CityGraph): CityGraph => {
  const adjacent = new Map<string, string[]>();
  city.edges.forEach(({ from, to }) => {
    adjacent.set(from, [...(adjacent.get(from) ?? []), to]);
    adjacent.set(to, [...(adjacent.get(to) ?? []), from]);
  });
  const seen = new Set<string>();
  let largest = new Set<string>();
  adjacent.forEach((_, seed) => {
    if (seen.has(seed)) return;
    const component = new Set([seed]), pending = [seed];
    seen.add(seed);
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      (adjacent.get(current) ?? []).forEach((neighbor) => {
        if (seen.has(neighbor)) return;
        seen.add(neighbor);
        component.add(neighbor);
        pending.push(neighbor);
      });
    }
    if (component.size > largest.size) largest = component;
  });
  return {
    ...city,
    nodes: city.nodes.filter((node) => largest.has(node.id)),
    edges: city.edges.filter((edge) => largest.has(edge.from) && largest.has(edge.to)),
  };
};

const rotatedStreetGrid = (metersPerUnit?: { x: number; y: number }): CityGraph => {
  const storageScale = { x: 1_000, y: 2_000 };
  const angle = -67 * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const metricNodes: CityNode[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const along = (column - 2) * 250, across = (row - 1) * 100;
      metricNodes.push({
        id: `${row}:${column}`,
        x: along * cosine - across * sine,
        y: along * sine + across * cosine,
      });
    }
  }
  const metricById = new Map(metricNodes.map((node) => [node.id, node]));
  const edgePairs: [string, string][] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      if (column < 4) edgePairs.push([`${row}:${column}`, `${row}:${column + 1}`]);
      if (row < 2) edgePairs.push([`${row}:${column}`, `${row + 1}:${column}`]);
    }
  }
  return {
    name: "Synthetic street grid",
    source: "test",
    metersPerUnit,
    nodes: metricNodes.map((node) => ({
      ...node,
      x: .5 + node.x / storageScale.x,
      y: .5 + node.y / storageScale.y,
    })),
    edges: edgePairs.map(([from, to]) => {
      const fromNode = metricById.get(from)!;
      const toNode = metricById.get(to)!;
      return { from, to, weight: Math.hypot(toNode.x - fromNode.x, toNode.y - fromNode.y) };
    }),
  };
};

const dimensions = (nodes: CityNode[]) => {
  const xs = nodes.map((node) => node.x), ys = nodes.map((node) => node.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};

test("infers metric scale before calculating automatic portrait rotation", () => {
  const layout = layoutCityGraph(rotatedStreetGrid(), layoutOptions);
  assert.ok(Math.abs(layout.automaticRotation - (-23)) < .01);
  assert.equal(layout.rotation, layout.automaticRotation);
});

test("uses explicit projection metadata instead of inferred edge scales", () => {
  const city = rotatedStreetGrid({ x: 1_000, y: 2_000 });
  city.edges.forEach((edge) => { edge.weight = 1; });
  const layout = layoutCityGraph(city, layoutOptions);
  assert.ok(Math.abs(layout.automaticRotation - (-23)) < .01);
});

test("ignores invalid projection metadata and infers a valid scale", () => {
  const city = rotatedStreetGrid({ x: 0, y: Number.NaN });
  const layout = layoutCityGraph(city, layoutOptions);
  assert.ok(Math.abs(layout.automaticRotation - (-23)) < .01);
});

test("manual rotation is applied in physical degrees and respects viewport padding", () => {
  const layout = layoutCityGraph(rotatedStreetGrid(), { ...layoutOptions, rotation: -23 });
  const { width, height } = dimensions(layout.graph.nodes);
  assert.ok(Math.abs(width / height - .2) < .001);
  const tolerance = 1e-12;
  layout.graph.nodes.forEach((node) => {
    assert.ok(node.x >= .05 - tolerance && node.x <= .95 + tolerance);
    assert.ok(node.y >= .05 - tolerance && node.y <= .95 + tolerance);
  });
});

test("falls back to equal coordinate scales for a degenerate edge set", () => {
  const city: CityGraph = {
    name: "Line",
    source: "test",
    nodes: [{ id: "a", x: 0, y: .5 }, { id: "b", x: 1, y: .5 }],
    edges: [{ from: "a", to: "b", weight: 100 }],
  };
  const first = layoutCityGraph(city, layoutOptions);
  const second = layoutCityGraph(city, layoutOptions);
  assert.equal(first.automaticRotation, 90);
  assert.deepEqual(second, first);
  first.graph.nodes.forEach((node) => {
    assert.ok(Number.isFinite(node.x));
    assert.ok(Number.isFinite(node.y));
  });
});

test("New York auto-fit uses the metric Manhattan axis", () => {
  const asset = JSON.parse(readFileSync(new URL("../public/cities/new-york.json", import.meta.url), "utf8")) as CityGraph;
  const layout = layoutCityGraph(largestConnectedComponent(asset), layoutOptions);
  assert.ok(layout.automaticRotation > -24 && layout.automaticRotation < -21);
});
