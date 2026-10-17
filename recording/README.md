# Render and assemble videos

Run commands from the project root. Install dependencies with `npm install` and
the rendering browser once with `npm run video:setup`.

```sh
# Render the example batch and join it into one comparison video.
npm run video:batch

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

`defaults` applies to all jobs; each job can override those settings. `leadSeconds`
holds the initial view and algorithm label before playback. `tailSeconds` holds
the finished result before the cut. The pause between algorithms is the previous
clip's tail plus the next clip's lead; no scrolling, controls, or manual reset is
captured. A tail of at least half a second also lets the ending chime finish.

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
