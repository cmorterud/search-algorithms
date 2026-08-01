import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright";
import { preview } from "vite";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);
const numericOption = (name) => {
  const value = option(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
};

const manifestPath = option("manifest");
const outputDirectory = resolve(projectRoot, option("output-dir") ?? "recordings");
const force = hasFlag("force");

const readJobs = async () => {
  if (manifestPath) {
    const absoluteManifest = isAbsolute(manifestPath) ? manifestPath : resolve(projectRoot, manifestPath);
    const manifest = JSON.parse(await readFile(absoluteManifest, "utf8"));
    if (!Array.isArray(manifest.jobs) || manifest.jobs.length === 0) {
      throw new Error(`Manifest ${absoluteManifest} must contain a non-empty jobs array`);
    }
    return manifest.jobs.map((job) => ({ ...(manifest.defaults ?? {}), ...job }));
  }
  const city = option("city");
  const algorithm = option("algorithm");
  if (!city || !algorithm) {
    throw new Error("Provide --city and --algorithm, or use --manifest <path>");
  }
  return [{
    city,
    algorithm,
    speed: numericOption("speed"),
    volume: numericOption("volume"),
    rotation: numericOption("rotation"),
    zoom: numericOption("zoom"),
    leadSeconds: numericOption("lead"),
    tailSeconds: numericOption("tail"),
    showAlgorithm: !hasFlag("hide-algorithm"),
    showStats: !hasFlag("hide-stats"),
    showResult: !hasFlag("hide-result"),
    output: option("output"),
  }];
};

const safeOutputName = (job) => {
  const requested = job.output ?? `${job.city}--${job.algorithm}.mp4`;
  const name = basename(String(requested)).replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!name || name === "." || name === "..") throw new Error(`Invalid output name: ${requested}`);
  return name.toLowerCase().endsWith(".mp4") ? name : `${name}.mp4`;
};

const addParameter = (parameters, name, value) => {
  if (value !== undefined && value !== null) parameters.set(name, String(value));
};

const recordingUrl = (baseUrl, job) => {
  const url = new URL("recording/", baseUrl);
  url.searchParams.set("render", "1");
  addParameter(url.searchParams, "city", job.city);
  addParameter(url.searchParams, "algorithm", job.algorithm);
  addParameter(url.searchParams, "speed", job.speed);
  addParameter(url.searchParams, "volume", job.volume);
  addParameter(url.searchParams, "rotation", job.rotation);
  addParameter(url.searchParams, "zoom", job.zoom);
  addParameter(url.searchParams, "lead", job.leadSeconds);
  addParameter(url.searchParams, "tail", job.tailSeconds);
  if (job.showAlgorithm === false) url.searchParams.set("showAlgorithm", "0");
  if (job.showStats === false) url.searchParams.set("showStats", "0");
  if (job.showResult === false) url.searchParams.set("showResult", "0");
  return url;
};

const closeServer = (server) => new Promise((resolveClose) => server.httpServer.close(() => resolveClose()));

const renderJob = async (browser, baseUrl, job, jobIndex, jobCount) => {
  if (!job || typeof job.city !== "string" || typeof job.algorithm !== "string") {
    throw new Error("Every render job requires string city and algorithm values");
  }
  const outputPath = join(outputDirectory, safeOutputName(job));
  if (!force) {
    try {
      if ((await stat(outputPath)).size > 0) {
        console.log(`[${jobIndex + 1}/${jobCount}] Skipping existing ${outputPath}`);
        return { status: "skipped", outputPath };
      }
    } catch { /* The output does not exist yet. */ }
  }

  const partialPath = outputPath.replace(/\.mp4$/i, ".partial.mp4");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "search-recording-"));
  const audioPath = join(temporaryDirectory, "recording-audio.wav");
  const context = await browser.newContext({
    viewport: { width: 540, height: 960 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const label = `${job.city}/${job.algorithm}`;
  let ffmpeg;
  let ffmpegExit;
  try {
    console.log(`[${jobIndex + 1}/${jobCount}] Preparing ${label}`);
    await page.goto(recordingUrl(baseUrl, job).toString(), { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      if (!window.__searchRecording) throw new Error("Recording automation API is unavailable");
      await window.__searchRecording.ready();
    });
    const metadata = await page.evaluate(async () => {
      if (!window.__searchRecording) throw new Error("Recording automation API is unavailable");
      return window.__searchRecording.prepare();
    });
    const downloadPromise = page.waitForEvent("download");
    await page.evaluate(async () => window.__searchRecording?.downloadAudio());
    const download = await downloadPromise;
    await download.saveAs(audioPath);

    await rm(partialPath, { force: true });
    ffmpeg = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "warning", "-y",
      "-f", "image2pipe", "-framerate", String(metadata.fps), "-vcodec", "png", "-i", "pipe:0",
      "-i", audioPath,
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(metadata.fps),
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-shortest", "-movflags", "+faststart", partialPath,
    ], { stdio: ["pipe", "ignore", "pipe"] });
    ffmpeg.stdin.on("error", () => { /* The exit promise reports encoder failures. */ });
    let ffmpegError = "";
    ffmpeg.stderr.on("data", (chunk) => { ffmpegError = `${ffmpegError}${chunk}`.slice(-12_000); });
    ffmpegExit = new Promise((resolveExit, rejectExit) => {
      ffmpeg.once("error", rejectExit);
      ffmpeg.once("close", (code) => code === 0 ? resolveExit() : rejectExit(new Error(`FFmpeg exited with code ${code}\n${ffmpegError}`)));
    });
    const previewElement = page.locator("#recording-preview");
    for (let frame = 0; frame < metadata.frameCount; frame += 1) {
      await page.evaluate(async (frameIndex) => window.__searchRecording?.renderFrame(frameIndex), frame);
      const screenshot = await previewElement.screenshot({ type: "png", scale: "device", animations: "disabled" });
      if (!ffmpeg.stdin.write(screenshot)) await once(ffmpeg.stdin, "drain");
      if (frame === 0 || (frame + 1) % metadata.fps === 0 || frame + 1 === metadata.frameCount) {
        console.log(`[${jobIndex + 1}/${jobCount}] ${label}: ${frame + 1}/${metadata.frameCount} frames`);
      }
    }
    ffmpeg.stdin.end();
    await ffmpegExit;
    await rename(partialPath, outputPath);
    console.log(`[${jobIndex + 1}/${jobCount}] Wrote ${outputPath}`);
    return { status: "rendered", outputPath, metadata };
  } catch (error) {
    if (ffmpeg && ffmpeg.exitCode === null) {
      ffmpeg.stdin.destroy();
      ffmpeg.kill("SIGTERM");
    }
    if (ffmpegExit) await ffmpegExit.catch(() => undefined);
    await rm(partialPath, { force: true });
    throw error;
  } finally {
    await context.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

const main = async () => {
  if (!ffmpegPath) throw new Error("The bundled FFmpeg binary is unavailable on this platform");
  const jobs = await readJobs();
  await mkdir(outputDirectory, { recursive: true });
  const server = await preview({ root: projectRoot, preview: { host: "127.0.0.1", port: 4173 } });
  const baseUrl = server.resolvedUrls?.local?.[0];
  if (!baseUrl) { await closeServer(server); throw new Error("Vite preview did not provide a local URL"); }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    await closeServer(server);
    throw new Error(`Unable to launch Playwright Chromium. Run npm run video:setup first.\n${error instanceof Error ? error.message : error}`);
  }
  const failures = [];
  try {
    for (let index = 0; index < jobs.length; index += 1) {
      try {
        await renderJob(browser, baseUrl, jobs[index], index, jobs.length);
      } catch (error) {
        failures.push({ job: jobs[index], error });
        console.error(`[${index + 1}/${jobs.length}] Failed ${jobs[index]?.city}/${jobs[index]?.algorithm}:`, error);
      }
    }
  } finally {
    await browser.close();
    await closeServer(server);
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} of ${jobs.length} video jobs failed`);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
