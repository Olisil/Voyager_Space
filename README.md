# Voyager Space

Animated space voyages for nassau.se/voyager-space. A Webflow Cloud app (Vite + React + three.js),
sister of Voyager Earth, with the same UI components and project storage.

## Two modes

- **Space observer** — pick a body and a date, set camera keypoints (scrub, frame the view, add a
  keypoint); the camera glides through them on a centripetal Catmull–Rom curve while the planets
  move along their real orbits.
- **Vehicle path** — launch from a real spaceport (click it on the globe) or an automatic
  equatorial site on the Moon or Mars, choose or edit a rocket, pick a destination and a scenario,
  and the flight is drawn as a white line from the pad to the destination orbit.

## How the numbers are made

- Positions, orientation and spin of the Sun, planets, Moon and Galilean moons: astronomy-engine
  (MIT). Scene frame: heliocentric ecliptic J2000, 1 unit = 1 AU.
- Transfers: patched conics. Lambert's problem (universal variables) between the bodies, searched
  over the launch window × flight time; scenarios = least Δv, fastest within 1.6× of least,
  earliest within 1.3× of least, and a balanced score. Earth ⇄ Moon uses a geocentric Lambert arc.
- Launch: steep ascent into a low parking orbit; launch time chosen within the day so the rocket
  flies as close to due east as the transfer allows. Ascent Δv: 9.4 km/s minus Earth's spin bonus
  (Moon 1.9, Mars 4.1).
- Vehicle capability: the rocket equation per stage, with payload; lift-off thrust/weight.
- Display scale: planets drawn with radius ∝ √km; anything near a body (moons, orbits, the craft)
  compressed with the same √ curve so it stays visible. Heliocentric cruise is true to scale.
- Video timing: each phase gets a share of the video (ascent and arrival slow, cruise eased).

Estimates are good to a few percent; not for real mission planning.

## Credits

Planet textures: Solar System Scope (solarsystemscope.com), CC BY 4.0, based on NASA imagery.
The video credit line is on by default.

## Run

    npm install
    npm run dev
