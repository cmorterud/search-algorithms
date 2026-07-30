export type CellKind = "empty" | "wall" | "start" | "target";

export interface Cell {
  row: number;
  col: number;
  kind: CellKind;
}

export interface GridSnapshot {
  rows: number;
  cols: number;
  cells: Cell[];
  startId: string;
  targetId: string;
}

export type SearchSide = "start" | "target";

export type SearchEvent =
  | { type: "visit"; id: string; side?: SearchSide }
  | { type: "frontier"; id: string; side?: SearchSide }
  | { type: "restart"; label: string }
  | { type: "path"; ids: string[] }
  | { type: "miss" }
  | { type: "clearHighlights" };

export type SearchAlgorithm = (grid: GridSnapshot) => SearchEvent[];

export interface VisualizerState {
  grid: GridSnapshot;
  originalGrid: GridSnapshot;
  events: SearchEvent[];
  currentEventIndex: number;
  isRunning: boolean;
  isPaused: boolean;
  visitedCount: number;
  frontierCount: number;
  pathLength: number;
  activeId: string | undefined;
  visitedIds: Set<string>;
  frontierIds: Set<string>;
  targetVisitedIds: Set<string>;
  targetFrontierIds: Set<string>;
  pathIds: Set<string>;
  missed: boolean;
}

export interface AlgorithmDefinition {
  id: string;
  label: string;
  search: SearchAlgorithm;
}
