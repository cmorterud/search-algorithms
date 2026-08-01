import type { SearchEvent } from "./types";

export const RECORDING_FRAME_RATE = 60;
export const DEFAULT_RECORDING_SPEED = 58;
export const DEFAULT_RECORDING_VOLUME = 42;
export const DEFAULT_RECORDING_LEAD_SECONDS = 1;
export const DEFAULT_RECORDING_TAIL_SECONDS = 1;
export const PLAYBACK_RAMP_MILLISECONDS = 550;
export const PLAYBACK_RESTART_HOLD_MILLISECONDS = 650;

export interface RecordingConfig {
  render: boolean;
  city: string;
  algorithm: string;
  speed: number;
  volume: number;
  rotation?: number;
  zoom: number;
  showAlgorithm: boolean;
  showStats: boolean;
  showResult: boolean;
  leadSeconds: number;
  tailSeconds: number;
}

export interface RecordingTimelineFrame {
  eventEndIndex: number;
  phase: "lead" | "playback" | "tail";
}

export type RecordingAudioCue =
  | { type: "hum"; timeSeconds: number; frequency: number }
  | { type: "success"; timeSeconds: number; pitch: number }
  | { type: "miss"; timeSeconds: number; frequency: number }
  | { type: "stop"; timeSeconds: number };

export interface RecordingTimeline {
  fps: number;
  durationSeconds: number;
  frames: RecordingTimelineFrame[];
  audioCues: RecordingAudioCue[];
}

export interface RecordingRenderMetadata {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationSeconds: number;
  city: string;
  algorithm: string;
}

export interface RecordingAutomationApi {
  ready(): Promise<void>;
  prepare(): Promise<RecordingRenderMetadata>;
  renderFrame(index: number): Promise<{ index: number; phase: RecordingTimelineFrame["phase"] }>;
  downloadAudio(): Promise<void>;
}

declare global {
  interface Window {
    __searchRecording?: RecordingAutomationApi;
  }
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const optionalNumber = (
  parameters: URLSearchParams,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined => {
  if (!parameters.has(name)) return undefined;
  const value = Number(parameters.get(name));
  return Number.isFinite(value) ? clamp(value, minimum, maximum) : undefined;
};

const booleanParameter = (parameters: URLSearchParams, name: string, fallback: boolean): boolean => {
  const value = parameters.get(name);
  if (value === null) return fallback;
  return !["0", "false", "off", "no"].includes(value.toLowerCase());
};

export const parseRecordingConfig = (
  input: string | URL,
  cityIds: readonly string[],
  algorithmIds: readonly string[],
): RecordingConfig => {
  const url = input instanceof URL ? input : new URL(input, "https://recording.local");
  const city = url.searchParams.get("city") ?? cityIds[0] ?? "";
  const algorithm = url.searchParams.get("algorithm") ?? algorithmIds[0] ?? "";
  const render = booleanParameter(url.searchParams, "render", false);
  if (render && !cityIds.includes(city)) throw new Error(`Unknown recording city: ${city}`);
  if (render && !algorithmIds.includes(algorithm)) throw new Error(`Unknown recording algorithm: ${algorithm}`);

  return {
    render,
    city: cityIds.includes(city) ? city : cityIds[0] ?? "",
    algorithm: algorithmIds.includes(algorithm) ? algorithm : algorithmIds[0] ?? "",
    speed: optionalNumber(url.searchParams, "speed", 1, 100) ?? DEFAULT_RECORDING_SPEED,
    volume: optionalNumber(url.searchParams, "volume", 0, 100) ?? DEFAULT_RECORDING_VOLUME,
    rotation: optionalNumber(url.searchParams, "rotation", -180, 180),
    zoom: optionalNumber(url.searchParams, "zoom", .8, 1.3) ?? 1,
    showAlgorithm: booleanParameter(url.searchParams, "showAlgorithm", true),
    showStats: booleanParameter(url.searchParams, "showStats", true),
    showResult: booleanParameter(url.searchParams, "showResult", true),
    leadSeconds: optionalNumber(url.searchParams, "lead", 0, 30) ?? DEFAULT_RECORDING_LEAD_SECONDS,
    tailSeconds: optionalNumber(url.searchParams, "tail", 0, 30) ?? DEFAULT_RECORDING_TAIL_SECONDS,
  };
};

export const playbackBatchSize = (speed: number, elapsedMilliseconds: number): number => {
  const normalizedSpeed = clamp(speed, 1, 100) / 100;
  const targetBatch = 1 + normalizedSpeed ** 1.6 * 400;
  const ramp = Math.min(1, Math.max(0, elapsedMilliseconds) / PLAYBACK_RAMP_MILLISECONDS);
  return Math.max(1, Math.round(1 + (targetBatch - 1) * ramp));
};

export const audioCueForEvent = (
  event: SearchEvent,
  progress: number,
  timeSeconds: number,
): RecordingAudioCue | undefined => {
  const normalizedProgress = clamp(progress, 0, 1);
  const pitch = .82 + normalizedProgress * .78;
  if (event.type === "frontier" || event.type === "visit") {
    return { type: "hum", timeSeconds, frequency: 320 + normalizedProgress * 480 * pitch };
  }
  if (event.type === "path") return { type: "success", timeSeconds, pitch: Math.min(1.18, pitch) };
  if (event.type === "miss") return { type: "miss", timeSeconds, frequency: 170 * pitch };
  return undefined;
};

export const buildRecordingTimeline = (
  events: readonly SearchEvent[],
  options: {
    speed?: number;
    fps?: number;
    leadSeconds?: number;
    tailSeconds?: number;
  } = {},
): RecordingTimeline => {
  const fps = clamp(Math.round(options.fps ?? RECORDING_FRAME_RATE), 1, 120);
  const speed = clamp(options.speed ?? DEFAULT_RECORDING_SPEED, 1, 100);
  const leadFrames = Math.ceil(Math.max(0, options.leadSeconds ?? DEFAULT_RECORDING_LEAD_SECONDS) * fps);
  const tailFrames = Math.ceil(Math.max(0, options.tailSeconds ?? DEFAULT_RECORDING_TAIL_SECONDS) * fps);
  const frameMilliseconds = 1_000 / fps;
  const frames: RecordingTimelineFrame[] = [];
  const audioCues: RecordingAudioCue[] = [];
  let eventIndex = 0;
  let playbackFrame = 0;
  let holdFrames = 0;

  for (let index = 0; index < leadFrames; index += 1) {
    frames.push({ eventEndIndex: 0, phase: "lead" });
  }

  while (eventIndex < events.length) {
    if (holdFrames > 0) {
      frames.push({ eventEndIndex: eventIndex, phase: "playback" });
      holdFrames -= 1;
      playbackFrame += 1;
      continue;
    }

    const batchSize = playbackBatchSize(speed, playbackFrame * frameMilliseconds);
    const frameTimeSeconds = frames.length / fps;
    for (let batchIndex = 0; batchIndex < batchSize && eventIndex < events.length; batchIndex += 1) {
      const event = events[eventIndex];
      const audible = batchIndex === batchSize - 1 || event.type === "path" || event.type === "miss";
      if (audible) {
        const cue = audioCueForEvent(event, eventIndex / Math.max(1, events.length - 1), frameTimeSeconds);
        if (cue) audioCues.push(cue);
      }
      eventIndex += 1;
      if (event.type === "path" && events[eventIndex]?.type === "restart") {
        holdFrames = Math.ceil(PLAYBACK_RESTART_HOLD_MILLISECONDS / frameMilliseconds);
        break;
      }
    }
    frames.push({ eventEndIndex: eventIndex, phase: "playback" });
    playbackFrame += 1;
  }

  audioCues.push({ type: "stop", timeSeconds: frames.length / fps });
  for (let index = 0; index < tailFrames; index += 1) {
    frames.push({ eventEndIndex: eventIndex, phase: "tail" });
  }

  // A zero-event scenario still needs at least one capturable frame.
  if (frames.length === 0) frames.push({ eventEndIndex: 0, phase: "tail" });
  return { fps, durationSeconds: frames.length / fps, frames, audioCues };
};
