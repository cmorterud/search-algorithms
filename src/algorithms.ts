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

  peek(): QueueEntry | undefined {
    const entry = this.entries[0];
    return entry ? { id: entry.id, priority: entry.priority } : undefined;
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

  popWorst(): QueueEntry | undefined {
    if (this.entries.length === 0) return undefined;
    let worstIndex = 0;
    for (let index = 1; index < this.entries.length; index += 1) {
      if (this.compare(this.entries[index], this.entries[worstIndex]) > 0) worstIndex = index;
    }
    const worst = this.entries[worstIndex];
    const last = this.entries.pop();
    if (last && worstIndex < this.entries.length) {
      this.entries[worstIndex] = last;
      let index = worstIndex;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (this.compare(this.entries[parent], this.entries[index]) <= 0) break;
        [this.entries[parent], this.entries[index]] = [this.entries[index], this.entries[parent]];
        index = parent;
      }
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.entries.length) break;
        const child = right < this.entries.length && this.compare(this.entries[right], this.entries[left]) < 0 ? right : left;
        if (this.compare(this.entries[index], this.entries[child]) <= 0) break;
        [this.entries[index], this.entries[child]] = [this.entries[child], this.entries[index]];
        index = child;
      }
    }
    return { id: worst.id, priority: worst.priority };
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

export const bidirectionalAStarSearch = (grid: GridSnapshot): SearchEvent[] => {
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  const forwardQueue = new MinPriorityQueue();
  const backwardQueue = new MinPriorityQueue();
  const forwardDistance = new Map<string, number>([[grid.startId, 0]]);
  const backwardDistance = new Map<string, number>([[grid.targetId, 0]]);
  const forwardVisited = new Set<string>();
  const backwardVisited = new Set<string>();
  const forwardFrontier = new Set<string>([grid.startId]);
  const backwardFrontier = new Set<string>([grid.targetId]);
  const fromStart = new Map<string, string>();
  const fromTarget = new Map<string, string>();
  let bestCost = grid.startId === grid.targetId ? 0 : Number.POSITIVE_INFINITY;
  let meeting: string | undefined = grid.startId === grid.targetId ? grid.startId : undefined;
  let expandForwardOnTie = true;

  // Balanced potentials let both A* searches share one valid lower bound.
  const potential = (id: string): number =>
    (heuristic(cells, id, grid.targetId) - heuristic(cells, id, grid.startId)) / 2;
  forwardQueue.push({ id: grid.startId, priority: potential(grid.startId) });
  backwardQueue.push({ id: grid.targetId, priority: -potential(grid.targetId) });

  const updateMeeting = (id: string): void => {
    const forward = forwardDistance.get(id);
    const backward = backwardDistance.get(id);
    if (forward === undefined || backward === undefined || forward + backward >= bestCost) return;
    bestCost = forward + backward;
    meeting = id;
  };

  const nextEntry = (queue: MinPriorityQueue, visited: Set<string>): QueueEntry | undefined => {
    while (queue.peek() && visited.has(queue.peek()!.id)) queue.pop();
    return queue.peek();
  };

  const expand = (
    queue: MinPriorityQueue,
    distances: Map<string, number>,
    otherDistances: Map<string, number>,
    visited: Set<string>,
    frontier: Set<string>,
    cameFrom: Map<string, string>,
    side: "start" | "target",
  ): void => {
    const current = queue.pop();
    if (!current || visited.has(current.id)) return;
    visited.add(current.id);
    events.push({ type: "visit", id: current.id, side });
    updateMeeting(current.id);

    for (const neighbor of neighborsOf(grid, cells, current.id)) {
      const id = cellId(neighbor.row, neighbor.col);
      if (visited.has(id)) continue;
      const nextDistance = (distances.get(current.id) ?? 0) + 1;
      if (nextDistance >= (distances.get(id) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(id, nextDistance);
      cameFrom.set(id, current.id);
      enqueueFrontier(events, frontier, id, side);
      queue.push({
        id,
        priority: nextDistance + (side === "start" ? potential(id) : -potential(id)),
      });
      if (otherDistances.has(id)) updateMeeting(id);
    }
  };

  while (forwardQueue.length > 0 && backwardQueue.length > 0) {
    const forward = nextEntry(forwardQueue, forwardVisited);
    const backward = nextEntry(backwardQueue, backwardVisited);
    if (!forward || !backward) break;
    if (meeting && forward.priority + backward.priority >= bestCost) break;

    const expandForward = forward.priority < backward.priority
      || (forward.priority === backward.priority && expandForwardOnTie);
    if (forward.priority === backward.priority) expandForwardOnTie = !expandForwardOnTie;
    if (expandForward) {
      expand(forwardQueue, forwardDistance, backwardDistance, forwardVisited, forwardFrontier, fromStart, "start");
    } else {
      expand(backwardQueue, backwardDistance, forwardDistance, backwardVisited, backwardFrontier, fromTarget, "target");
    }
  }

  if (!meeting) {
    events.push({ type: "miss" }, { type: "clearHighlights" });
    return events;
  }

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

const aStarSearchWithWeight = (grid: GridSnapshot, heuristicWeight: number): SearchEvent[] => {
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
        priority: nextDistance + heuristicWeight * heuristic(cells, id, grid.targetId),
      });
    });
  }

  return finish(events, cameFrom, grid.startId, grid.targetId);
};

export const aStarSearch = (grid: GridSnapshot): SearchEvent[] =>
  aStarSearchWithWeight(grid, 1);

export const weightedAStarSearch = (grid: GridSnapshot): SearchEvent[] =>
  aStarSearchWithWeight(grid, 2);

export const anytimeRepairingAStarSearch = (grid: GridSnapshot): SearchEvent[] => {
  const WEIGHTS = [3, 2, 1.5, 1];
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  const distance = new Map<string, number>([[grid.startId, 0]]);
  const cameFrom = new Map<string, string>();
  const inconsistent = new Set<string>();
  const closed = new Set<string>();
  let open = new MinPriorityQueue();
  let openScores = new Map<string, number>();

  const pushOpen = (id: string, weight: number): void => {
    const priority = (distance.get(id) ?? Number.POSITIVE_INFINITY)
      + weight * heuristic(cells, id, grid.targetId);
    openScores.set(id, priority);
    open.push({ id, priority });
  };

  const nextValid = (): QueueEntry | undefined => {
    while (open.peek()) {
      const entry = open.peek()!;
      if (openScores.get(entry.id) === entry.priority) return entry;
      open.pop();
    }
    return undefined;
  };

  pushOpen(grid.startId, WEIGHTS[0]);
  let bestPath: string[] = [];

  WEIGHTS.forEach((weight, phase) => {
    if (phase > 0) {
      events.push({ type: "restart", label: `w=${weight}` });
      const candidates = new Set([...openScores.keys(), ...inconsistent]);
      open = new MinPriorityQueue();
      openScores = new Map();
      candidates.forEach((id) => pushOpen(id, weight));
      inconsistent.clear();
      closed.clear();
    }

    const phaseFrontier = new Set<string>();
    while (true) {
      const next = nextValid();
      const targetDistance = distance.get(grid.targetId) ?? Number.POSITIVE_INFINITY;
      if (!next || targetDistance <= next.priority) break;
      const current = open.pop();
      if (!current || openScores.get(current.id) !== current.priority) continue;
      openScores.delete(current.id);
      closed.add(current.id);
      events.push({ type: "visit", id: current.id });

      for (const neighbor of neighborsOf(grid, cells, current.id)) {
        const id = cellId(neighbor.row, neighbor.col);
        const nextDistance = (distance.get(current.id) ?? 0) + 1;
        if (nextDistance >= (distance.get(id) ?? Number.POSITIVE_INFINITY)) continue;
        distance.set(id, nextDistance);
        cameFrom.set(id, current.id);
        if (closed.has(id)) inconsistent.add(id);
        else {
          pushOpen(id, weight);
          enqueueFrontier(events, phaseFrontier, id);
        }
      }
    }

    const path = reconstructPath(cameFrom, grid.startId, grid.targetId);
    if (path.length > 0 && (bestPath.length === 0 || path.length < bestPath.length)) bestPath = path;
    if (bestPath.length > 0) events.push({ type: "path", ids: bestPath });
  });

  events.push(bestPath.length > 0 ? { type: "path", ids: bestPath } : { type: "miss" });
  events.push({ type: "clearHighlights" });
  return events;
};

export const simplifiedMemoryBoundedAStarSearch = (grid: GridSnapshot): SearchEvent[] => {
  const MEMORY_LIMIT = 512;
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  const queue = new MinPriorityQueue();
  const openScores = new Map<string, number>();
  const distance = new Map<string, number>([[grid.startId, 0]]);
  const cameFrom = new Map<string, string>();
  const visited = new Set<string>();

  const pushOpen = (id: string, priority: number): void => {
    openScores.set(id, priority);
    queue.push({ id, priority });
  };
  pushOpen(grid.startId, heuristic(cells, grid.startId, grid.targetId));

  const trimOpenSet = (): void => {
    while (openScores.size > MEMORY_LIMIT) {
      const removed = queue.popWorst();
      if (!removed || openScores.get(removed.id) !== removed.priority) continue;
      openScores.delete(removed.id);
      if (!visited.has(removed.id)) {
        distance.delete(removed.id);
        cameFrom.delete(removed.id);
      }
    }
  };

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || visited.has(current.id) || openScores.get(current.id) !== current.priority) continue;
    openScores.delete(current.id);
    visited.add(current.id);
    events.push({ type: "visit", id: current.id });
    if (current.id === grid.targetId) return finish(events, cameFrom, grid.startId, grid.targetId);

    for (const neighbor of neighborsOf(grid, cells, current.id)) {
      const id = cellId(neighbor.row, neighbor.col);
      if (visited.has(id)) continue;
      const nextDistance = (distance.get(current.id) ?? 0) + 1;
      if (nextDistance >= (distance.get(id) ?? Number.POSITIVE_INFINITY)) continue;
      distance.set(id, nextDistance);
      cameFrom.set(id, current.id);
      pushOpen(id, nextDistance + heuristic(cells, id, grid.targetId));
    }
    trimOpenSet();
  }

  events.push({ type: "miss" }, { type: "clearHighlights" });
  return events;
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
  { id: "bidirectional-astar", label: "Bidirectional A*", search: bidirectionalAStarSearch },
  { id: "dfs", label: "Depth First Search", search: depthFirstSearch },
  { id: "dijkstra", label: "Dijkstra", search: dijkstraSearch },
  { id: "astar", label: "A*", search: aStarSearch },
  { id: "weighted-astar", label: "Weighted A* (w=2)", search: weightedAStarSearch },
  { id: "ara-star", label: "Anytime Repairing A* (ARA*)", search: anytimeRepairingAStarSearch },
  { id: "sma-star", label: "SMA* (512-node memory)", search: simplifiedMemoryBoundedAStarSearch },
  { id: "greedy", label: "Greedy Best-First Search", search: greedyBestFirstSearch },
  { id: "beam", label: "Beam Search", search: beamSearch },
];
