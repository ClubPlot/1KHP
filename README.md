# 1KHP Pen Plotter Game

Drive a vintage HP-GL pen plotter around a race track with a game controller.

`1KHP` is a browser app that steers an **HP 7475A / 7550**-class plotter live over a WebSocket bridge. 
The pen acts as the car: push the stick and it draws its own line around the course, squeeze the right trigger to go faster.
Hit detection is set up such that if you try to leave the track the move is refused and the controller rumbles — the pen never runs off the paper.
Once you hit the end of the track the pen switches and resets the lap. 4 Laps in total
Upon completion your times will also be drawn on the page

The app talks to a socket-to-serial bridge running on the plotter host (`DEFAULT_URL` in [src/plot.ts](src/plot.ts) points at a Tailscale address,
`ws://plotpi…:8181`), and a separate `<iframe>` camera feed lets you watch the paper while you drive.

## Quick start

```sh
yarn install
yarn dev            # Vite dev server — open the printed URL
```

Then, in the page: paste the bridge URL (or keep the default), hit **Connect**, press
**Draw Track** to lay the course down on the sheet, and **Start Race** to play. A countdown
plays over the camera feed and the flag drops on green.

You need the plotter, the bridge, and paper loaded to actually race. 
Setting up the 5 pens required (1 for drawing the track and 4 for racing)
and the paper is required before racing
Everything else —
building, type-checking, the track tooling — runs without hardware.

## Commands

```sh
yarn dev              # Vite dev server
yarn build            # tsc type-check (noEmit) + vite build — this is also the "lint"
yarn preview          # serve the production build
yarn deploy           # rsync dist/ to the plotter host

yarn test             # classifies random points against the track hit regions and
                      # draws track/hit-regions-test.svg to be checked by eye
yarn regions          # print the extracted hit regions as JSON
yarn regions:update   # regenerate the track/hit-regions.json snapshot
```

## How it fits together

| Path | What it does |
| --- | --- |
| [index.html](index.html) | The only entry point: connect bar, buttons, HUD, camera iframe |
| [src/gamepad.ts](src/gamepad.ts) | The game — connection UI, race loop, lap timing, countdown |
| [src/plot.ts](src/plot.ts) | Transport: a thin WebSocket wrapper, plus plotter units |
| [src/track.ts](src/track.ts) | Hit testing — on track, over the finish line, or off course |
| [track/](track/) | The Rhino model of the course and the tooling that extracts it |

The race loop polls the Gamepad API through `requestAnimationFrame` but only emits a move
every 100 ms, so the plotter's ~1 KB input buffer never floods. Instructions go out as
literal HP-GL strings — `PU`/`PD`/`PA`/`PR` to move, `SP` to pick a pen, `VS` for speed,
`LB…` to label the lap times onto the sheet when the race ends. Coordinates are in plotter
units of 0.025 mm, with the origin at the **lower left**.

## The track

[track/track.3dm](track/track.3dm) is a Rhino model on a portrait Letter sheet, in inches.
Its `HIT_REGIONS` layer defines where the car may be — rectangles for the straightaways,
annular sectors for the turns — split into `START`, `TRACK` and `FINISH` sublayers, with a
`START_POINT` layer marking where a lap begins.

`track/extract-hit-regions.mjs` reads that model with `rhino3dm.js` (WASM — no Rhino install
needed) and emits [track/hit-regions.json](track/hit-regions.json) in plotter units, rotated
90° and centred on the Letter hard-clip limits. `track/test-hit-regions.mjs` scatters seeded
random points over the plotting range, classifies each one, and renders the result to
`track/hit-regions-test.svg` so the geometry can be checked by eye.


## To do

### Game state and flow fixes

- [ ] Written lap in color of lap pen used
- [ ] Bug where pen goes to end before start after selected
- [ ] Investigate timing loop
- [ ] Start time starts when the user crosses the start line
- [ ] Song in web app
- [ ] Refactor game loop so that it is easier to work with (async generators)
- [ ] Store high scores and show on the website, prompt the user for their name

### Plot.recurse website updates

- [ ] Get game working on website
- [x] Edit HTML file naming — the game is now `index.html`; the paint app is gone
- [ ] Work to have camera be publicly accessible so that users can play without Tailscale access


### Helping Other People

- [ ] Add our learnings to the Plotter Readme
- [ ] Package Websocket client as a library


### New Additions
- [ ] Allow users to build their own track, through the canvas, stores hit regions
