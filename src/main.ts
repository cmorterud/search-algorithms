import "./styles.css";
import { algorithms } from "./algorithms";
import { render } from "./renderer";
import { SearchSound } from "./sound";
import type { Cell, GridSnapshot, SearchEvent, VisualizerState } from "./types";

const ROWS = 41;
const COLS = 73;
const DEFAULT_OPENINGS = 9;

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root was not found.");
}

app.innerHTML = `
  <main class="shell">
    <header class="app-header">
      <div>
        <h1>Search Visualizer</h1>
        <p>Search a randomized maze for a specific reachable target location.</p>
      </div>
    </header>

    <section class="visualizer" aria-label="Search visualization">
      <div class="grid-container" id="grid-container"></div>
    </section>

    <section class="controls" aria-label="Controls">
      <button id="randomize-button" type="button">New Maze</button>
      <button id="clear-button" type="button">Open Field</button>
      <button id="start-button" type="button">Start</button>
      <button id="pause-button" type="button">Pause</button>
      <button id="reset-button" type="button">Reset</button>

      <label class="control-field algorithm-field">
        Algorithm
        <select id="algorithm-select"></select>
      </label>

      <label class="control-field compact-field">
        Openings
        <input id="density-slider" type="range" min="0" max="28" value="${DEFAULT_OPENINGS}" />
      </label>

      <label class="control-field compact-field">
        Speed
        <input id="speed-slider" type="range" min="1" max="100" value="58" />
      </label>

      <button id="sound-button" type="button" aria-pressed="true">Sound On</button>

      <label class="control-field compact-field">
        Volume
        <input id="volume-slider" type="range" min="0" max="100" value="42" />
      </label>
    </section>

    <section class="stats" aria-label="Statistics">
      <div>
        <span>Visited</span>
        <strong id="visited-value">0</strong>
      </div>
      <div>
        <span>Frontier</span>
        <strong id="frontier-value">0</strong>
      </div>
      <div>
        <span>Path Length</span>
        <strong id="path-value">None</strong>
      </div>
      <div>
        <span>Target</span>
        <strong id="target-value">0, 0</strong>
      </div>
      <div>
        <span>Algorithm</span>
        <strong id="algorithm-value">Breadth First Search</strong>
      </div>
    </section>
  </main>
`;

const getElement = <T extends HTMLElement>(id: string): T => {
  const element = document.querySelector<T>(id);
  if (!element) {
    throw new Error(`Element ${id} was not found.`);
  }

  return element;
};

const elements = {
  gridContainer: getElement<HTMLElement>("#grid-container"),
  visitedValue: getElement<HTMLElement>("#visited-value"),
  frontierValue: getElement<HTMLElement>("#frontier-value"),
  pathValue: getElement<HTMLElement>("#path-value"),
  targetValue: getElement<HTMLElement>("#target-value"),
  algorithmValue: getElement<HTMLElement>("#algorithm-value"),
  startButton: getElement<HTMLButtonElement>("#start-button"),
  pauseButton: getElement<HTMLButtonElement>("#pause-button"),
  resetButton: getElement<HTMLButtonElement>("#reset-button"),
  randomizeButton: getElement<HTMLButtonElement>("#randomize-button"),
  clearButton: getElement<HTMLButtonElement>("#clear-button"),
  algorithmSelect: getElement<HTMLSelectElement>("#algorithm-select"),
  densitySlider: getElement<HTMLInputElement>("#density-slider"),
  speedSlider: getElement<HTMLInputElement>("#speed-slider"),
  soundButton: getElement<HTMLButtonElement>("#sound-button"),
  volumeSlider: getElement<HTMLInputElement>("#volume-slider"),
};

algorithms.forEach((algorithm) => {
  const option = document.createElement("option");
  option.value = algorithm.id;
  option.textContent = algorithm.label;
  elements.algorithmSelect.append(option);
});

const idFor = (row: number, col: number): string => `${row}:${col}`;

const parseId = (id: string): { row: number; col: number } => {
  const [row, col] = id.split(":").map(Number);
  return { row, col };
};

const cloneGrid = (grid: GridSnapshot): GridSnapshot => ({
  ...grid,
  cells: grid.cells.map((cell) => ({ ...cell })),
});

const shuffle = <T>(items: T[]): T[] => {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
};

const manhattanDistance = (a: string, b: string): number => {
  const from = parseId(a);
  const to = parseId(b);
  return Math.abs(from.row - to.row) + Math.abs(from.col - to.col);
};

const chooseTargetId = (passageIds: string[], startId: string): string => {
  const distantPassages = passageIds
    .filter((id) => id !== startId)
    .sort((a, b) => manhattanDistance(b, startId) - manhattanDistance(a, startId));
  const targetPool = distantPassages.slice(0, Math.max(6, Math.floor(distantPassages.length * 0.25)));

  return targetPool[Math.floor(Math.random() * targetPool.length)] ?? distantPassages[0] ?? startId;
};

const applyEndpoints = (
  cells: Cell[],
  startId: string,
  targetId: string,
): Cell[] =>
  cells.map((cell) => {
    const id = idFor(cell.row, cell.col);
    if (id === startId) {
      return { ...cell, kind: "start" };
    }

    if (id === targetId) {
      return { ...cell, kind: "target" };
    }

    return cell.kind === "wall" ? cell : { ...cell, kind: "empty" };
  });

const createMazeGrid = (openings: number): GridSnapshot => {
  const openIds = new Set<string>();
  const startId = idFor(1, 1);
  const stack = [startId];
  openIds.add(startId);

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const { row, col } = parseId(current);
    const neighbors = shuffle([
      { row: row - 2, col, wallRow: row - 1, wallCol: col },
      { row, col: col + 2, wallRow: row, wallCol: col + 1 },
      { row: row + 2, col, wallRow: row + 1, wallCol: col },
      { row, col: col - 2, wallRow: row, wallCol: col - 1 },
    ]).filter(
      (neighbor) =>
        neighbor.row > 0 &&
        neighbor.row < ROWS - 1 &&
        neighbor.col > 0 &&
        neighbor.col < COLS - 1 &&
        !openIds.has(idFor(neighbor.row, neighbor.col)),
    );

    const next = neighbors[0];
    if (!next) {
      stack.pop();
      continue;
    }

    openIds.add(idFor(next.wallRow, next.wallCol));
    openIds.add(idFor(next.row, next.col));
    stack.push(idFor(next.row, next.col));
  }

  const extraOpenings = Math.floor((openings / 100) * ROWS * COLS);
  const wallCandidates = shuffle(
    Array.from({ length: ROWS * COLS }, (_, index) => ({
      row: Math.floor(index / COLS),
      col: index % COLS,
    })).filter(({ row, col }) => {
      const onEdge = row === 0 || col === 0 || row === ROWS - 1 || col === COLS - 1;
      return !onEdge && !openIds.has(idFor(row, col));
    }),
  );

  wallCandidates.slice(0, extraOpenings).forEach(({ row, col }) => {
    openIds.add(idFor(row, col));
  });

  const targetId = chooseTargetId(Array.from(openIds), startId);
  const cells: Cell[] = [];

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const id = idFor(row, col);
      cells.push({
        row,
        col,
        kind: openIds.has(id) ? "empty" : "wall",
      });
    }
  }

  return {
    rows: ROWS,
    cols: COLS,
    cells: applyEndpoints(cells, startId, targetId),
    startId,
    targetId,
  };
};

const createOpenGrid = (): GridSnapshot => {
  const startId = idFor(Math.floor(ROWS / 2), 3);
  const passageIds = Array.from({ length: ROWS * COLS }, (_, index) =>
    idFor(Math.floor(index / COLS), index % COLS),
  );
  const targetId = chooseTargetId(passageIds, startId);
  const cells: Cell[] = [];

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      cells.push({ row, col, kind: "empty" });
    }
  }

  const grid = {
    rows: ROWS,
    cols: COLS,
    cells: applyEndpoints(cells, startId, targetId),
    startId,
    targetId,
  };

  return {
    ...grid,
    cells: grid.cells.map((cell) =>
      cell.kind === "start" || cell.kind === "target"
        ? cell
        : { ...cell, kind: "empty" },
    ),
  };
};

const createState = (grid: GridSnapshot): VisualizerState => ({
  grid: cloneGrid(grid),
  originalGrid: cloneGrid(grid),
  events: [],
  currentEventIndex: 0,
  isRunning: false,
  isPaused: false,
  visitedCount: 0,
  frontierCount: 0,
  pathLength: 0,
  activeId: undefined,
  visitedIds: new Set<string>(),
  frontierIds: new Set<string>(),
  pathIds: new Set<string>(),
  missed: false,
});

let state = createState(createMazeGrid(DEFAULT_OPENINGS));
let playbackTimer: number | undefined;
const sound = new SearchSound();
sound.setVolume(Number(elements.volumeSlider.value) / 100);

const selectedAlgorithm = () => {
  const algorithm = algorithms.find(
    (candidate) => candidate.id === elements.algorithmSelect.value,
  );

  return algorithm ?? algorithms[0];
};

const renderCurrentState = (): void => {
  render(elements, state, selectedAlgorithm().label);
};

const clearPlaybackTimer = (): void => {
  if (playbackTimer !== undefined) {
    window.clearTimeout(playbackTimer);
    window.cancelAnimationFrame(playbackTimer);
    playbackTimer = undefined;
  }
};

const speedToBatchSize = (): number => {
  const speed = Number(elements.speedSlider.value);
  const normalizedSpeed = speed / 100;

  return Math.max(1, Math.round(1 + normalizedSpeed * normalizedSpeed * 90));
};

const applyEvent = (event: SearchEvent, audible = true): void => {
  state.activeId = undefined;
  if (audible) {
    sound.playEvent(event);
  }

  switch (event.type) {
    case "frontier":
      if (!state.visitedIds.has(event.id) && !state.frontierIds.has(event.id)) {
        state.frontierIds.add(event.id);
        state.frontierCount += 1;
      }
      break;
    case "visit":
      state.activeId = event.id;
      state.frontierIds.delete(event.id);
      if (!state.visitedIds.has(event.id)) {
        state.visitedIds.add(event.id);
        state.visitedCount += 1;
      }
      break;
    case "path":
      state.pathIds = new Set(event.ids);
      state.pathLength = event.ids.length;
      state.activeId = undefined;
      break;
    case "miss":
      state.missed = true;
      state.pathLength = 0;
      break;
    case "clearHighlights":
      state.activeId = undefined;
      break;
  }
};

const finishRun = (): void => {
  state.isRunning = false;
  state.isPaused = false;
  state.activeId = undefined;
  renderCurrentState();
};

const playNextEvent = (): void => {
  clearPlaybackTimer();

  if (!state.isRunning || state.isPaused) {
    renderCurrentState();
    return;
  }

  const batchSize = speedToBatchSize();
  for (let step = 0; step < batchSize; step += 1) {
    const event = state.events[state.currentEventIndex];
    if (!event) {
      finishRun();
      return;
    }

    applyEvent(event, step === batchSize - 1 || state.currentEventIndex === state.events.length - 1);
    state.currentEventIndex += 1;
  }

  renderCurrentState();
  playbackTimer = window.requestAnimationFrame(playNextEvent);
};

const resetRun = (): void => {
  clearPlaybackTimer();
  state = createState(state.originalGrid);
  renderCurrentState();
};

const randomize = (): void => {
  clearPlaybackTimer();
  state = createState(createMazeGrid(Number(elements.densitySlider.value)));
  renderCurrentState();
};

const clearGrid = (): void => {
  clearPlaybackTimer();
  state = createState(createOpenGrid());
  renderCurrentState();
};

const cycleCellKind = (id: string): void => {
  if (state.isRunning) {
    return;
  }

  const nextGrid = cloneGrid(state.grid);
  const cell = nextGrid.cells.find((candidate) => idFor(candidate.row, candidate.col) === id);
  if (!cell || cell.kind === "start" || cell.kind === "target") {
    return;
  }

  if (cell.kind === "empty") {
    cell.kind = "wall";
  } else {
    cell.kind = "empty";
  }

  state = createState(nextGrid);
  renderCurrentState();
};

elements.startButton.addEventListener("click", () => {
  void sound.unlock();
  const algorithm = selectedAlgorithm();

  state.events = algorithm.search(cloneGrid(state.grid));
  state.originalGrid = cloneGrid(state.grid);
  state.currentEventIndex = 0;
  state.isRunning = true;
  state.isPaused = false;
  state.visitedCount = 0;
  state.frontierCount = 0;
  state.pathLength = 0;
  state.activeId = undefined;
  state.visitedIds.clear();
  state.frontierIds.clear();
  state.pathIds.clear();
  state.missed = false;
  renderCurrentState();
  playNextEvent();
});

elements.pauseButton.addEventListener("click", () => {
  if (!state.isRunning) {
    return;
  }

  state.isPaused = !state.isPaused;
  renderCurrentState();

  if (!state.isPaused) {
    playNextEvent();
  }
});

elements.resetButton.addEventListener("click", resetRun);
elements.randomizeButton.addEventListener("click", randomize);
elements.clearButton.addEventListener("click", clearGrid);
elements.algorithmSelect.addEventListener("change", renderCurrentState);
elements.densitySlider.addEventListener("input", randomize);
elements.gridContainer.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const id = target.dataset.id;
  if (id) {
    cycleCellKind(id);
  }
});

elements.soundButton.addEventListener("click", () => {
  const nextEnabled = !sound.isEnabled();
  sound.setEnabled(nextEnabled);
  elements.soundButton.textContent = nextEnabled ? "Sound On" : "Sound Off";
  elements.soundButton.setAttribute("aria-pressed", String(nextEnabled));

  if (nextEnabled) {
    void sound.unlock();
  }
});

elements.volumeSlider.addEventListener("input", () => {
  sound.setVolume(Number(elements.volumeSlider.value) / 100);
});

renderCurrentState();
