export type CellKind = "empty" | "wall" | "weight" | "start" | "target";

export interface Cell {
  row: number;
  col: number;
  kind: CellKind;
  weight: number;
}

export interface GridSnapshot {
  rows: number;
  cols: number;
  cells: Cell[];
  startId: string;
  targetId: string;
}

export type SearchEvent =
  | { type: "visit"; id: string }
  | { type: "frontier"; id: string }
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
  pathIds: Set<string>;
  missed: boolean;
}

export interface AlgorithmDefinition {
  id: string;
  label: string;
  search: SearchAlgorithm;
}
