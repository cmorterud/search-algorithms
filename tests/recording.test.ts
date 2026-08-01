import assert from "node:assert/strict";
import test from "node:test";
import { buildRecordingTimeline, parseRecordingConfig, playbackBatchSize } from "../src/recording.ts";
import type { SearchEvent } from "../src/types.ts";

const cities = ["ann-arbor", "detroit"];
const algorithms = ["bfs", "ara-star"];

test("parses recording defaults and bounded URL overrides", () => {
  const defaults = parseRecordingConfig("/recording", cities, algorithms);
  assert.equal(defaults.city, "ann-arbor");
  assert.equal(defaults.algorithm, "bfs");
  assert.equal(defaults.speed, 58);
  assert.equal(defaults.volume, 42);
  assert.equal(defaults.leadSeconds, 1);
  assert.equal(defaults.tailSeconds, 1);

  const configured = parseRecordingConfig(
    "/recording?render=1&city=detroit&algorithm=ara-star&speed=999&volume=-2&rotation=32&zoom=1.2&showStats=0&lead=2&tail=.5",
    cities,
    algorithms,
  );
  assert.deepEqual(configured, {
    render: true,
    city: "detroit",
    algorithm: "ara-star",
    speed: 100,
    volume: 0,
    rotation: 32,
    zoom: 1.2,
    showAlgorithm: true,
    showStats: false,
    showResult: true,
    leadSeconds: 2,
    tailSeconds: .5,
  });
});

test("rejects unknown render-mode city and algorithm values", () => {
  assert.throws(() => parseRecordingConfig("/recording?render=1&city=unknown", cities, algorithms), /Unknown recording city/);
  assert.throws(() => parseRecordingConfig("/recording?render=1&algorithm=unknown", cities, algorithms), /Unknown recording algorithm/);
});

test("matches the live playback acceleration curve", () => {
  assert.equal(playbackBatchSize(58, 0), 1);
  assert.ok(playbackBatchSize(58, 275) > 1);
  assert.equal(playbackBatchSize(58, 550), playbackBatchSize(58, 5_000));
});

test("builds deterministic lead, playback hold, tail, and audio cues", () => {
  const events: SearchEvent[] = [
    { type: "visit", id: "0:0" },
    { type: "path", ids: ["0:0", "0:1"] },
    { type: "restart", label: "again" },
    { type: "frontier", id: "0:1" },
    { type: "miss" },
    { type: "clearHighlights" },
  ];
  const first = buildRecordingTimeline(events, { fps: 10, speed: 1, leadSeconds: 1, tailSeconds: .5 });
  const second = buildRecordingTimeline(events, { fps: 10, speed: 1, leadSeconds: 1, tailSeconds: .5 });
  assert.deepEqual(second, first);
  assert.equal(first.frames.filter(({ phase }) => phase === "lead").length, 10);
  assert.equal(first.frames.filter(({ phase }) => phase === "tail").length, 5);
  const pathFrame = first.frames.findIndex(({ eventEndIndex }) => eventEndIndex === 2);
  const restartFrame = first.frames.findIndex(({ eventEndIndex }) => eventEndIndex >= 3);
  assert.ok(restartFrame - pathFrame >= 7, "the 650 ms path/restart hold should span seven 10 fps frames");
  assert.deepEqual(first.audioCues.map(({ type }) => type), ["hum", "success", "hum", "miss", "stop"]);
  assert.equal(first.frames.at(-1)?.eventEndIndex, events.length);
  assert.equal(first.durationSeconds, first.frames.length / 10);
});
