import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export const safeOutputName = (job) => {
  const requested = job.output ?? `${job.city}--${job.algorithm}.mp4`;
  const name = basename(String(requested)).replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!name || name === "." || name === "..") throw new Error(`Invalid output name: ${requested}`);
  return name.toLowerCase().endsWith(".mp4") ? name : `${name}.mp4`;
};

const validateIds = (values, label) => {
  if (!Array.isArray(values) || values.length === 0
    || values.some((value) => typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) {
    throw new Error(`${label} must be a non-empty array of lowercase, hyphen-separated IDs`);
  }
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate IDs`);
};

const expandMatrix = (manifest, selection) => {
  if (manifest.jobs !== undefined || manifest.compilations !== undefined) {
    throw new Error("Use either cities/algorithmGroups or jobs/compilations in a manifest, not both");
  }
  validateIds(manifest.cities, "cities");
  if (!Array.isArray(manifest.algorithmGroups) || manifest.algorithmGroups.length === 0) {
    throw new Error("algorithmGroups must be a non-empty array");
  }
  validateIds(manifest.algorithmGroups.map((group) => group?.id), "Algorithm group IDs");
  for (const group of manifest.algorithmGroups) validateIds(group.algorithms, `Algorithms in ${group.id}`);
  if (selection.city && !manifest.cities.includes(selection.city)) throw new Error(`Unknown batch city: ${selection.city}`);
  if (selection.group && !manifest.algorithmGroups.some((group) => group.id === selection.group)) {
    throw new Error(`Unknown algorithm group: ${selection.group}`);
  }
  const cities = manifest.cities.filter((city) => !selection.city || city === selection.city);
  const groups = manifest.algorithmGroups.filter((group) => !selection.group || group.id === selection.group);
  const jobs = new Map();
  const compilations = [];
  for (const city of cities) {
    for (const group of groups) {
      const clips = group.algorithms.map((algorithm) => {
        const output = safeOutputName({ city, algorithm });
        // Every group for this city uses the same defaults and scene. Shared
        // algorithms therefore reference the same rendered clip.
        jobs.set(output, { city, algorithm, output });
        return output;
      });
      compilations.push({ output: `${city}--${group.id}.mp4`, clips });
    }
  }
  return { defaults: manifest.defaults, jobs: [...jobs.values()], compilations };
};

export const createBatchPlan = (manifest, combineOutput, selection = {}) => {
  if (manifest.cities !== undefined || manifest.algorithmGroups !== undefined) {
    manifest = expandMatrix(manifest, selection);
  } else if (selection.city || selection.group) {
    throw new Error("City/group filters require a cities/algorithmGroups manifest");
  }
  if (!Array.isArray(manifest.jobs) || manifest.jobs.length === 0) {
    throw new Error("A video batch must contain a non-empty jobs array");
  }
  const jobs = manifest.jobs.map((job) => {
    const merged = { ...(manifest.defaults ?? {}), ...job };
    if (typeof merged.city !== "string" || typeof merged.algorithm !== "string") {
      throw new Error("Every render job requires string city and algorithm values");
    }
    return { ...merged, output: safeOutputName(merged) };
  });
  const outputs = new Set();
  for (const job of jobs) {
    const key = job.output.toLowerCase();
    if (outputs.has(key)) throw new Error(`Duplicate clip output: ${job.output}. Give each preset a unique output name.`);
    outputs.add(key);
  }
  const requested = combineOutput === undefined
    ? manifest.compilations ?? []
    : [{ output: combineOutput }];
  if (!Array.isArray(requested)) throw new Error("compilations must be an array");
  const compilations = requested.map((compilation) => {
    if (!compilation || typeof compilation.output !== "string" || !compilation.output.trim()) {
      throw new Error("Every compilation requires an output filename");
    }
    const output = safeOutputName(compilation);
    const key = output.toLowerCase();
    if (outputs.has(key)) throw new Error(`Compilation output conflicts with another output: ${output}`);
    outputs.add(key);
    const clips = compilation.clips ?? jobs.map((job) => job.output);
    if (!Array.isArray(clips) || clips.length === 0 || clips.some((clip) => typeof clip !== "string")) {
      throw new Error(`Compilation ${output} requires a non-empty clips array`);
    }
    for (const clip of clips) {
      if (!jobs.some((job) => job.output === clip)) {
        throw new Error(`Compilation ${output} references an unknown clip: ${clip}`);
      }
    }
    return { output, clips };
  });
  return { jobs, compilations };
};

export const createWorkflowMatrix = (input) => {
  const plan = createBatchPlan(input);
  const cities = [...new Set(plan.jobs.map((job) => job.city))];
  validateIds(cities, "Workflow city IDs");
  const rows = new Map(cities.map((city) => [city, {
    city,
    plan: { jobs: plan.jobs.filter((job) => job.city === city), compilations: [] },
  }]));
  const cityByClip = new Map(plan.jobs.map((job) => [job.output, job.city]));
  for (const compilation of plan.compilations) {
    const clipCities = new Set(compilation.clips.map((clip) => cityByClip.get(clip)));
    if (clipCities.size !== 1) {
      throw new Error(`Workflow compilation ${compilation.output} spans cities. Each matrix job assembles one city's videos; split this compilation by city.`);
    }
    const city = cityByClip.get(compilation.clips[0]);
    rows.get(city).plan.compilations.push(compilation);
  }
  return { include: [...rows.values()] };
};

const runFfmpeg = (args) => new Promise((resolveRun, reject) => {
  const process = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  process.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12_000); });
  process.once("error", reject);
  process.once("close", (code) => code === 0
    ? resolveRun()
    : reject(new Error(`Video assembly failed (FFmpeg exit ${code})\n${stderr}`)));
});

export const assembleVideo = async ({ clipPaths, outputPath }) => {
  if (!ffmpegPath) throw new Error("The bundled FFmpeg binary is unavailable on this platform");
  if (!Array.isArray(clipPaths) || clipPaths.length === 0) throw new Error("No clips to assemble");
  const destination = resolve(outputPath);
  const sources = clipPaths.map((path) => resolve(path));
  for (const source of sources) {
    if (source.toLowerCase() === destination.toLowerCase()) throw new Error("A compilation cannot overwrite one of its input clips");
    if (/[\r\n]/.test(source)) throw new Error("Clip paths cannot contain line breaks");
    const info = await stat(source).catch(() => undefined);
    if (!info?.isFile() || info.size === 0) throw new Error(`Missing or empty clip: ${source}. Render the batch first.`);
  }
  await mkdir(dirname(destination), { recursive: true });
  // Stage beside the output so the final rename is atomic, even across volumes.
  const temporaryDirectory = await mkdtemp(join(dirname(destination), ".assembly-"));
  try {
    const listPath = join(temporaryDirectory, "clips.ffconcat");
    const partialPath = join(temporaryDirectory, "combined.mp4");
    const lines = sources.map((source) => `file '${source.replaceAll("'", "'\\''")}'`);
    await writeFile(listPath, `ffconcat version 1.0\n${lines.join("\n")}\n`);
    await runFfmpeg([
      "-hide_banner", "-loglevel", "warning", "-y",
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-map", "0:v:0", "-map", "0:a:0",
      // All renderer clips share the same video format. Keep those frames intact;
      // re-encode audio to reconcile AAC padding and timestamps at the cuts.
      "-c:v", "copy", "-af", "aresample=async=1:first_pts=0",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart", partialPath,
    ]);
    await rename(partialPath, destination);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  return destination;
};
