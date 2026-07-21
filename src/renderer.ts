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
const tilesById = new Map<string, HTMLButtonElement>();
let renderedFrontier = new Set<string>();
let renderedVisited = new Set<string>();
let renderedPath = new Set<string>();
let renderedActiveId: string | undefined;

const buildGrid = (container: HTMLElement, state: VisualizerState): void => {
  const fragment = document.createDocumentFragment();
  tilesById.clear();
  state.grid.cells.forEach((cell) => {
    const id = cellId(cell);
    const tile = document.createElement("button");
    tile.type = "button";
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
  renderedFrontier = new Set();
  renderedVisited = new Set();
  renderedPath = new Set();
  renderedActiveId = undefined;
};

const syncClass = (className: string, previous: Set<string>, next: Set<string>): Set<string> => {
  previous.forEach((id) => { if (!next.has(id)) tilesById.get(id)?.classList.remove(className); });
  next.forEach((id) => { if (!previous.has(id)) tilesById.get(id)?.classList.add(className); });
  return new Set(next);
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
): void => {
  elements.gridContainer.style.setProperty("--grid-cols", String(state.grid.cols));
  if (renderedGrid !== state.grid) buildGrid(elements.gridContainer, state);
  renderedFrontier = syncClass("frontier", renderedFrontier, state.frontierIds);
  renderedVisited = syncClass("visited", renderedVisited, state.visitedIds);
  renderedPath = syncClass("path", renderedPath, state.pathIds);
  if (renderedActiveId !== state.activeId) {
    if (renderedActiveId) tilesById.get(renderedActiveId)?.classList.remove("active");
    if (state.activeId) tilesById.get(state.activeId)?.classList.add("active");
    renderedActiveId = state.activeId;
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
