# Render and assemble videos

Run commands from the project root. Install dependencies with `npm install` and
the rendering browser once with `npm run video:setup`.

```sh
# Render the pilot: three cities × three algorithm groups = nine videos.
npm run video:batch

# Preview the expanded jobs and finished filenames without rendering anything.
node scripts/render-videos.mjs --manifest recording/videos.json --plan

# Render only one city, one group, or both.
npm run video:batch -- --city barcelona --group search-styles

# Use your own batch configuration.
npm run video:render -- --manifest recording/videos.json

# Reorder or regroup existing clips without launching a browser or rendering again.
npm run video:assemble -- --manifest recording/videos.json

# Join every job in manifest order under a different filename.
npm run video:assemble -- --manifest recording/videos.json --combine comparison.mp4
```

Outputs go into `recordings/`; use `--output-dir <directory>` to change that.
Individual clips are kept. Existing nonempty clips are reused by filename. Use
`--force` when changing render settings, or give the new preset a unique `output`.
Compilations are rebuilt each time, so changing their order takes effect immediately.

## Batch configuration

The default `videos.json` crosses Ann Arbor, New York, and Barcelona with three
curated, ordered groups:

| Group ID | Algorithm order |
| --- | --- |
| `search-styles` | BFS → DFS → A* |
| `two-ended` | BFS → Bidirectional BFS → A* → Bidirectional A* |
| `speed-vs-quality` | A* → Weighted A* → Greedy |

This produces nine finished videos from 21 unique clips. For example,
`barcelona--search-styles.mp4` references `barcelona--bfs.mp4`,
`barcelona--dfs.mp4`, and `barcelona--astar.mp4`. A* is rendered once for each city
and reused in all three groups. Every group uses the same city scene and defaults,
including playback speed. Playback time represents visualization pacing, not
algorithm execution time.

```json
{
  "defaults": {
    "speed": 58,
    "volume": 42,
    "leadSeconds": 0.25,
    "tailSeconds": 1.25
  },
  "cities": ["ann-arbor", "new-york", "barcelona"],
  "algorithmGroups": [
    { "id": "search-styles", "algorithms": ["bfs", "dfs", "astar"] },
    { "id": "two-ended", "algorithms": ["bfs", "bidirectional-bfs", "astar", "bidirectional-astar"] },
    { "id": "speed-vs-quality", "algorithms": ["astar", "weighted-astar", "greedy"] }
  ]
}
```

Add a city ID or group definition to expand the batch. City, group, and algorithm
IDs must use lowercase letters/numbers separated by hyphens and be unique within
their list. The order of `algorithms` is the order shown in the finished video.
Use `--city <id>` and/or `--group <id>` to select a subset of a matrix; unknown
IDs fail before rendering. Filters also work with `video:assemble` and `--plan`.
The `--plan` JSON is an expanded manifest that can itself be rendered or assembled.

## Timing and custom clip lists

`defaults` applies to all jobs; each job can override those settings. `leadSeconds`
holds the initial view and algorithm label before playback. `tailSeconds` holds
the finished result before the cut. The pause between algorithms is the previous
clip's tail plus the next clip's lead; no scrolling, controls, or manual reset is
captured. A tail of at least half a second also lets the ending chime finish.
The pilot uses a 1.5-second pause between algorithms (1.25-second tail plus
0.25-second lead).

For individual presets or manual grouping, the original `jobs`/`compilations`
format is also supported. Use that format or `cities`/`algorithmGroups` in a
manifest, rather than mixing the two:

```json
{
  "defaults": {
    "speed": 58,
    "volume": 42,
    "leadSeconds": 0.25,
    "tailSeconds": 1.25
  },
  "jobs": [
    { "city": "ann-arbor", "algorithm": "bfs" },
    { "city": "ann-arbor", "algorithm": "dijkstra" },
    { "city": "ann-arbor", "algorithm": "astar" }
  ],
  "compilations": [
    { "output": "ann-arbor-comparison.mp4" }
  ]
}
```

Omitting `clips` includes every job in manifest order. To make several videos
from the same clips, specify ordered filenames explicitly:

```json
"compilations": [
  {
    "output": "bfs-then-astar.mp4",
    "clips": ["ann-arbor--bfs.mp4", "ann-arbor--astar.mp4"]
  },
  {
    "output": "astar-then-bfs.mp4",
    "clips": ["ann-arbor--astar.mp4", "ann-arbor--bfs.mp4"]
  }
]
```

Clip filenames default to `<city>--<algorithm>.mp4`. A job's `output` overrides
that name; use the resulting filename in `clips`. Outputs must be unique, and
compilations may reference only jobs in that manifest. `--combine <filename>`
overrides the manifest's compilations with a single video containing all jobs.
Omit both `compilations` and `--combine` to render individual clips only.

Assembly makes hard cuts, copies the video frames without another video encode,
and joins the audio into a stereo AAC track. Use clips produced by this renderer,
which share the same dimensions, frame rate, and codecs. Missing clips or render
failures stop assembly; a failed assembly leaves any previous combined file intact.
The temporary assembly directory is removed after success or failure.

## GitHub Actions

After the workflow is pushed to the default branch, open **Actions → Render
Videos → Run workflow**. Leave `manifest` at `recording/videos.json` for the pilot.
Optional `city` and `group` fields accept the IDs above; blank fields select all.
The workflow runs only when manually triggered.

A planning job expands the manifest, validates the selection, and runs the tests.
Its output defines a dynamic GitHub Actions matrix with one rendering job per
city, running up to three cities in parallel. The default pilot creates three
city jobs, each rendering seven unique clips and assembling three finished
videos: nine videos in total. City/group filters narrow this matrix. Adding a
city in the manifest automatically adds a job; the workflow contains no hardcoded
city list.

Each city runner installs Node, dependencies, and Chromium; builds the site; then
renders its clips and assembles all its selected groups. Shared clips stay in
the same job so overlapping groups reuse them. A failed city does not cancel
the others. The planning job summary lists the total clip count and finished
filenames.

Download each `videos-<city>-<run>-<attempt>` artifact from the run page. It
contains that city's MP4s under `recordings/` and its expanded `video-plan.json`.
Artifacts expire after seven days. Completed clips are also uploaded if a city's
rendering later fails; partial MP4s are excluded. Each workflow run renders its
selected clips fresh. Local runs continue to reuse clips already in the output
directory. Custom `jobs`/`compilations` manifests work too, provided each
compilation contains clips from a single city; cross-city compilations are
rejected before rendering.
