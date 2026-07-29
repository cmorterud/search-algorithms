import type { AlgorithmDefinition, Cell, GridSnapshot, SearchEvent } from "./types";

interface QueueEntry {
  id: string;
  priority: number;
}

interface HeapEntry extends QueueEntry {
  order: number;
}

class MinPriorityQueue {
  private entries: HeapEntry[] = [];
  private nextOrder = 0;

  get length(): number {
    return this.entries.length;
  }

  push(entry: QueueEntry): void {
    const candidate = { ...entry, order: this.nextOrder++ };
    this.entries.push(candidate);
    let index = this.entries.length - 1;

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.entries[parent], candidate) <= 0) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }

    this.entries[index] = candidate;
  }

  pop(): QueueEntry | undefined {
    const root = this.entries[0];
    const last = this.entries.pop();
    if (!root || !last) return root;

    if (this.entries.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.entries.length) break;
        const child = right < this.entries.length && this.compare(this.entries[right], this.entries[left]) < 0 ? right : left;
        if (this.compare(last, this.entries[child]) <= 0) break;
        this.entries[index] = this.entries[child];
        index = child;
      }
      this.entries[index] = last;
    }

    return { id: root.id, priority: root.priority };
  }

  private compare(a: HeapEntry, b: HeapEntry): number {
    return a.priority - b.priority || a.order - b.order;
  }
}

interface FifoQueue {
  items: string[];
  head: number;
}

const cellId = (row: number, col: number): string => `${row}:${col}`;

const reconstructPath = (
  cameFrom: Map<string, string>,
  startId: string,
  targetId: string,
): string[] => {
  if (startId !== targetId && !cameFrom.has(targetId)) {
    return [];
  }

  const path = [targetId];
  let current = targetId;

  while (current !== startId) {
    const previous = cameFrom.get(current);
    if (!previous) {
      return [];
    }

    current = previous;
    path.push(current);
  }

  return path.reverse();
};

const cellMap = (grid: GridSnapshot): Map<string, Cell> =>
  new Map(grid.cells.map((cell) => [cellId(cell.row, cell.col), cell]));

const neighborsOf = (grid: GridSnapshot, cells: Map<string, Cell>, id: string): Cell[] => {
  const cell = cells.get(id);
  if (!cell) {
    return [];
  }

  return [
    [cell.row - 1, cell.col],
    [cell.row, cell.col + 1],
    [cell.row + 1, cell.col],
    [cell.row, cell.col - 1],
  ]
    .filter(([row, col]) => row >= 0 && row < grid.rows && col >= 0 && col < grid.cols)
    .flatMap(([row, col]) => {
      const candidate = cells.get(cellId(row, col));
      return candidate && candidate.kind !== "wall" ? [candidate] : [];
    });
};

const enqueueFrontier = (
  events: SearchEvent[],
  frontierSet: Set<string>,
  id: string,
  side?: "start" | "target",
): void => {
  if (frontierSet.has(id)) {
    return;
  }

  frontierSet.add(id);
  events.push({ type: "frontier", id, side });
};

const finish = (
  events: SearchEvent[],
  cameFrom: Map<string, string>,
  startId: string,
  targetId: string,
): SearchEvent[] => {
  const path = reconstructPath(cameFrom, startId, targetId);
  events.push(path.length > 0 ? { type: "path", ids: path } : { type: "miss" });
  events.push({ type: "clearHighlights" });
  return events;
};

const heuristic = (cells: Map<string, Cell>, id: string, targetId: string): number => {
  const cell = cells.get(id);
  const target = cells.get(targetId);
  if (!cell || !target) {
    return 0;
  }

  return Math.abs(cell.row - target.row) + Math.abs(cell.col - target.col);
};

export const breadthFirstSearch = (grid: GridSnapshot): SearchEvent[] => {
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  const queue = [grid.startId];
  let queueHead = 0;
  const queued = new Set(queue);
  const visited = new Set<string>();
  const cameFrom = new Map<string, string>();

  while (queueHead < queue.length) {
    const current = queue[queueHead++];
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    events.push({ type: "visit", id: current });

    if (current === grid.targetId) {
      return finish(events, cameFrom, grid.startId, grid.targetId);
    }

    neighborsOf(grid, cells, current).forEach((neighbor) => {
      const id = cellId(neighbor.row, neighbor.col);
      if (visited.has(id) || queued.has(id)) {
        return;
      }

      cameFrom.set(id, current);
      queue.push(id);
      enqueueFrontier(events, queued, id);
    });
  }

  return finish(events, cameFrom, grid.startId, grid.targetId);
};

export const bidirectionalBreadthFirstSearch = (grid: GridSnapshot): SearchEvent[] => {
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  const startQueue: FifoQueue = { items: [grid.startId], head: 0 };
  const targetQueue: FifoQueue = { items: [grid.targetId], head: 0 };
  const startDiscovered = new Set(startQueue.items), targetDiscovered = new Set(targetQueue.items);
  const startVisited = new Set<string>(), targetVisited = new Set<string>();
  const fromStart = new Map<string, string>(), fromTarget = new Map<string, string>();

  const expandLayer = (
    queue: FifoQueue,
    discovered: Set<string>,
    visited: Set<string>,
    otherDiscovered: Set<string>,
    cameFrom: Map<string, string>,
    side: "start" | "target",
  ): string | undefined => {
    const layerSize = queue.items.length - queue.head;
    for (let index = 0; index < layerSize; index += 1) {
      const current = queue.items[queue.head++];
      if (!current || visited.has(current)) continue;
      visited.add(current);
      events.push({ type: "visit", id: current, side });
      if (otherDiscovered.has(current)) return current;
      for (const neighbor of neighborsOf(grid, cells, current)) {
        const id = cellId(neighbor.row, neighbor.col);
        if (discovered.has(id)) continue;
        cameFrom.set(id, current);
        queue.items.push(id);
        enqueueFrontier(events, discovered, id, side);
        if (otherDiscovered.has(id)) return id;
      }
    }
    return undefined;
  };

  while (startQueue.head < startQueue.items.length && targetQueue.head < targetQueue.items.length) {
    const meetingFromStart = expandLayer(startQueue, startDiscovered, startVisited, targetDiscovered, fromStart, "start");
    const meeting = meetingFromStart ?? expandLayer(targetQueue, targetDiscovered, targetVisited, startDiscovered, fromTarget, "target");
    if (!meeting) continue;
    const path = reconstructPath(fromStart, grid.startId, meeting);
    let current = meeting;
    while (path.length > 0 && current !== grid.targetId) {
      const next = fromTarget.get(current);
      if (!next) { path.length = 0; break; }
      path.push(next);
      current = next;
    }
    events.push(path.length > 0 ? { type: "path", ids: path } : { type: "miss" });
    events.push({ type: "clearHighlights" });
    return events;
  }

  events.push({ type: "miss" }, { type: "clearHighlights" });
  return events;
};

export const depthFirstSearch = (grid: GridSnapshot): SearchEvent[] => {
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  const stack = [grid.startId];
  const queued = new Set(stack);
  const visited = new Set<string>();
  const cameFrom = new Map<string, string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    events.push({ type: "visit", id: current });

    if (current === grid.targetId) {
      return finish(events, cameFrom, grid.startId, grid.targetId);
    }

    neighborsOf(grid, cells, current)
      .reverse()
      .forEach((neighbor) => {
        const id = cellId(neighbor.row, neighbor.col);
        if (visited.has(id) || queued.has(id)) {
          return;
        }

        cameFrom.set(id, current);
        stack.push(id);
        enqueueFrontier(events, queued, id);
      });
  }

  return finish(events, cameFrom, grid.startId, grid.targetId);
};

export const iterativeDeepeningDepthFirstSearch = (grid: GridSnapshot): SearchEvent[] => {
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  const passableCount = grid.cells.reduce((count, cell) => count + (cell.kind === "wall" ? 0 : 1), 0);
  const maxDepth = Math.max(0, passableCount - 1);
  let depthLimit = Math.min(16, maxDepth);
  let iteration = 0;

  while (true) {
    if (iteration > 0) events.push({ type: "iteration", depthLimit });
    const stack: { id: string; depth: number; parent?: string }[] = [{ id: grid.startId, depth: 0 }];
    const scheduledDepth = new Map<string, number>([[grid.startId, 0]]);
    const emitted = new Set<string>();
    const cameFrom = new Map<string, string>();

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || scheduledDepth.get(current.id) !== current.depth) continue;
      if (current.parent) cameFrom.set(current.id, current.parent);
      if (!emitted.has(current.id)) {
        emitted.add(current.id);
        events.push({ type: "visit", id: current.id });
      }
      if (current.id === grid.targetId) return finish(events, cameFrom, grid.startId, grid.targetId);
      if (current.depth >= depthLimit) continue;

      neighborsOf(grid, cells, current.id).reverse().forEach((neighbor) => {
        const id = cellId(neighbor.row, neighbor.col);
        const nextDepth = current.depth + 1;
        if ((scheduledDepth.get(id) ?? Number.POSITIVE_INFINITY) <= nextDepth) return;
        scheduledDepth.set(id, nextDepth);
        stack.push({ id, depth: nextDepth, parent: current.id });
      });
    }

    if (depthLimit >= maxDepth) break;
    depthLimit = Math.min(maxDepth, Math.max(depthLimit + 1, depthLimit * 2));
    iteration += 1;
  }

  events.push({ type: "miss" }, { type: "clearHighlights" });
  return events;
};

export const dijkstraSearch = (grid: GridSnapshot): SearchEvent[] => {
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  const queue = new MinPriorityQueue();
  queue.push({ id: grid.startId, priority: 0 });
  const visited = new Set<string>();
  const frontier = new Set([grid.startId]);
  const cameFrom = new Map<string, string>();
  const distance = new Map<string, number>([[grid.startId, 0]]);

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || visited.has(current.id)) {
      continue;
    }

    visited.add(current.id);
    events.push({ type: "visit", id: current.id });

    if (current.id === grid.targetId) {
      return finish(events, cameFrom, grid.startId, grid.targetId);
    }

    neighborsOf(grid, cells, current.id).forEach((neighbor) => {
      const id = cellId(neighbor.row, neighbor.col);
      if (visited.has(id)) {
        return;
      }

      const nextDistance = (distance.get(current.id) ?? 0) + 1;
      if (nextDistance >= (distance.get(id) ?? Number.POSITIVE_INFINITY)) {
        return;
      }

      cameFrom.set(id, current.id);
      distance.set(id, nextDistance);
      enqueueFrontier(events, frontier, id);
      queue.push({ id, priority: nextDistance });
    });
  }

  return finish(events, cameFrom, grid.startId, grid.targetId);
};

export const aStarSearch = (grid: GridSnapshot): SearchEvent[] => {
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  const queue = new MinPriorityQueue();
  queue.push({ id: grid.startId, priority: 0 });
  const visited = new Set<string>();
  const frontier = new Set([grid.startId]);
  const cameFrom = new Map<string, string>();
  const distance = new Map<string, number>([[grid.startId, 0]]);

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || visited.has(current.id)) {
      continue;
    }

    visited.add(current.id);
    events.push({ type: "visit", id: current.id });

    if (current.id === grid.targetId) {
      return finish(events, cameFrom, grid.startId, grid.targetId);
    }

    neighborsOf(grid, cells, current.id).forEach((neighbor) => {
      const id = cellId(neighbor.row, neighbor.col);
      if (visited.has(id)) {
        return;
      }

      const nextDistance = (distance.get(current.id) ?? 0) + 1;
      if (nextDistance >= (distance.get(id) ?? Number.POSITIVE_INFINITY)) {
        return;
      }

      cameFrom.set(id, current.id);
      distance.set(id, nextDistance);
      enqueueFrontier(events, frontier, id);
      queue.push({
        id,
        priority: nextDistance + heuristic(cells, id, grid.targetId),
      });
    });
  }

  return finish(events, cameFrom, grid.startId, grid.targetId);
};

export const greedyBestFirstSearch = (grid: GridSnapshot): SearchEvent[] => {
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  const queue = new MinPriorityQueue();
  queue.push({ id: grid.startId, priority: heuristic(cells, grid.startId, grid.targetId) });
  const queued = new Set([grid.startId]);
  const visited = new Set<string>();
  const cameFrom = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    events.push({ type: "visit", id: current.id });
    if (current.id === grid.targetId) return finish(events, cameFrom, grid.startId, grid.targetId);

    neighborsOf(grid, cells, current.id).forEach((neighbor) => {
      const id = cellId(neighbor.row, neighbor.col);
      if (visited.has(id) || queued.has(id)) return;
      cameFrom.set(id, current.id);
      enqueueFrontier(events, queued, id);
      queue.push({ id, priority: heuristic(cells, id, grid.targetId) });
    });
  }

  return finish(events, cameFrom, grid.startId, grid.targetId);
};

export const beamSearch = (grid: GridSnapshot): SearchEvent[] => {
  const BEAM_WIDTH = 64;
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  let frontier = [grid.startId];
  const discovered = new Set(frontier);
  const visited = new Set<string>();
  const cameFrom = new Map<string, string>();

  while (frontier.length > 0) {
    const candidates = new Map<string, { parent: string; priority: number }>();
    for (const current of frontier) {
      if (visited.has(current)) continue;
      visited.add(current);
      events.push({ type: "visit", id: current });
      if (current === grid.targetId) return finish(events, cameFrom, grid.startId, grid.targetId);
      neighborsOf(grid, cells, current).forEach((neighbor) => {
        const id = cellId(neighbor.row, neighbor.col);
        if (discovered.has(id) || candidates.has(id)) return;
        candidates.set(id, { parent: current, priority: heuristic(cells, id, grid.targetId) });
      });
    }
    candidates.forEach((_, id) => discovered.add(id));
    const selected = [...candidates].sort(([, a], [, b]) => a.priority - b.priority).slice(0, BEAM_WIDTH);
    selected.forEach(([id, candidate]) => {
      cameFrom.set(id, candidate.parent);
      events.push({ type: "frontier", id });
    });
    frontier = selected.map(([id]) => id);
  }

  return finish(events, cameFrom, grid.startId, grid.targetId);
};

export const algorithms: AlgorithmDefinition[] = [
  { id: "bfs", label: "Breadth First Search", search: breadthFirstSearch },
  { id: "bidirectional-bfs", label: "Bidirectional BFS", search: bidirectionalBreadthFirstSearch },
  { id: "dfs", label: "Depth First Search", search: depthFirstSearch },
  { id: "iddfs", label: "Iterative Deepening DFS", search: iterativeDeepeningDepthFirstSearch },
  { id: "dijkstra", label: "Dijkstra", search: dijkstraSearch },
  { id: "astar", label: "A*", search: aStarSearch },
  { id: "greedy", label: "Greedy Best-First Search", search: greedyBestFirstSearch },
  { id: "beam", label: "Beam Search", search: beamSearch },
];
