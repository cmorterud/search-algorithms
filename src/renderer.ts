import type { Cell, GridSnapshot, VisualizerState } from "./types";

interface RenderElements {
  gridContainer: HTMLElement;
  visitedValue: HTMLElement;
  frontierValue: HTMLElement;
  pathValue: HTMLElement;
  targetValue: HTMLElement;
  algorithmValue: HTMLElement;
  startButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  randomizeButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  algorithmSelect: HTMLSelectElement;
  densitySlider: HTMLInputElement;
  recording?: {
    algorithmName: HTMLElement;
    stats: HTMLElement;
    result: HTMLElement;
  };
}

interface RecordingRoadGraph {
  nodes: { id: string; x: number; y: number }[];
  edges: { from: string; to: string }[];
}

interface RecordingRoadIndex {
  rows: number;
  cols: number;
  segments: { fromX: number; fromY: number; toX: number; toY: number }[];
  segmentIdsByCell: Map<string, number[]>;
}

const cellId = (cell: Cell): string => `${cell.row}:${cell.col}`;
let renderedGrid: GridSnapshot | undefined;
const tilesById = new Map<string, HTMLElement>();
let recordingRoadGraph: RecordingRoadGraph | undefined;
let recordingRoadIndex: RecordingRoadIndex | undefined;

export const setRecordingRoadGraph = (graph: RecordingRoadGraph | undefined): void => {
  recordingRoadGraph = graph;
  recordingRoadIndex = undefined;
};

const roadIndexFor = (grid: GridSnapshot): RecordingRoadIndex | undefined => {
  if (!recordingRoadGraph) return undefined;
  if (recordingRoadIndex?.rows === grid.rows && recordingRoadIndex.cols === grid.cols) return recordingRoadIndex;
  const nodeById = new Map(recordingRoadGraph.nodes.map((node) => [node.id, node]));
  const segments: RecordingRoadIndex["segments"] = [];
  const segmentIdsByCell = new Map<string, number[]>();
  const pointFor = (node: { x: number; y: number }) => ({
    row: Math.round(1 + node.y * (grid.rows - 3)),
    col: Math.round(1 + node.x * (grid.cols - 3)),
  });
  const indexCell = (id: string, segmentId: number) => {
    const existing = segmentIdsByCell.get(id);
    if (existing) existing.push(segmentId);
    else segmentIdsByCell.set(id, [segmentId]);
  };
  recordingRoadGraph.edges.forEach((edge) => {
    const fromNode = nodeById.get(edge.from), toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) return;
    const segmentId = segments.length;
    segments.push({ fromX: fromNode.x, fromY: fromNode.y, toX: toNode.x, toY: toNode.y });
    const from = pointFor(fromNode), to = pointFor(toNode);
    let row = from.row, col = from.col;
    const rowStep = Math.sign(to.row - row), colStep = Math.sign(to.col - col);
    const rowDistance = Math.abs(to.row - row), colDistance = Math.abs(to.col - col);
    let error = rowDistance - colDistance;
    const indexedCells = new Set<string>();
    const addCurrentCell = () => indexedCells.add(`${row}:${col}`);
    while (true) {
      addCurrentCell();
      if (row === to.row && col === to.col) break;
      const doubled = error * 2;
      if (doubled > -colDistance) { error -= colDistance; row += rowStep; addCurrentCell(); }
      if (doubled < rowDistance) { error += rowDistance; col += colStep; addCurrentCell(); }
    }
    indexedCells.forEach((id) => indexCell(id, segmentId));
  });
  recordingRoadIndex = { rows: grid.rows, cols: grid.cols, segments, segmentIdsByCell };
  return recordingRoadIndex;
};

const buildGrid = (container: HTMLElement, state: VisualizerState): void => {
  const isRecordingGrid = Boolean(container.closest(".recording-visualizer"));
  tilesById.clear();
  if (isRecordingGrid) {
    container.replaceChildren();
    renderedGrid = state.grid;
    return;
  }
  const fragment = document.createDocumentFragment();
  state.grid.cells.forEach((cell) => {
    const id = cellId(cell);
    const tile = document.createElement(isRecordingGrid ? "span" : "button");
    if (tile instanceof HTMLButtonElement) tile.type = "button";
    tile.className = "cell";
    tile.dataset.id = id;
    tile.dataset.kind = cell.kind;
    tile.setAttribute("aria-label", `${cell.kind} location row ${cell.row + 1}, column ${cell.col + 1}`);
    tile.title = cell.kind;
    if (cell.kind === "start") tile.textContent = "S";
    if (cell.kind === "target") tile.textContent = "T";
    tilesById.set(id, tile);
    fragment.append(tile);
  });
  container.replaceChildren(fragment);
  renderedGrid = state.grid;
};

const renderRecordingOverlay = (
  state: VisualizerState,
  gridChanged: boolean,
  changedIds: ReadonlySet<string>,
): void => {
  const canvas = document.querySelector<HTMLCanvasElement>("#search-overlay-canvas");
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.round(bounds.width * pixelRatio);
  const height = Math.round(bounds.height * pixelRatio);
  const resized = canvas.width !== width || canvas.height !== height;
  if (resized) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext("2d");
  if (!context || !width || !height) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const cellWidth = bounds.width / state.grid.cols;
  const cellHeight = bounds.height / state.grid.rows;
  const centerFor = (id: string) => {
    const [row, col] = id.split(":").map(Number);
    return { row, col, x: (col + .5) * cellWidth, y: (row + .5) * cellHeight };
  };
  const drawPath = (ids: Iterable<string>) => {
    const lineWidth = Math.max(.5, Math.min(cellWidth, cellHeight) * .84);
    const dotRadius = Math.max(.08, lineWidth * .08);
    context.beginPath();
    for (const id of ids) {
      const { row, col, x, y } = centerFor(id);
      // A tiny round-capped segment makes isolated frontier cells smooth dots.
      context.moveTo(x - dotRadius, y); context.lineTo(x + dotRadius, y);
      [[row - 1, col], [row, col + 1], [row + 1, col], [row, col - 1]].forEach(([neighborRow, neighborCol]) => {
        const neighborId = `${neighborRow}:${neighborCol}`;
        if (!state.pathIds.has(neighborId)) return;
        context.moveTo(x, y);
        context.lineTo((neighborCol + .5) * cellWidth, (neighborRow + .5) * cellHeight);
      });
    }
    context.strokeStyle = "#e7f6ff";
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  };
  const roadIndex = roadIndexFor(state.grid);
  const recolorRoadSegments = (ids: Iterable<string>, color: string) => {
    if (!roadIndex) return;
    const segmentIds = new Set<number>();
    for (const id of ids) roadIndex.segmentIdsByCell.get(id)?.forEach((segmentId) => segmentIds.add(segmentId));
    context.beginPath();
    segmentIds.forEach((segmentId) => {
      const segment = roadIndex.segments[segmentId];
      context.moveTo(segment.fromX * bounds.width, segment.fromY * bounds.height);
      context.lineTo(segment.toX * bounds.width, segment.toY * bounds.height);
    });
    context.strokeStyle = color;
    // Exactly match the dark-blue source road geometry; only its color changes.
    context.lineWidth = .7;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  };
  const drawEndpoint = (id: string, color: string) => {
    const { x, y } = centerFor(id);
    const radius = Math.max(3, Math.min(cellWidth, cellHeight) * 1.8);
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = color; context.shadowColor = color; context.shadowBlur = radius * 2; context.fill(); context.shadowBlur = 0;
  };
  const drawSearchState = (ids: Iterable<string>) => {
    const frontier: string[] = [], visited: string[] = [], targetFrontier: string[] = [], targetVisited: string[] = [], path: string[] = [];
    for (const id of ids) {
      if (state.pathIds.has(id)) path.push(id);
      else {
        if (state.visitedIds.has(id)) visited.push(id);
        else if (state.frontierIds.has(id)) frontier.push(id);
        if (state.targetVisitedIds.has(id)) targetVisited.push(id);
        else if (state.targetFrontierIds.has(id)) targetFrontier.push(id);
      }
    }
    recolorRoadSegments(frontier, "#268cff");
    recolorRoadSegments(visited, "#38baff");
    recolorRoadSegments(targetFrontier, "#7c4dff");
    recolorRoadSegments(targetVisited, "#c084fc");
    drawPath(path);
  };
  if (gridChanged || resized) {
    context.clearRect(0, 0, bounds.width, bounds.height);
    drawSearchState(new Set([...state.frontierIds, ...state.visitedIds, ...state.targetFrontierIds, ...state.targetVisitedIds, ...state.pathIds]));
  } else drawSearchState(changedIds);
  // Keep the endpoint beacons visible even when the final path passes through them.
  drawEndpoint(state.grid.startId, "#fa543f");
  drawEndpoint(state.grid.targetId, "#24f28d");
};

const updateButtonStates = (
  elements: RenderElements,
  state: VisualizerState,
): void => {
  elements.startButton.disabled = state.isRunning;
  elements.pauseButton.disabled = !state.isRunning;
  elements.pauseButton.textContent = state.isPaused ? "Resume" : "Pause";
  elements.resetButton.disabled =
    !state.isRunning &&
    state.currentEventIndex === 0 &&
    state.visitedCount === 0 &&
    state.frontierCount === 0;
  elements.randomizeButton.disabled = state.isRunning;
  elements.clearButton.disabled = state.isRunning;
  elements.algorithmSelect.disabled = state.isRunning;
  elements.densitySlider.disabled = state.isRunning;
};

export const render = (
  elements: RenderElements,
  state: VisualizerState,
  algorithmLabel: string,
  changedIds: ReadonlySet<string>,
  resetOverlay = false,
): void => {
  elements.gridContainer.style.setProperty("--grid-cols", String(state.grid.cols));
  const gridChanged = renderedGrid !== state.grid;
  if (gridChanged) buildGrid(elements.gridContainer, state);
  const isRecordingGrid = Boolean(elements.gridContainer.closest(".recording-visualizer"));
  if (isRecordingGrid) renderRecordingOverlay(state, gridChanged || resetOverlay, changedIds);
  else {
    const idsToRender = gridChanged ? state.grid.cells.map(cellId) : changedIds;
    idsToRender.forEach((id) => {
      const tile = tilesById.get(id); if (!tile) return;
      tile.classList.toggle("frontier", state.frontierIds.has(id));
      tile.classList.toggle("visited", state.visitedIds.has(id));
      tile.classList.toggle("frontier-target", state.targetFrontierIds.has(id));
      tile.classList.toggle("visited-target", state.targetVisitedIds.has(id));
      tile.classList.toggle("path", state.pathIds.has(id));
      tile.classList.toggle("active", state.activeId === id);
    });
  }

  elements.gridContainer.classList.toggle("missed", state.missed);
  elements.visitedValue.textContent = String(state.visitedCount);
  elements.frontierValue.textContent = String(state.frontierCount);
  elements.pathValue.textContent = state.pathLength > 0 ? String(state.pathLength) : "None";
  elements.targetValue.textContent = state.grid.targetId.replace(":", ", ");
  elements.algorithmValue.textContent = algorithmLabel;

  if (elements.recording) {
    elements.recording.algorithmName.textContent = algorithmLabel;
    elements.recording.stats.textContent = `Nodes: ${state.visitedCount.toLocaleString()}   Time: ${(state.currentEventIndex / 120).toFixed(1)} ms`;
    elements.recording.result.textContent = state.missed
      ? "No path found"
      : state.pathLength > 0
        ? `Path found in ${state.pathLength} steps`
        : state.isRunning
          ? "Searching…"
          : "Ready to search";
  }

  updateButtonStates(elements, state);
};
