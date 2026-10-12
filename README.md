# Voyager Space

Animated space voyages for nassau.se/voyager-space. A Webflow Cloud app (Vite + React + three.js),
sister of Voyager Earth, with the same UI components and project storage.

## Two modes

- **Space observer** — pick a body and a date, set camera keypoints (scrub, frame the view, add a
  keypoint); the camera glides through them on a centripetal Catmull–Rom curve while the planets
  move along their real orbits.
- **Vehicle path** — launch from a real spaceport (click it on the globe) or an automatic
  equatorial site on the Moon or Mars, choose or edit a rocket, pick a destination and a scenario
  in step 3 (a new project has no destination until then), and the flight is drawn as a white
  line from the pad to the destination orbit.

## Camera

- **Follow the craft** (vehicle path): rides along and pulls back as the craft leaves a planet;
  dragging and zooming set the angle and distance kept through the flight.
- **Keypoints**: each keypoint is a diamond above the timeline; drag it (or focus it and use the
  arrow keys) to change its time, click it to go there. In the Camera and Preview steps the view
  shows the keypoint move at the playhead; dragging or zooming the view takes it over (to frame a
  new keypoint) until play is pressed. Between keypoints looking at things far apart the camera
  swings out so the way between them stays in view (src/lib/camera.ts).

The Reset button left of step 1 appears once anything differs from a new project, and puts every
setting back (the name stays). Short tips at the top of the steps can be closed; the project menu
brings them back. The version under the header comes from package.json (vite.config.ts).

## How the numbers are made

- Positions, orientation and spin of the Sun, planets, Moon and Galilean moons: astronomy-engine
  (MIT). Scene frame: heliocentric ecliptic J2000, 1 unit = 1 AU.
- Flight: patched conics. A heliocentric Lambert arc between the planets (searched over the
  launch window × flight time; scenarios = least Δv, fastest within 1.6× of least, earliest
  within 1.3× of least, and a balanced score), handed over at each sphere of influence to a
  hyperbola around the planet that starts from the parking orbit (escape) or ends in a capture
  burn or an atmospheric entry. Earth ⇄ Moon: a transfer ellipse from a perigee burn, aimed at
  the B-plane point of a hyperbola around the Moon. Flights to or from the Moon add a leg around
  Earth through the Moon's position. Propagation: universal-variable Kepler solver with a
  bracketed Newton iteration (src/lib/orbits.ts).
- Burns are finite: the conics before and after a burn are blended over the burn's duration,
  which comes from the vehicle's thrust, mass and Isp (src/lib/ascent.ts, Propulsion).
- Launch: the stages burn out when the rocket equation says so, which places MECO, stage
  separation, ignitions and orbit insertion; a gravity turn turns that into altitude and speed,
  and max-Q comes from an exponential atmosphere. Launch time chosen within the day so the
  rocket flies as close to due east as the target plane allows. Ascent Δv: 9.4 km/s minus
  Earth's spin bonus (Moon 1.9, Mars 4.1).
- Landing (optional): airless bodies by a descent-orbit burn and a powered descent (Apollo
  profile); Earth, Mars and Venus by entry, parachutes and touchdown (Apollo, Perseverance,
  Venera profiles) (src/lib/descent.ts).
- Display scale: planets drawn with radius ∝ √km; near a body distances are compressed with the
  same √ curve, handing over smoothly to the parent's scale and to true scale further out
  (src/lib/display.ts). Around a departure or arrival the path is drawn in that body's frame, so
  orbits stay round and approaches come straight in; the cruise is drawn heliocentric.
- HUD: speed relative to the body the craft is around (ground-relative during launch and
  landing, the Sun's frame in the cruise), altitude or distance to go, mission clock, the
  flight's events on a sliding timeline, date and time (src/lib/hud.ts).
- Video timing: each phase gets a share of the video, joined by a monotone cubic time warp.

Estimates are good to a few percent; not for real mission planning.

## Credits

Planet textures: Solar System Scope (solarsystemscope.com), CC BY 4.0, based on NASA imagery.
The video credit line is on by default.

## Run

    npm install
    npm run dev
