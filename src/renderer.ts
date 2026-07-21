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
  const fragment = document.createDocumentFragment();
  const isRecordingGrid = Boolean(container.closest(".recording-visualizer"));
  tilesById.clear();
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
  const idsToRender = gridChanged ? state.grid.cells.map(cellId) : changedIds;
  idsToRender.forEach((id) => {
    const tile = tilesById.get(id); if (!tile) return;
    tile.classList.toggle("frontier", state.frontierIds.has(id));
    tile.classList.toggle("visited", state.visitedIds.has(id));
    tile.classList.toggle("path", state.pathIds.has(id));
    tile.classList.toggle("active", state.activeId === id);
  });

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
