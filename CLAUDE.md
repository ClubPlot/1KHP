# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`interplot` is a browser app that drives a vintage **HP-GL pen plotter** (HP 7475A / 7550
class) live over a WebSocket bridge. There is no backend in this repo — the app talks to a
socket-to-serial bridge on the plotter host (`DEFAULT_URL` points at a Tailscale address,
`ws://plotpi…:8181`). There is one front-end:

- **`index.html` → `src/gamepad.ts`** — the 1000 HP racing game: drive the pen around a track
  with a game controller, against the clock.

The `track/` directory holds the game's course: a Rhino model and the tooling that turns it
into hit regions and HP-GL (see the last section).

## Commands

```sh
yarn dev              # Vite dev server
yarn build            # tsc type-check (noEmit) + vite build — this is also the "lint"
yarn preview          # serve the production build

yarn test             # the only automated test; classifies random points against the
                      # track hit regions and draws track/hit-regions-test.svg
yarn regions          # print the extracted hit regions as JSON
yarn regions:update   # regenerate the track/hit-regions.json snapshot
```

The track tooling lives in `track/` alongside the model it reads, and both scripts resolve
their default paths against their own directory — so they behave the same however they are
invoked, whether through yarn or as `node track/<script>.mjs` from anywhere.

There is no separate linter or test runner. `tsc` (via `yarn build`) is the type/lint gate;
its config is strict (`noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`). The only
runtime test is `track/test-hit-regions.mjs`, wired up as `yarn test`.

## Architecture

A single-page Vite build: `index.html` is the only entry, so `vite.config.ts` carries nothing
but `base`.

### `src/plot.ts` — the transport layer (start here)

Small: the socket and the units, nothing else. There is no HP-GL command-builder layer —
`gamepad.ts` writes its instructions as strings.

- **`createConnection(url)`** returns a `Connection`: a thin WebSocket wrapper exposing
  `ready()` / `read()` / `write()` / `close()`. Incoming messages are buffered through a
  `ReadableStream`; consumers `pump()` it in a loop until close.
- **`Point`** is in HP-GL plotter units of 0.025 mm. **HP-GL's origin is lower-left**, not
  top-left — coordinate conversions must account for this.
- **`DEFAULT_URL`** is the bridge on the plotter host.

Instructions go out as literal HP-GL: `;`-terminated, `PU`/`PD`/`PA`/`PR` to move, `SP` to
choose a pen, `VS` for speed, and `LB…\x03` for a label (which reads raw bytes until that ETX
terminator, so ETX is the one byte a label cannot contain). Slots 1–3 of the carousel are out
of service on the machine, so drawing starts at `SP4;`.

### `src/gamepad.ts` — the game (connection UI, race loop, HUD)

The whole front-end: the connect bar and log, the Draw Track and Start Race buttons, and the
race loop. Notable:

- **The race loop** polls the Gamepad API through `requestAnimationFrame` but only acts every
  `minInterval` (100 ms), so the plotter's ~1 KB input buffer is not flooded. Stick deflection
  becomes a relative pen move (`PR`) and the right trigger sets the speed (`VS`).
- **Hit testing** asks `src/track.ts` where the next point lands: on track it moves, over the
  finish line it banks a lap time and restarts on the next pen, and off track it refuses the
  move and rumbles the pad instead. The pen never leaves the course.
- **`gameState` / `lapTimes`** are module-level and drive `renderHud()`; after `LAPS` laps the
  loop labels the lap times onto the sheet with `LB`.
- **The countdown** plays `src/assets/countdown.mp4` over the camera feed, green-keyed frame by
  frame onto `#countdown` (`keyFrame`), and resolves as the flag drops.
- The camera itself is an `<iframe>` in `index.html`, not something this module touches.

This file is the most experimental / in-flux part of the codebase.

### `src/track.ts` — hit testing against the extracted regions

Imports `track/hit-regions.json` and exposes `startPoint()` / `onTrack()` / `starting()` /
`finished()`, splitting the regions by `group`. Same geometry as the test script below —
convex-quad side test for rectangles, radius-plus-CCW-sweep for wedge bands, one plotter unit
of tolerance.

## Track / Rhino hit regions (`track/`)

`track/track.3dm` is a Rhino model of a race track. The **`HIT_REGIONS`** layer defines the
areas an object can occupy. Every region is an **area** — one closed curve of exactly one of
two shapes:

- **Rectangle** — a closed `PolylineCurve` with 4 corners (the straightaways).
- **Wedge band** — a closed `PolyCurve` of two concentric arcs (inner + outer radius) joined by
  two radial lines, i.e. an annular sector (the turns). The turns are reflex — the model's arcs
  subtend 221° and 263°, not 180°.

The model also has the start line drawn on `HIT_REGIONS/START` as an open `LineCurve`. It is a
gate rather than an area, so it is **not** a region: the extractor skips it with a warning.

`HIT_REGIONS` is divided into **sublayers that say what each region means** — currently
`START`, `TRACK` and `FINISH`. Every extracted region is tagged with its sublayer as `group`,
and `groups` maps each sublayer to its region indices. Sublayers may nest: `group` is always
the *top-level* sublayer, and a region deeper than that also carries the full path in `layer`.

The current file holds 7 regions — `TRACK` has the closed loop (2 rectangles + 3 wedge bands),
`START` a square, and `FINISH` a square. All bands share a `0.875`-wide radial thickness
matching the straightaways.

Separately, the top-level **`START_POINT`** layer holds a single `Point`: where a car begins the
lap. It is a position rather than an area, so it sits outside `HIT_REGIONS` and comes back as
its own `startPoint` field rather than as a region.

**The model is in inches on a portrait Letter sheet** — its `Page` layer is exactly
`(0,0)-(8.5,11)` — but nothing downstream sees those units. `extract-hit-regions.mjs` converts
everything on the way out: 1016 plotter units to the inch, then a 90° CCW rotation (what HP-GL's
own `RO90` does) to reach the plotter's landscape orientation, then a translation centring the
sheet on the Letter hard-clip limits of `10300 × 7650` plotter units. Note that is the real
Letter plotting range.
The sheet is bigger than the range, so its corners fall outside; every hit region lands inside
with ~260 units to spare. `toPlotter` / `toPlotterLength` and the limits are exported so
anything else in the pipeline converts the same way.

- **`track/extract-hit-regions.mjs`** (`yarn regions`) reads the layer via `rhino3dm.js` (WASM, no Rhino install) and
  emits concise JSON **in plotter units**. It exports `extractRegions(file)` for reuse and prints
  JSON when run directly; it warns on and skips any geometry that is not a rectangle or wedge
  band, and warns (without skipping) on a region reaching outside the plotting range. Snapshot:
  `track/hit-regions.json`.
  `startPoint` is the `START_POINT` layer's point in plotter units, or `null` with a warning if
  the layer is missing, holds no `Point`, or holds something else; extra points warn and the
  first wins. Whether it lands inside a region is checked by the test, not here.
  Each region leads with `group` (its sublayer), then:
  - rectangle → `{ type, corners }` — the 4 corners, in the order drawn. That is the whole
    description; a centre, side lengths or an angle are derived at the point of use rather
    than emitted, so there is only ever one rounding of the shape
  - wedge band → `{ type, center, innerRadius, outerRadius, startAngleDeg, endAngleDeg, sweepDeg }`
    (angles in degrees, sweep is CCW from `startAngleDeg`)
- **`track/test-hit-regions.mjs`** (`yarn test`) scatters random points over the whole plotting range, classifies
  each by the group of the region containing it (`START` / `TRACK` / `FINISH`, or off track),
  and renders regions + classified points to **`track/hit-regions-test.svg`** to be checked by
  eye. The model's old `TEST_POINTS_*` layers are gone, so there are no fixtures to compare
  against; instead the run fails if any point lands in two *different* groups (the groups would
  overlap, making the answer ambiguous), if no regions were found at all, or if the
  `startPoint` exists but falls outside every region. The start point is drawn as a crosshair
  and its group reported (currently `START`). Points come from a seeded PRNG, so a given seed
  always draws the same picture.
  Flags: `--points=N` `--seed=S` `--out=file.svg`.
  The hit-test logic: convex-quad side test for rectangles; radius-in-`[inner,outer]` plus
  CCW-sweep angle test for wedge bands. Tolerance is one plotter unit, since the extractor
  rounds to whole units.
  Sanity check: at `--points=400000` the measured group shares match the regions' analytic areas
  (TRACK 33.07% vs 33.04%, START/FINISH ~0.99% vs 1.003%).

`track/trackhpgl.ts` is the generated companion to all this: one long `trackHPGL` string that
draws the course, exported for the Draw Track button. It is output, not something to hand-edit.

`track/pdf2hpgl.sh` is an unrelated utility that converts PDF/PS/EPS linework to HP-GL
(ghostscript → pstoedit → affine fit/rotate/pen transform).
