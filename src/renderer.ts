import type { Cell, VisualizerState } from "./types";

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
  terrainSlider: HTMLInputElement;
}

const cellId = (cell: Cell): string => `${cell.row}:${cell.col}`;

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
  elements.terrainSlider.disabled = state.isRunning;
};

export const render = (
  elements: RenderElements,
  state: VisualizerState,
  algorithmLabel: string,
): void => {
  elements.gridContainer.style.setProperty("--grid-cols", String(state.grid.cols));
  elements.gridContainer.replaceChildren(
    ...state.grid.cells.map((cell) => {
      const id = cellId(cell);
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "cell";
      tile.dataset.id = id;
      tile.dataset.kind = cell.kind;
      tile.setAttribute(
        "aria-label",
        `${cell.kind} location row ${cell.row + 1}, column ${cell.col + 1}`,
      );
      tile.title = cell.kind === "weight" ? `Weight ${cell.weight}` : cell.kind;

      if (state.frontierIds.has(id)) {
        tile.classList.add("frontier");
      }

      if (state.visitedIds.has(id)) {
        tile.classList.add("visited");
      }

      if (state.pathIds.has(id)) {
        tile.classList.add("path");
      }

      if (state.activeId === id) {
        tile.classList.add("active");
      }

      if (cell.kind === "start") {
        tile.textContent = "S";
      }

      if (cell.kind === "target") {
        tile.textContent = "T";
      }

      if (cell.kind === "weight") {
        tile.textContent = String(cell.weight);
      }

      return tile;
    }),
  );

  elements.gridContainer.classList.toggle("missed", state.missed);
  elements.visitedValue.textContent = String(state.visitedCount);
  elements.frontierValue.textContent = String(state.frontierCount);
  elements.pathValue.textContent = state.pathLength > 0 ? String(state.pathLength) : "None";
  elements.targetValue.textContent = state.grid.targetId.replace(":", ", ");
  elements.algorithmValue.textContent = algorithmLabel;

  updateButtonStates(elements, state);
};
