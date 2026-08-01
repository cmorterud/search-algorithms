export interface CityNode {
  id: string;
  x: number;
  y: number;
}

export interface CityEdge {
  from: string;
  to: string;
  weight: number;
}

export interface CityGraph {
  name: string;
  source: string;
  nodes: CityNode[];
  edges: CityEdge[];
}

export interface CityLayoutOptions {
  rotation?: number;
  zoom: number;
  viewportAspect: number;
  padding?: number;
}

export interface CityLayoutResult {
  graph: CityGraph;
  rotation: number;
  automaticRotation: number;
  zoom: number;
  startNodeId: string;
  targetNodeId: string;
}

const degreesToRadians = (degrees: number): number => degrees * Math.PI / 180;

const normalizePortraitRotation = (degrees: number): number => {
  let normalized = degrees;
  while (normalized > 90) normalized -= 180;
  while (normalized < -90) normalized += 180;
  return normalized;
};

const automaticPortraitRotation = (nodes: CityNode[]): number => {
  if (nodes.length < 2) return 0;
  const center = nodes.reduce((sum, node) => ({ x: sum.x + node.x, y: sum.y + node.y }), { x: 0, y: 0 });
  center.x /= nodes.length;
  center.y /= nodes.length;
  let xx = 0, yy = 0, xy = 0;
  nodes.forEach((node) => {
    const x = node.x - center.x, y = node.y - center.y;
    xx += x * x;
    yy += y * y;
    xy += x * y;
  });
  const principalAxis = .5 * Math.atan2(2 * xy, xx - yy);
  return normalizePortraitRotation(90 - principalAxis * 180 / Math.PI);
};

const nearestEndpoint = (
  nodes: CityNode[],
  degrees: Map<string, number>,
  anchor: { x: number; y: number },
  excluded?: string,
): CityNode => {
  const preferred = nodes.filter((node) => node.id !== excluded && (degrees.get(node.id) ?? 0) >= 2);
  const candidates = preferred.length > 0 ? preferred : nodes.filter((node) => node.id !== excluded);
  return candidates.reduce((best, node) => {
    const distance = (node.x - anchor.x) ** 2 + (node.y - anchor.y) ** 2;
    const bestDistance = (best.x - anchor.x) ** 2 + (best.y - anchor.y) ** 2;
    return distance < bestDistance ? node : best;
  }, candidates[0] ?? nodes[0]);
};

export const layoutCityGraph = (city: CityGraph, options: CityLayoutOptions): CityLayoutResult => {
  if (city.nodes.length === 0) throw new Error("City graph has no nodes");
  const automaticRotation = automaticPortraitRotation(city.nodes);
  const rotation = Number.isFinite(options.rotation) ? options.rotation! : automaticRotation;
  const zoom = Math.min(1.3, Math.max(.8, options.zoom));
  const aspect = Math.max(.1, options.viewportAspect);
  const padding = Math.min(.2, Math.max(0, options.padding ?? .05));
  const center = city.nodes.reduce((sum, node) => ({ x: sum.x + node.x, y: sum.y + node.y }), { x: 0, y: 0 });
  center.x /= city.nodes.length;
  center.y /= city.nodes.length;
  const radians = degreesToRadians(rotation), cosine = Math.cos(radians), sine = Math.sin(radians);
  const rotated = city.nodes.map((node) => {
    const x = node.x - center.x, y = node.y - center.y;
    return { ...node, x: cosine * x - sine * y, y: sine * x + cosine * y };
  });
  const bounds = rotated.reduce((result, node) => ({
    minX: Math.min(result.minX, node.x), maxX: Math.max(result.maxX, node.x),
    minY: Math.min(result.minY, node.y), maxY: Math.max(result.maxY, node.y),
  }), { minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
  const width = Math.max(Number.EPSILON, bounds.maxX - bounds.minX);
  const height = Math.max(Number.EPSILON, bounds.maxY - bounds.minY);
  const scale = Math.min(((1 - padding * 2) * aspect) / width, (1 - padding * 2) / height);
  const boundsCenterX = (bounds.minX + bounds.maxX) / 2, boundsCenterY = (bounds.minY + bounds.maxY) / 2;
  const nodes = rotated.map((node) => ({
    ...node,
    x: .5 + (node.x - boundsCenterX) * scale * zoom / aspect,
    y: .5 + (node.y - boundsCenterY) * scale * zoom,
  }));
  const degrees = new Map<string, number>();
  city.edges.forEach(({ from, to }) => {
    degrees.set(from, (degrees.get(from) ?? 0) + 1);
    degrees.set(to, (degrees.get(to) ?? 0) + 1);
  });
  const start = nearestEndpoint(nodes, degrees, { x: .5, y: .85 });
  const target = nearestEndpoint(nodes, degrees, { x: .5, y: .15 }, start.id);
  return {
    graph: { ...city, nodes },
    rotation,
    automaticRotation,
    zoom,
    startNodeId: start.id,
    targetNodeId: target.id,
  };
};
