# Vrigstad Joyride

A small open-world driving game set in the real village of Vrigstad, Sweden (57.3555° N, 14.4756° E), plus the 3D map it grew out of. Everything runs in the browser from a single HTML file.

- **`index.html`** is the game. Walk around, steal a Volvo 240, a Saab 900, an EPA-traktor or a tractor, and outrun the police.
- **`map.html`** is an interactive 3D terrain model of the same 2.2 × 2.2 km area.

<p align="center">
  <a href="https://oliverromhagen.github.io/vrigstad-joyride/media/teaser.mp4"><img src="media/teaser.gif" width="640" alt="Teaser trailer: the village from the air, a red Volvo 240 chased by three police cars, an EPA-traktor at 30 km/h, and the title card"></a><br>
  <sub><a href="https://oliverromhagen.github.io/vrigstad-joyride/media/teaser.mp4">Watch the full teaser with sound (50 s)</a> · <a href="https://oliverromhagen.github.io/vrigstad-joyride/">Play the game</a></sub>
</p>

<p align="center">
  <img src="media/poster.png" width="360" alt="Poster: a red Volvo 240 ahead of the police under the line “Nothing ever happens here”, with the title Vrigstad Joyride">
</p>

The teaser and poster are rendered from the game itself by the scripts in `tools/trailer/` (`npm install`, then `npm run trailer` and `npm run poster`; needs Node and Chrome).

## Play

Open `index.html` in a browser. It needs WebGL and an internet connection the first time (three.js and the fonts load from a CDN).

| Action | Keyboard | Phone |
|---|---|---|
| Move / drive | W A S D or arrows | Left stick |
| Steal / get out | E | Use button |
| Sprint / brake | Shift / Space | Stick sprints on foot / Brake button |
| Look around | Drag the view | Drag the view |
| Back to Torget | R | |
| Go inside a safehouse / scratch a trisslott | E | Use button |

Taking an occupied car always earns a wanted star; a parked one sometimes does. Each star (up to three) sends a police car. Stay about 170 m clear of them for 18 seconds and they give up. Get boxed in at low speed and you are *gripen* and sent back to Torget.

Three houses are safehouses, shown as green houses on the minimap and marked with a green door. Go inside on foot and stay for a minute and the police give up; it only works if no police car is within 60 m when you go in, and leaving early keeps your stars.

The kiosk on Torget sells trisslotter. One in a thousand wins, and the more losing tickets you scratch in a row, the worse your language gets.

## How it is built

Contributors (human or agent): read [AGENTS.md](AGENTS.md) for conventions, including how tickets are filed, labelled and linked, and [ARCHITECTURE.md](ARCHITECTURE.md) for the structure and where it's heading.

```
src/game.html      game source (HTML, CSS, JS) with a /*DATA*/ placeholder
src/map.html       3D map source, same placeholder
data/raw/          OpenStreetMap extract (osm.json) and one elevation tile (tile.png)
data/vrigstad.json processed data: buildings, roads, water, land use, 25 m elevation grid
tools/fetch.sh     re-downloads data/raw from the Overpass API and Mapzen terrain tiles
tools/process.py   projects and clips the raw data into data/vrigstad.json
tools/build.py     runs process.py and writes index.html and map.html
```

Rebuild after changing anything in `src/`:

```sh
python3 tools/build.py
```

Refresh the map data first with `tools/fetch.sh` if you want the latest OpenStreetMap edits. Only the Python standard library is needed.

## Tests

A small Playwright suite in `tests/e2e/` smoke-tests the built pages: both load without console errors, Start shows the HUD, and the player can walk and get into the parked Volvo at Torget. It needs Node, and runs on every pull request.

```sh
npm install
npx playwright install chromium   # once
npm run test:e2e
```

## Releases

Versions use semver tags (`vMAJOR.MINOR.PATCH`) on `main`. Bump the minor version for new features and the patch version for fixes.

To cut a release, from an up-to-date `main`:

```sh
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --generate-notes
```

`--generate-notes` builds the changelog from merged PR titles, so keep those titles descriptive.

## Known simplifications

- Building heights are guessed from footprint size; the source data has none.
- Buildings are flat-roofed boxes.
- Traffic ignores one-way streets and roundabout direction.
- Only six woodland areas are mapped in the source, so the surroundings look more open than they are.

## License

All rights reserved. The game and map code are not open source; see [LICENSE](LICENSE) for what you may do. Third-party data and libraries keep their own licenses, listed there.

## Data credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License.
- Elevation from Mapzen terrain tiles (terrarium format) hosted on AWS Open Data.
