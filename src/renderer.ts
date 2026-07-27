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

const cellId = (cell: Cell): string => `${cell.row}:${cell.col}`;
let renderedGrid: GridSnapshot | undefined;
const tilesById = new Map<string, HTMLElement>();

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
  const drawStrokes = (
    ids: Iterable<string>,
    color: string,
    connectsTo: (id: string) => boolean,
    widthScale = 1,
  ) => {
    const lineWidth = Math.max(.8, Math.min(cellWidth, cellHeight) * widthScale);
    const dotRadius = Math.max(.08, lineWidth * .08);
    context.beginPath();
    for (const id of ids) {
      const { row, col, x, y } = centerFor(id);
      // A tiny round-capped segment makes isolated frontier cells smooth dots.
      context.moveTo(x - dotRadius, y); context.lineTo(x + dotRadius, y);
      [[row - 1, col], [row, col + 1], [row + 1, col], [row, col - 1]].forEach(([neighborRow, neighborCol]) => {
        const neighborId = `${neighborRow}:${neighborCol}`;
        if (!connectsTo(neighborId)) return;
        context.moveTo(x, y);
        context.lineTo((neighborCol + .5) * cellWidth, (neighborRow + .5) * cellHeight);
      });
    }
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
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
  const isSearched = (id: string) => state.visitedIds.has(id) || state.frontierIds.has(id);
  const drawSearchState = (ids: Iterable<string>) => {
    const frontier: string[] = [], visited: string[] = [], path: string[] = [];
    for (const id of ids) {
      if (state.pathIds.has(id)) path.push(id);
      else if (state.visitedIds.has(id)) visited.push(id);
      else if (state.frontierIds.has(id)) frontier.push(id);
    }
    drawStrokes(frontier, "rgba(38, 140, 255, .88)", isSearched);
    drawStrokes(visited, "rgba(56, 186, 255, .94)", isSearched);
    drawStrokes(path, "#e7f6ff", (id) => state.pathIds.has(id), 1.35);
  };
  if (gridChanged || resized) {
    context.clearRect(0, 0, bounds.width, bounds.height);
    drawSearchState(new Set([...state.frontierIds, ...state.visitedIds, ...state.pathIds]));
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
): void => {
  elements.gridContainer.style.setProperty("--grid-cols", String(state.grid.cols));
  const gridChanged = renderedGrid !== state.grid;
  if (gridChanged) buildGrid(elements.gridContainer, state);
  const isRecordingGrid = Boolean(elements.gridContainer.closest(".recording-visualizer"));
  if (isRecordingGrid) renderRecordingOverlay(state, gridChanged, changedIds);
  else {
    const idsToRender = gridChanged ? state.grid.cells.map(cellId) : changedIds;
    idsToRender.forEach((id) => {
      const tile = tilesById.get(id); if (!tile) return;
      tile.classList.toggle("frontier", state.frontierIds.has(id));
      tile.classList.toggle("visited", state.visitedIds.has(id));
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
