import { algorithms } from "./algorithms";
import type { GridSnapshot, SearchEvent } from "./types";

interface SearchRequest {
  id: number;
  algorithmId: string;
  grid: GridSnapshot;
}

const workerScope = self as unknown as { addEventListener: (type: string, listener: (event: MessageEvent<SearchRequest>) => void) => void; postMessage: (message: unknown) => void };

workerScope.addEventListener("message", ({ data }: MessageEvent<SearchRequest>) => {
  const algorithm = algorithms.find((candidate) => candidate.id === data.algorithmId);
  if (!algorithm) { workerScope.postMessage({ type: "error", id: data.id }); return; }
  const events = algorithm.search(data.grid);
  const chunkSize = 2_000;
  for (let index = 0; index < events.length; index += chunkSize) {
    workerScope.postMessage({ type: "events", id: data.id, events: events.slice(index, index + chunkSize) satisfies SearchEvent[] });
  }
  workerScope.postMessage({ type: "complete", id: data.id });
});
