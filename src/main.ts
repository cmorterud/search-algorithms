import "./styles.css";
import { algorithms } from "./algorithms";
import { render } from "./renderer";
import { SearchSound } from "./sound";
import type { Cell, GridSnapshot, SearchEvent, VisualizerState } from "./types";

const DEFAULT_OPENINGS = 9;
const STANDARD_SIZE = { rows: 41, cols: 73 };
// Dense enough for real street geometry to read as fine road segments in portrait.
const PORTRAIT_SIZE = { rows: 292, cols: 180 };
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
            <div class="recording-heading">
              <p class="recording-kicker" id="recording-algorithm-name">Search algorithm</p>
              <h1 class="search-recording-title" id="recording-title-display">Search Algorithm</h1>
              <p class="search-recording-subtitle" id="recording-subtitle-display">A live route search across an imagined city</p>
            </div>
            <div class="recording-metrics"><span id="recording-complexity">TC: O(V + E)</span><p id="recording-stats">Nodes: 0 &nbsp; Time: 0.0 ms</p></div>
          </header>
          <div class="search-recording-summary"><span class="recording-countdown" id="recording-countdown" hidden></span></div>
          <section class="visualizer recording-visualizer" aria-label="Search visualization"><canvas class="city-graph-canvas" id="city-graph-canvas" aria-hidden="true"></canvas><div class="grid-container" id="grid-container"></div></section>
          <footer class="search-recording-footer">
            <strong id="recording-result">Ready to search</strong>
            <span class="recording-city-label" id="recording-city-label">LOADING CITY</span>
          </footer>
        </section>
        <div class="recording-guides" aria-hidden="true"><span>9:16 · recording frame</span></div>
      </div>
      <aside class="recording-panel" aria-label="Recording controls">
        <h2>Recording controls</h2>
        <label class="control-field">Title<input id="recording-title" value="Search Algorithm" maxlength="72" /></label>
        <label class="control-field">Subtitle<input id="recording-subtitle" value="A live route search across an imagined city" maxlength="96" /></label>
        <label class="recording-toggle"><input id="show-algorithm" type="checkbox" checked /> Show algorithm name</label>
        <label class="recording-toggle"><input id="show-stats" type="checkbox" checked /> Show statistics</label>
        <label class="recording-toggle"><input id="show-result" type="checkbox" checked /> Show result</label>
        <label class="recording-toggle"><input id="show-guides" type="checkbox" checked /> Show 9:16 guides</label>
        <label class="recording-toggle"><input id="enable-countdown" type="checkbox" /> 3 second countdown</label>
        <button id="portrait-preset" type="button">Reload city layout</button>
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
interface CityGraph { name: string; source: string; nodes: { id: string; x: number; y: number }[]; edges: { from: string; to: string; weight: number }[]; }
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
const createCityGrid = (): GridSnapshot => {
  const { rows, cols } = gridSize;
  const streets = new Set<string>();
  const carve = (row: number, col: number, width = 0) => {
    for (let r = row - width; r <= row + width; r += 1) for (let c = col - width; c <= col + width; c += 1) if (r > 0 && r < rows - 1 && c > 0 && c < cols - 1) streets.add(idFor(r, c));
  };
  const route = (from: [number, number], to: [number, number], width = 0) => {
    let [row, col] = from; const [endRow, endCol] = to;
    while (row !== endRow || col !== endCol) { carve(row, col, width); if (col !== endCol && (row === endRow || Math.random() < .62)) col += Math.sign(endCol - col); else if (row !== endRow) row += Math.sign(endRow - row); }
    carve(endRow, endCol, width);
  };
  const hubs: [number, number][] = [[29, 3], [12, 8], [23, 12], [39, 12], [8, 18], [27, 19], [45, 20], [15, 27], [31, 29], [47, 28], [29, 32]];
  [[0,1],[0,2],[1,4],[2,5],[3,6],[4,7],[5,8],[6,9],[7,10],[8,10],[9,2],[9,7],[2,10],[3,9],[4,6]].forEach(([a, b]) => route(hubs[a], hubs[b], (a === 0 || b === 10) ? 1 : 0));
  hubs.slice(1, -1).forEach(([baseRow, baseCol], district) => {
    const spread = 3 + (district % 3);
    for (let offset = -spread; offset <= spread; offset += 2) { route([Math.max(2, baseRow - spread), Math.max(2, baseCol + offset)], [Math.min(rows - 3, baseRow + spread), Math.max(2, baseCol + offset)]); route([Math.max(2, baseRow + offset), Math.max(2, baseCol - spread)], [Math.max(2, baseRow + offset), Math.min(cols - 3, baseCol + spread)]); }
  });
  const startId = idFor(29, 3), targetId = idFor(29, 32);
  const cells = Array.from({ length: rows * cols }, (_, i) => { const row = Math.floor(i / cols), col = i % cols; return { row, col, kind: streets.has(idFor(row, col)) ? "empty" as const : "wall" as const }; });
  return { rows, cols, cells: applyEndpoints(cells, startId, targetId), startId, targetId };
};
const createGridFromCityGraph = (city: CityGraph): GridSnapshot => {
  const { rows, cols } = gridSize;
  const streets = new Set<string>();
  const nodeById = new Map(city.nodes.map((node) => [node.id, node]));
  const pointFor = (node: { x: number; y: number }) => ({ row: Math.round(1 + node.y * (rows - 3)), col: Math.round(1 + node.x * (cols - 3)) });
  const carveLine = (from: { row: number; col: number }, to: { row: number; col: number }) => {
    let { row, col } = from; const rowStep = Math.sign(to.row - row), colStep = Math.sign(to.col - col); const rowDistance = Math.abs(to.row - row), colDistance = Math.abs(to.col - col); let error = rowDistance - colDistance;
    while (true) { streets.add(idFor(row, col)); if (row === to.row && col === to.col) break; const doubled = error * 2; if (doubled > -colDistance) { error -= colDistance; row += rowStep; } if (doubled < rowDistance) { error += rowDistance; col += colStep; } }
  };
  city.edges.forEach((edge) => { const from = nodeById.get(edge.from), to = nodeById.get(edge.to); if (from && to) carveLine(pointFor(from), pointFor(to)); });
  const adjacent = new Map<string, string[]>();
  city.edges.forEach(({ from, to }) => { adjacent.set(from, [...(adjacent.get(from) ?? []), to]); adjacent.set(to, [...(adjacent.get(to) ?? []), from]); });
  const seen = new Set<string>(); let largest: string[] = [];
  adjacent.forEach((_, seed) => { if (seen.has(seed)) return; const component: string[] = [], queue = [seed]; seen.add(seed); while (queue.length) { const current = queue.pop(); if (!current) continue; component.push(current); (adjacent.get(current) ?? []).forEach((neighbor) => { if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); } }); } if (component.length > largest.length) largest = component; });
  const connectedNodes = largest.map((id) => nodeById.get(id)).filter((node): node is { id: string; x: number; y: number } => Boolean(node));
  // Favor opposite, slightly inset corners while staying on one connected road component.
  const distanceTo = (node: { x: number; y: number }, x: number, y: number) => (node.x - x) ** 2 + (node.y - y) ** 2;
  const startNode = connectedNodes.reduce((best, node) => distanceTo(node, .18, .78) < distanceTo(best, .18, .78) ? node : best, connectedNodes[0]);
  const targetNode = connectedNodes.reduce((best, node) => distanceTo(node, .82, .22) < distanceTo(best, .82, .22) ? node : best, connectedNodes[0]);
  const startPoint = pointFor(startNode), targetPoint = pointFor(targetNode); const startId = idFor(startPoint.row, startPoint.col), targetId = idFor(targetPoint.row, targetPoint.col);
  const cells = Array.from({ length: rows * cols }, (_, i) => { const row = Math.floor(i / cols), col = i % cols; return { row, col, kind: streets.has(idFor(row, col)) ? "empty" as const : "wall" as const }; });
  return { rows, cols, cells: applyEndpoints(cells, startId, targetId), startId, targetId };
};
const createState = (grid: GridSnapshot): VisualizerState => ({ grid: cloneGrid(grid), originalGrid: cloneGrid(grid), events: [], currentEventIndex: 0, isRunning: false, isPaused: false, visitedCount: 0, frontierCount: 0, pathLength: 0, activeId: undefined, visitedIds: new Set(), frontierIds: new Set(), pathIds: new Set(), missed: false });
let loadedCity: CityGraph | undefined;
let state = createState(isRecording ? createCityGrid() : createMazeGrid(DEFAULT_OPENINGS)); let playbackTimer: number | undefined; let countdownTimer: number | undefined; let playbackStartedAt = 0; const sound = new SearchSound(); sound.setVolume(Number(elements.volumeSlider.value) / 100);
const searchWorker = new Worker(new URL("./search-worker.ts", import.meta.url), { type: "module" });
let searchJobId = 0;
let preparingSearch = false;
let pendingEvents: SearchEvent[] = [];
let changedCellIds = new Set<string>();
const drawCityGraph = () => {
  const canvas = optionalElement<HTMLCanvasElement>("#city-graph-canvas"); if (!canvas || !loadedCity) return;
  const bounds = canvas.getBoundingClientRect(), pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * pixelRatio); canvas.height = Math.round(bounds.height * pixelRatio);
  const context = canvas.getContext("2d"); if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); context.clearRect(0, 0, bounds.width, bounds.height);
  const nodes = new Map(loadedCity.nodes.map((node) => [node.id, node]));
  context.beginPath();
  loadedCity.edges.forEach((edge) => { const from = nodes.get(edge.from), to = nodes.get(edge.to); if (!from || !to) return; context.moveTo(from.x * bounds.width, from.y * bounds.height); context.lineTo(to.x * bounds.width, to.y * bounds.height); });
  context.strokeStyle = "rgba(67, 116, 194, .58)"; context.lineWidth = .7; context.stroke();
};
if (isRecording) {
  const canvas = optionalElement<HTMLCanvasElement>("#city-graph-canvas");
  if (canvas) new ResizeObserver(() => drawCityGraph()).observe(canvas);
}
const selectedAlgorithm = () => algorithms.find((candidate) => candidate.id === elements.algorithmSelect.value) ?? algorithms[0];
const complexityFor = (algorithmId: string) => ({ bfs: "TC: O(V + E)", dfs: "TC: O(V + E)", dijkstra: "TC: O((V + E) log V)", astar: "TC: O((V + E) log V)" }[algorithmId] ?? "TC: —");
const renderCurrentState = () => { const algorithm = selectedAlgorithm(); render(elements, state, algorithm.label, changedCellIds); changedCellIds = new Set(); elements.startButton.disabled = state.isRunning || preparingSearch; const title = optionalElement<HTMLElement>("#recording-title-display"); if (title) title.textContent = algorithm.label; const complexity = optionalElement<HTMLElement>("#recording-complexity"); if (complexity) complexity.textContent = complexityFor(elements.algorithmSelect.value); };
const loadRecordingCity = async () => {
  const requested = new URLSearchParams(window.location.search).get("city") ?? "ann-arbor";
  if (!/^[a-z0-9-]+$/i.test(requested)) return;
  try {
    const asset = `cities/${requested}.json`;
    const sources = [
      new URL(asset, new URL(import.meta.env.BASE_URL, window.location.origin)).toString(),
      new URL(asset, window.location.href).toString(),
      new URL(`/cities/${requested}.json`, window.location.origin).toString(),
      new URL(`/search-algorithms/cities/${requested}.json`, window.location.origin).toString(),
    ];
    let city: CityGraph | undefined;
    for (const source of [...new Set(sources)]) {
      try { const response = await fetch(source); if (response.ok) { city = await response.json() as CityGraph; break; } } catch { /* Try the next valid app base path. */ }
    }
    if (!city) throw new Error("City graph was not found");
    loadedCity = city;
    state = createState(createGridFromCityGraph(city));
    const label = optionalElement<HTMLElement>("#recording-city-label"); if (label) label.textContent = city.name.split(",")[0].toUpperCase();
    window.requestAnimationFrame(drawCityGraph);
    renderCurrentState();
  } catch (error) {
    const label = optionalElement<HTMLElement>("#recording-city-label"); if (label) label.textContent = "CITY DATA UNAVAILABLE";
    console.warn("Using the generated city fallback.", error);
  }
};
const clearPlaybackTimer = () => { if (playbackTimer !== undefined) { window.cancelAnimationFrame(playbackTimer); playbackTimer = undefined; } };
const applyEvent = (event: SearchEvent, audible = true) => { if (state.activeId) changedCellIds.add(state.activeId); state.activeId = undefined; if (audible || event.type === "path" || event.type === "miss") sound.playEvent(event, state.currentEventIndex / Math.max(1, state.events.length - 1)); if (event.type === "frontier" && !state.visitedIds.has(event.id) && !state.frontierIds.has(event.id)) { state.frontierIds.add(event.id); changedCellIds.add(event.id); state.frontierCount += 1; } else if (event.type === "visit") { state.activeId = event.id; changedCellIds.add(event.id); state.frontierIds.delete(event.id); if (!state.visitedIds.has(event.id)) { state.visitedIds.add(event.id); state.visitedCount += 1; } } else if (event.type === "path") { state.pathIds = new Set(event.ids); event.ids.forEach((id) => changedCellIds.add(id)); state.pathLength = event.ids.length; } else if (event.type === "miss") { state.missed = true; state.pathLength = 0; } };
const finishRun = () => { sound.stopHum(); if (state.activeId) changedCellIds.add(state.activeId); state.isRunning = false; state.isPaused = false; state.activeId = undefined; renderCurrentState(); };
const playNextEvent = () => { clearPlaybackTimer(); if (!state.isRunning || state.isPaused) return renderCurrentState(); const speed = Number(elements.speedSlider.value) / 100; const targetBatch = 1 + speed ** 1.6 * 400; const ramp = Math.min(1, (performance.now() - playbackStartedAt) / 550); const batch = Math.max(1, Math.round(1 + (targetBatch - 1) * ramp)); for (let i = 0; i < batch; i += 1) { const event = state.events[state.currentEventIndex]; if (!event) return finishRun(); applyEvent(event, i === batch - 1); state.currentEventIndex += 1; } renderCurrentState(); playbackTimer = window.requestAnimationFrame(playNextEvent); };
const cancelPendingSearch = () => { searchJobId += 1; preparingSearch = false; pendingEvents = []; };
const startPlayback = (events: SearchEvent[]) => { state.events = events; state.currentEventIndex = 0; state.isRunning = true; state.isPaused = false; state.visitedCount = 0; state.frontierCount = 0; state.pathLength = 0; state.activeId = undefined; state.visitedIds.clear(); state.frontierIds.clear(); state.pathIds.clear(); state.missed = false; playbackStartedAt = performance.now(); renderCurrentState(); playNextEvent(); };
const beginRun = () => { if (preparingSearch || state.isRunning) return; void sound.unlock(); state.originalGrid = cloneGrid(state.grid); const id = ++searchJobId; pendingEvents = []; preparingSearch = true; renderCurrentState(); searchWorker.postMessage({ id, algorithmId: selectedAlgorithm().id, grid: cloneGrid(state.grid) }); };
searchWorker.addEventListener("message", ({ data }: MessageEvent<{ type: "events" | "complete" | "error"; id: number; events?: SearchEvent[] }>) => { if (data.id !== searchJobId) return; if (data.type === "events" && data.events) { pendingEvents.push(...data.events); return; } preparingSearch = false; if (data.type === "complete") startPlayback(pendingEvents); else renderCurrentState(); });
const resetRun = () => { cancelPendingSearch(); clearPlaybackTimer(); sound.stopHum(); state = createState(state.originalGrid); renderCurrentState(); };
const randomize = () => { cancelPendingSearch(); clearPlaybackTimer(); sound.stopHum(); state = createState(isRecording ? (loadedCity ? createGridFromCityGraph(loadedCity) : createCityGrid()) : createMazeGrid(Number(elements.densitySlider.value))); renderCurrentState(); };
const clearGrid = () => { cancelPendingSearch(); clearPlaybackTimer(); sound.stopHum(); state = createState(createOpenGrid()); renderCurrentState(); };
const cycleCellKind = (id: string) => { if (state.isRunning || preparingSearch) return; const grid = cloneGrid(state.grid); const cell = grid.cells.find((candidate) => idFor(candidate.row, candidate.col) === id); if (!cell || cell.kind === "start" || cell.kind === "target") return; cell.kind = cell.kind === "empty" ? "wall" : "empty"; state = createState(grid); renderCurrentState(); };
elements.startButton.addEventListener("click", beginRun); elements.pauseButton.addEventListener("click", () => { if (!state.isRunning) return; state.isPaused = !state.isPaused; if (state.isPaused) sound.stopHum(); renderCurrentState(); if (!state.isPaused) playNextEvent(); }); elements.resetButton.addEventListener("click", resetRun); elements.randomizeButton.addEventListener("click", randomize); elements.clearButton.addEventListener("click", clearGrid); elements.algorithmSelect.addEventListener("change", renderCurrentState); elements.densitySlider.addEventListener("input", randomize); elements.gridContainer.addEventListener("click", (event) => { const target = event.target; if (target instanceof HTMLElement && target.dataset.id) cycleCellKind(target.dataset.id); }); elements.soundButton.addEventListener("click", () => { const enabled = !sound.isEnabled(); sound.setEnabled(enabled); if (!enabled) sound.stopHum(); elements.soundButton.textContent = enabled ? "Sound On" : "Sound Off"; elements.soundButton.setAttribute("aria-pressed", String(enabled)); if (enabled) void sound.unlock(); }); elements.volumeSlider.addEventListener("input", () => sound.setVolume(Number(elements.volumeSlider.value) / 100));
if (isRecording) {
  const title = getElement<HTMLInputElement>("#recording-title"), subtitle = getElement<HTMLInputElement>("#recording-subtitle"), titleDisplay = getElement<HTMLElement>("#recording-title-display"), subtitleDisplay = getElement<HTMLElement>("#recording-subtitle-display"), algorithm = getElement<HTMLInputElement>("#show-algorithm"), stats = getElement<HTMLInputElement>("#show-stats"), result = getElement<HTMLInputElement>("#show-result"), guides = getElement<HTMLInputElement>("#show-guides"), countdown = getElement<HTMLInputElement>("#enable-countdown"), countdownDisplay = getElement<HTMLElement>("#recording-countdown");
  title.addEventListener("input", () => titleDisplay.textContent = title.value || "How Search Finds a Path"); subtitle.addEventListener("input", () => subtitleDisplay.textContent = subtitle.value); algorithm.addEventListener("change", () => elements.recording?.algorithmName.toggleAttribute("hidden", !algorithm.checked)); stats.addEventListener("change", () => elements.recording?.stats.toggleAttribute("hidden", !stats.checked)); result.addEventListener("change", () => elements.recording?.result.toggleAttribute("hidden", !result.checked)); guides.addEventListener("change", () => getElement<HTMLElement>("#recording-preview").classList.toggle("guides-hidden", !guides.checked));
  getElement<HTMLButtonElement>("#portrait-preset").addEventListener("click", () => { gridSize = PORTRAIT_SIZE; randomize(); }); getElement<HTMLButtonElement>("#replay-button").addEventListener("click", () => { resetRun(); beginRun(); }); getElement<HTMLButtonElement>("#fullscreen-button").addEventListener("click", () => void getElement<HTMLElement>("#recording-preview").requestFullscreen?.()); getElement<HTMLButtonElement>("#copy-url-button").addEventListener("click", async (event) => { await navigator.clipboard?.writeText(window.location.href); (event.currentTarget as HTMLButtonElement).textContent = "Recording URL copied"; });
  elements.startButton.addEventListener("click", (event) => { if (!countdown.checked || state.isRunning || preparingSearch) return; event.stopImmediatePropagation(); if (countdownTimer) window.clearInterval(countdownTimer); let seconds = 3; countdownDisplay.hidden = false; countdownDisplay.textContent = String(seconds); countdownTimer = window.setInterval(() => { seconds -= 1; countdownDisplay.textContent = seconds ? String(seconds) : "Go"; if (seconds < 0) { window.clearInterval(countdownTimer); countdownDisplay.hidden = true; beginRun(); } }, 1000); }, { capture: true });
}
renderCurrentState();
if (isRecording) void loadRecordingCity();
