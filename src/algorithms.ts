import type { AlgorithmDefinition, Cell, GridSnapshot, SearchEvent } from "./types";

interface QueueEntry {
  id: string;
  priority: number;
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
): void => {
  if (frontierSet.has(id)) {
    return;
  }

  frontierSet.add(id);
  events.push({ type: "frontier", id });
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

const pushPriority = (queue: QueueEntry[], entry: QueueEntry): void => {
  queue.push(entry);
  queue.sort((a, b) => a.priority - b.priority);
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
  const queued = new Set(queue);
  const visited = new Set<string>();
  const cameFrom = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift();
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
  const queue: QueueEntry[] = [{ id: grid.startId, priority: 0 }];
  const visited = new Set<string>();
  const frontier = new Set([grid.startId]);
  const cameFrom = new Map<string, string>();
  const distance = new Map<string, number>([[grid.startId, 0]]);

  while (queue.length > 0) {
    const current = queue.shift();
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
      pushPriority(queue, { id, priority: nextDistance });
    });
  }

  return finish(events, cameFrom, grid.startId, grid.targetId);
};

export const aStarSearch = (grid: GridSnapshot): SearchEvent[] => {
  const events: SearchEvent[] = [];
  const cells = cellMap(grid);
  const queue: QueueEntry[] = [{ id: grid.startId, priority: 0 }];
  const visited = new Set<string>();
  const frontier = new Set([grid.startId]);
  const cameFrom = new Map<string, string>();
  const distance = new Map<string, number>([[grid.startId, 0]]);

  while (queue.length > 0) {
    const current = queue.shift();
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
      pushPriority(queue, {
        id,
        priority: nextDistance + heuristic(cells, id, grid.targetId),
      });
    });
  }

  return finish(events, cameFrom, grid.startId, grid.targetId);
};

export const algorithms: AlgorithmDefinition[] = [
  { id: "bfs", label: "Breadth First Search", search: breadthFirstSearch },
  { id: "dfs", label: "Depth First Search", search: depthFirstSearch },
  { id: "dijkstra", label: "Dijkstra", search: dijkstraSearch },
  { id: "astar", label: "A*", search: aStarSearch },
];
