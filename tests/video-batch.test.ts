import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";
import { assembleVideo, createBatchPlan } from "../scripts/video-batch.mjs";

test("batch defaults and explicit compilation ordering support multiple videos", () => {
  const plan = createBatchPlan({
    defaults: { speed: 58, tailSeconds: 1.25 },
    jobs: [
      { city: "ann-arbor", algorithm: "bfs" },
      { city: "ann-arbor", algorithm: "astar", speed: 80, output: "fast.mp4" },
    ],
    compilations: [
      { output: "all.mp4" },
      { output: "reversed.mp4", clips: ["fast.mp4", "ann-arbor--bfs.mp4"] },
    ],
  });
  assert.equal(plan.jobs[1].speed, 80);
  assert.equal(plan.jobs[1].tailSeconds, 1.25);
  assert.deepEqual(plan.compilations.map(({ clips }) => clips), [
    ["ann-arbor--bfs.mp4", "fast.mp4"],
    ["fast.mp4", "ann-arbor--bfs.mp4"],
  ]);
  assert.deepEqual(createBatchPlan({ jobs: plan.jobs }, "combined.mp4").compilations, [
    { output: "combined.mp4", clips: ["ann-arbor--bfs.mp4", "fast.mp4"] },
  ]);
});

test("rejects ambiguous filenames, overwriting inputs, and missing clip references", () => {
  const jobs = [{ city: "ann-arbor", algorithm: "bfs", output: "clip.mp4" }];
  assert.throws(() => createBatchPlan({ jobs: [...jobs, { ...jobs[0], output: "CLIP.mp4" }] }), /Duplicate clip output/);
  assert.throws(() => createBatchPlan({ jobs, compilations: [{ output: "clip.mp4" }] }), /conflicts/);
  assert.throws(() => createBatchPlan({ jobs, compilations: [{ output: "all.mp4", clips: ["missing.mp4"] }] }), /unknown clip/);
  assert.throws(() => createBatchPlan({ jobs, compilations: [{ output: "all.mp4", clips: [] }] }), /non-empty clips/);
});

const ffmpeg = (args: string[]) => execFileSync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", ...args], {
  maxBuffer: 8 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});

test("assemble-only CLI preserves clip order, every video frame, and audio on both sides of a cut", async () => {
  // Quotes and spaces exercise concat-list escaping for real user directory names.
  const directory = await mkdtemp(join(tmpdir(), "video batch's "));
  try {
    for (const [name, color, frequency, duration] of [
      ["red", "red", 440, .4], ["blue", "blue", 880, .6],
    ] as const) {
      ffmpeg([
        "-f", "lavfi", "-i", `color=c=${color}:s=64x96:r=60:d=${duration}`,
        "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", "-shortest",
        join(directory, `${name}.mp4`),
      ]);
    }
    const manifestPath = join(directory, "batch.json");
    await writeFile(manifestPath, JSON.stringify({
      jobs: [
        { city: "ann-arbor", algorithm: "bfs", output: "red.mp4" },
        { city: "ann-arbor", algorithm: "astar", output: "blue.mp4" },
      ],
      compilations: [{ output: "combined.mp4", clips: ["blue.mp4", "red.mp4"] }],
    }));
    execFileSync(process.execPath, [
      "scripts/render-videos.mjs", "--assemble-only", "--manifest", manifestPath, "--output-dir", directory,
    ]);
    const output = join(directory, "combined.mp4");
    const video = ffmpeg(["-i", output, "-map", "0:v:0", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    const frameBytes = 64 * 96 * 3;
    assert.equal(video.length / frameBytes, 60, "assembly should retain all 36 blue and 24 red frames");
    assert.ok(video[2] > video[0] + 150, "first frame is blue");
    assert.ok(video[36 * frameBytes] > video[36 * frameBytes + 2] + 150, "frame after the cut is red");
    const audio = ffmpeg(["-i", output, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"]);
    const samples = new Float32Array(audio.buffer, audio.byteOffset, audio.byteLength / 4);
    assert.ok(Math.abs(samples.length / 48000 - 1) < .05, "audio duration stays aligned with the video");
    const frequencyAt = (start: number) => {
      let crossings = 0;
      const first = Math.round(start * 48000), last = first + 4800;
      for (let index = first + 1; index < last; index += 1) {
        if (samples[index - 1] <= 0 && samples[index] > 0) crossings += 1;
      }
      return crossings / .1;
    };
    assert.ok(Math.abs(frequencyAt(.2) - 880) < 20, "first clip's tone survives");
    assert.ok(Math.abs(frequencyAt(.8) - 440) < 20, "second clip's tone survives");
    // Reassembly replaces the old result even when the output already exists.
    await assembleVideo({ clipPaths: [join(directory, "red.mp4")], outputPath: output });
    const redFrame = ffmpeg(["-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    assert.ok(redFrame[0] > redFrame[2] + 150);
    assert.ok(!(await readdir(directory)).some((name) => name.startsWith(".assembly-")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed assembly preserves the previous output and removes temporary files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "video-failure-"));
  try {
    const source = join(directory, "corrupt.mp4"), outputPath = join(directory, "previous.mp4");
    await writeFile(source, "invalid video");
    await writeFile(outputPath, "previous successful output");
    await assert.rejects(assembleVideo({ clipPaths: [source], outputPath }), /Video assembly failed/);
    assert.equal(await readFile(outputPath, "utf8"), "previous successful output");
    assert.ok(!(await readdir(directory)).some((name) => name.startsWith(".assembly-")));
    await assert.rejects(assembleVideo({ clipPaths: [join(directory, "missing.mp4")], outputPath }), /Missing or empty clip/);
    await assert.rejects(assembleVideo({ clipPaths: [outputPath], outputPath }), /overwrite one of its input clips/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
