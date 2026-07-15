import "./styles.css";
import { algorithms } from "./algorithms";
import { render } from "./renderer";
import { SearchSound } from "./sound";
import type { Cell, GridSnapshot, SearchEvent, VisualizerState } from "./types";

const DEFAULT_OPENINGS = 9;
const STANDARD_SIZE = { rows: 41, cols: 73 };
const PORTRAIT_SIZE = { rows: 31, cols: 17 };
const isRecording = /\/recording\/?$/.test(window.location.pathname);
let gridSize = isRecording ? PORTRAIT_SIZE : STANDARD_SIZE;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root was not found.");

const controls = `
  <section class="controls${isRecording ? " search-recording-controls" : ""}" aria-label="Controls">
    <button id="randomize-button" type="button">New Maze</button>
    <button id="clear-button" type="button">New Field</button>
    <button id="start-button" type="button">Start</button>
    <button id="pause-button" type="button">Pause</button>
    <button id="reset-button" type="button">Reset</button>
    <label class="control-field algorithm-field">Algorithm<select id="algorithm-select"></select></label>
    <label class="control-field compact-field">Openings<input id="density-slider" type="range" min="0" max="28" value="${DEFAULT_OPENINGS}" /></label>
    <label class="control-field compact-field">Speed<input id="speed-slider" type="range" min="1" max="100" value="58" /></label>
    <button id="sound-button" type="button" aria-pressed="true">Sound On</button>
    <label class="control-field compact-field">Volume<input id="volume-slider" type="range" min="0" max="100" value="42" /></label>
  </section>`;

if (isRecording) {
  app.innerHTML = `
    <main class="search-recording-page">
      <div class="search-recording-preview" id="recording-preview">
        <section class="search-recording-canvas" aria-label="Portrait recording canvas">
          <header class="search-recording-header">
            <p class="recording-kicker" id="recording-algorithm-name">Breadth First Search</p>
            <h1 class="search-recording-title" id="recording-title-display">How Search Finds a Path</h1>
            <p class="search-recording-subtitle" id="recording-subtitle-display">Start to target through a random maze</p>
          </header>
          <div class="search-recording-summary"><span>Start</span><b>→</b><span>Target</span><span class="recording-countdown" id="recording-countdown" hidden></span></div>
          <section class="visualizer recording-visualizer" aria-label="Search visualization"><div class="grid-container" id="grid-container"></div></section>
          <footer class="search-recording-footer">
            <p id="recording-stats">Visited 0 · Frontier 0 · Path —</p>
            <strong id="recording-result">Ready to search</strong>
          </footer>
        </section>
      </div>
      <aside class="recording-panel" aria-label="Recording controls">
        <h2>Recording controls</h2>
        <label class="control-field">Title<input id="recording-title" value="How Search Finds a Path" maxlength="72" /></label>
        <label class="control-field">Subtitle<input id="recording-subtitle" value="Start to target through a random maze" maxlength="96" /></label>
        <label class="recording-toggle"><input id="show-algorithm" type="checkbox" checked /> Show algorithm name</label>
        <label class="recording-toggle"><input id="show-stats" type="checkbox" checked /> Show statistics</label>
        <label class="recording-toggle"><input id="show-result" type="checkbox" checked /> Show result</label>
        <label class="recording-toggle"><input id="enable-countdown" type="checkbox" /> 3 second countdown</label>
        <button id="portrait-preset" type="button">Portrait-safe grid (31 × 17)</button>
        <button id="replay-button" type="button">Replay scenario</button>
        <button id="fullscreen-button" type="button">Fullscreen canvas</button>
        <button id="copy-url-button" type="button">Copy recording URL</button>
        ${controls}
      </aside>
    </main>`;
} else {
  app.innerHTML = `
    <main class="shell">
      <header class="app-header"><div><h1>Search Visualizer</h1><p>Search a randomized maze for a specific reachable target location.</p></div></header>
      <section class="visualizer" aria-label="Search visualization"><div class="grid-container" id="grid-container"></div></section>
      ${controls}
      <section class="stats" aria-label="Statistics">
        <div><span>Visited</span><strong id="visited-value">0</strong></div><div><span>Frontier</span><strong id="frontier-value">0</strong></div><div><span>Path Length</span><strong id="path-value">None</strong></div><div><span>Target</span><strong id="target-value">0, 0</strong></div><div><span>Algorithm</span><strong id="algorithm-value">Breadth First Search</strong></div>
      </section>
    </main>`;
}

const getElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Element ${selector} was not found.`);
  return element;
};
const optionalElement = <T extends HTMLElement>(selector: string): T | undefined => document.querySelector<T>(selector) ?? undefined;
const elements = {
  gridContainer: getElement<HTMLElement>("#grid-container"), visitedValue: optionalElement<HTMLElement>("#visited-value") ?? document.createElement("span"), frontierValue: optionalElement<HTMLElement>("#frontier-value") ?? document.createElement("span"), pathValue: optionalElement<HTMLElement>("#path-value") ?? document.createElement("span"), targetValue: optionalElement<HTMLElement>("#target-value") ?? document.createElement("span"), algorithmValue: optionalElement<HTMLElement>("#algorithm-value") ?? document.createElement("span"),
  startButton: getElement<HTMLButtonElement>("#start-button"), pauseButton: getElement<HTMLButtonElement>("#pause-button"), resetButton: getElement<HTMLButtonElement>("#reset-button"), randomizeButton: getElement<HTMLButtonElement>("#randomize-button"), clearButton: getElement<HTMLButtonElement>("#clear-button"), algorithmSelect: getElement<HTMLSelectElement>("#algorithm-select"), densitySlider: getElement<HTMLInputElement>("#density-slider"), speedSlider: getElement<HTMLInputElement>("#speed-slider"), soundButton: getElement<HTMLButtonElement>("#sound-button"), volumeSlider: getElement<HTMLInputElement>("#volume-slider"),
  recording: isRecording ? { algorithmName: getElement<HTMLElement>("#recording-algorithm-name"), stats: getElement<HTMLElement>("#recording-stats"), result: getElement<HTMLElement>("#recording-result") } : undefined,
};
algorithms.forEach((algorithm) => { const option = document.createElement("option"); option.value = algorithm.id; option.textContent = algorithm.label; elements.algorithmSelect.append(option); });

const idFor = (row: number, col: number) => `${row}:${col}`;
const parseId = (id: string) => { const [row, col] = id.split(":").map(Number); return { row, col }; };
const cloneGrid = (grid: GridSnapshot): GridSnapshot => ({ ...grid, cells: grid.cells.map((cell) => ({ ...cell })) });
const shuffle = <T>(items: T[]) => { const result = [...items]; for (let i = result.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; };
const manhattanDistance = (a: string, b: string) => { const from = parseId(a); const to = parseId(b); return Math.abs(from.row - to.row) + Math.abs(from.col - to.col); };
const chooseTargetId = (passages: string[], startId: string) => { const ordered = passages.filter((id) => id !== startId).sort((a, b) => manhattanDistance(b, startId) - manhattanDistance(a, startId)); const pool = ordered.slice(0, Math.max(6, Math.floor(ordered.length * .25))); return pool[Math.floor(Math.random() * pool.length)] ?? ordered[0] ?? startId; };
const applyEndpoints = (cells: Cell[], startId: string, targetId: string): Cell[] => cells.map((cell) => { const id = idFor(cell.row, cell.col); return id === startId ? { ...cell, kind: "start" } : id === targetId ? { ...cell, kind: "target" } : cell.kind === "wall" ? cell : { ...cell, kind: "empty" }; });
const createMazeGrid = (openings: number): GridSnapshot => {
  const { rows, cols } = gridSize; const open = new Set<string>(); const startId = idFor(1, 1); const stack = [startId]; open.add(startId);
  while (stack.length) { const current = stack[stack.length - 1]; const { row, col } = parseId(current); const neighbors = shuffle([{ row: row - 2, col, wallRow: row - 1, wallCol: col }, { row, col: col + 2, wallRow: row, wallCol: col + 1 }, { row: row + 2, col, wallRow: row + 1, wallCol: col }, { row, col: col - 2, wallRow: row, wallCol: col - 1 }]).filter((n) => n.row > 0 && n.row < rows - 1 && n.col > 0 && n.col < cols - 1 && !open.has(idFor(n.row, n.col))); const next = neighbors[0]; if (!next) { stack.pop(); continue; } open.add(idFor(next.wallRow, next.wallCol)); open.add(idFor(next.row, next.col)); stack.push(idFor(next.row, next.col)); }
  const candidates = shuffle(Array.from({ length: rows * cols }, (_, i) => ({ row: Math.floor(i / cols), col: i % cols })).filter(({ row, col }) => row > 0 && col > 0 && row < rows - 1 && col < cols - 1 && !open.has(idFor(row, col)))); candidates.slice(0, Math.floor((openings / 100) * rows * cols)).forEach(({ row, col }) => open.add(idFor(row, col)));
  const targetId = chooseTargetId([...open], startId); const cells: Cell[] = Array.from({ length: rows * cols }, (_, i) => { const row = Math.floor(i / cols); const col = i % cols; return { row, col, kind: open.has(idFor(row, col)) ? "empty" as const : "wall" as const }; }); return { rows, cols, cells: applyEndpoints(cells, startId, targetId), startId, targetId };
};
const createOpenGrid = (): GridSnapshot => { const { rows, cols } = gridSize; const startId = idFor(Math.floor(rows / 2), 1); const ids = Array.from({ length: rows * cols }, (_, i) => idFor(Math.floor(i / cols), i % cols)); const targetId = chooseTargetId(ids, startId); return { rows, cols, cells: applyEndpoints(ids.map((id) => { const { row, col } = parseId(id); return { row, col, kind: "empty" as const }; }), startId, targetId), startId, targetId }; };
const createState = (grid: GridSnapshot): VisualizerState => ({ grid: cloneGrid(grid), originalGrid: cloneGrid(grid), events: [], currentEventIndex: 0, isRunning: false, isPaused: false, visitedCount: 0, frontierCount: 0, pathLength: 0, activeId: undefined, visitedIds: new Set(), frontierIds: new Set(), pathIds: new Set(), missed: false });
let state = createState(createMazeGrid(DEFAULT_OPENINGS)); let playbackTimer: number | undefined; let countdownTimer: number | undefined; const sound = new SearchSound(); sound.setVolume(Number(elements.volumeSlider.value) / 100);
const selectedAlgorithm = () => algorithms.find((candidate) => candidate.id === elements.algorithmSelect.value) ?? algorithms[0];
const renderCurrentState = () => render(elements, state, selectedAlgorithm().label);
const clearPlaybackTimer = () => { if (playbackTimer !== undefined) { window.cancelAnimationFrame(playbackTimer); playbackTimer = undefined; } };
const applyEvent = (event: SearchEvent, audible = true) => { state.activeId = undefined; if (audible) sound.playEvent(event); if (event.type === "frontier" && !state.visitedIds.has(event.id) && !state.frontierIds.has(event.id)) { state.frontierIds.add(event.id); state.frontierCount += 1; } else if (event.type === "visit") { state.activeId = event.id; state.frontierIds.delete(event.id); if (!state.visitedIds.has(event.id)) { state.visitedIds.add(event.id); state.visitedCount += 1; } } else if (event.type === "path") { state.pathIds = new Set(event.ids); state.pathLength = event.ids.length; } else if (event.type === "miss") { state.missed = true; state.pathLength = 0; } };
const finishRun = () => { state.isRunning = false; state.isPaused = false; state.activeId = undefined; renderCurrentState(); };
const playNextEvent = () => { clearPlaybackTimer(); if (!state.isRunning || state.isPaused) return renderCurrentState(); const speed = Number(elements.speedSlider.value) / 100; const batch = Math.max(1, Math.round(1 + speed * speed * 90)); for (let i = 0; i < batch; i += 1) { const event = state.events[state.currentEventIndex]; if (!event) return finishRun(); applyEvent(event, i === batch - 1); state.currentEventIndex += 1; } renderCurrentState(); playbackTimer = window.requestAnimationFrame(playNextEvent); };
const beginRun = () => { void sound.unlock(); const algorithm = selectedAlgorithm(); state.events = algorithm.search(cloneGrid(state.grid)); state.originalGrid = cloneGrid(state.grid); state.currentEventIndex = 0; state.isRunning = true; state.isPaused = false; state.visitedCount = 0; state.frontierCount = 0; state.pathLength = 0; state.activeId = undefined; state.visitedIds.clear(); state.frontierIds.clear(); state.pathIds.clear(); state.missed = false; renderCurrentState(); playNextEvent(); };
const resetRun = () => { clearPlaybackTimer(); state = createState(state.originalGrid); renderCurrentState(); };
const randomize = () => { clearPlaybackTimer(); state = createState(createMazeGrid(Number(elements.densitySlider.value))); renderCurrentState(); };
const clearGrid = () => { clearPlaybackTimer(); state = createState(createOpenGrid()); renderCurrentState(); };
const cycleCellKind = (id: string) => { if (state.isRunning) return; const grid = cloneGrid(state.grid); const cell = grid.cells.find((candidate) => idFor(candidate.row, candidate.col) === id); if (!cell || cell.kind === "start" || cell.kind === "target") return; cell.kind = cell.kind === "empty" ? "wall" : "empty"; state = createState(grid); renderCurrentState(); };
elements.startButton.addEventListener("click", beginRun); elements.pauseButton.addEventListener("click", () => { if (!state.isRunning) return; state.isPaused = !state.isPaused; renderCurrentState(); if (!state.isPaused) playNextEvent(); }); elements.resetButton.addEventListener("click", resetRun); elements.randomizeButton.addEventListener("click", randomize); elements.clearButton.addEventListener("click", clearGrid); elements.algorithmSelect.addEventListener("change", renderCurrentState); elements.densitySlider.addEventListener("input", randomize); elements.gridContainer.addEventListener("click", (event) => { const target = event.target; if (target instanceof HTMLElement && target.dataset.id) cycleCellKind(target.dataset.id); }); elements.soundButton.addEventListener("click", () => { const enabled = !sound.isEnabled(); sound.setEnabled(enabled); elements.soundButton.textContent = enabled ? "Sound On" : "Sound Off"; elements.soundButton.setAttribute("aria-pressed", String(enabled)); if (enabled) void sound.unlock(); }); elements.volumeSlider.addEventListener("input", () => sound.setVolume(Number(elements.volumeSlider.value) / 100));
if (isRecording) {
  const title = getElement<HTMLInputElement>("#recording-title"), subtitle = getElement<HTMLInputElement>("#recording-subtitle"), titleDisplay = getElement<HTMLElement>("#recording-title-display"), subtitleDisplay = getElement<HTMLElement>("#recording-subtitle-display"), algorithm = getElement<HTMLInputElement>("#show-algorithm"), stats = getElement<HTMLInputElement>("#show-stats"), result = getElement<HTMLInputElement>("#show-result"), countdown = getElement<HTMLInputElement>("#enable-countdown"), countdownDisplay = getElement<HTMLElement>("#recording-countdown");
  title.addEventListener("input", () => titleDisplay.textContent = title.value || "How Search Finds a Path"); subtitle.addEventListener("input", () => subtitleDisplay.textContent = subtitle.value); algorithm.addEventListener("change", () => elements.recording?.algorithmName.toggleAttribute("hidden", !algorithm.checked)); stats.addEventListener("change", () => elements.recording?.stats.toggleAttribute("hidden", !stats.checked)); result.addEventListener("change", () => elements.recording?.result.toggleAttribute("hidden", !result.checked));
  getElement<HTMLButtonElement>("#portrait-preset").addEventListener("click", () => { gridSize = PORTRAIT_SIZE; randomize(); }); getElement<HTMLButtonElement>("#replay-button").addEventListener("click", () => { resetRun(); beginRun(); }); getElement<HTMLButtonElement>("#fullscreen-button").addEventListener("click", () => void getElement<HTMLElement>("#recording-preview").requestFullscreen?.()); getElement<HTMLButtonElement>("#copy-url-button").addEventListener("click", async (event) => { await navigator.clipboard?.writeText(window.location.href); (event.currentTarget as HTMLButtonElement).textContent = "Recording URL copied"; });
  elements.startButton.addEventListener("click", (event) => { if (!countdown.checked || state.isRunning) return; event.stopImmediatePropagation(); if (countdownTimer) window.clearInterval(countdownTimer); let seconds = 3; countdownDisplay.hidden = false; countdownDisplay.textContent = String(seconds); countdownTimer = window.setInterval(() => { seconds -= 1; countdownDisplay.textContent = seconds ? String(seconds) : "Go"; if (seconds < 0) { window.clearInterval(countdownTimer); countdownDisplay.hidden = true; beginRun(); } }, 1000); }, { capture: true });
}
renderCurrentState();
