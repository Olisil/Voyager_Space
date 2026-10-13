# Voyager Space

Animated space voyages for nassau.se/voyager-space. A Webflow Cloud app (Vite + React + three.js),
sister of Voyager Earth, with the same UI components and project storage.

## Two modes

- **Space observer** — pick a body and a date, set camera keypoints (scrub, frame the view, add a
  keypoint); the camera glides through them on a centripetal Catmull–Rom curve while the planets
  move along their real orbits.
- **Vehicle path** — launch from a real spaceport (click it on the globe, where every spaceport
  is named) or an automatic equatorial site on the Moon or Mars, choose or edit a rocket, pick a
  destination and a scenario in step 3 (a new project has no destination until then), and the
  flight is drawn as a white line from the pad to the destination orbit or landing site. A green
  start-of-journey mark sits on the launch site while the journey is set up, and in the video
  until the climb from the pad has been drawn out. The view can be
  centred on the planet or on the spaceport itself (Start step); the spaceport view turns with
  the ground.

## The frame

The video frame is shown inside the viewport with a semi-transparent passe-partout around it,
and its proportion and pixel size above its top-left corner, as in Voyager Earth. The 3D view
fills the whole viewport (setViewOffset), so the frame shows exactly what the video will.

## Camera

- **Follow the craft** (vehicle path): rides along and pulls back as the craft leaves a planet;
  dragging and zooming set the angle and distance kept through the flight. **Keep the camera
  above the craft** (on by default): within a few radii of a body the camera is drawn up over the
  craft (from the body's centre through the craft) and a little behind it, so the craft is never
  hidden behind the body and the camera never ends up inside it.
- **Keypoints**: each keypoint is a diamond above the timeline; drag it (or focus it and use the
  arrow keys) to change its time, click it to go there. In the Camera and Preview steps the view
  shows the keypoint move at the playhead; dragging or zooming the view takes it over (to frame a
  new keypoint) until play is pressed. Between keypoints looking at things far apart the camera
  swings out so the way between them stays in view (src/lib/camera.ts).

The Reset button left of step 1 appears once anything differs from a new project, and puts every
setting back (the name stays). Short tips at the top of the steps can be closed; the project menu
brings them back. The version under the header comes from package.json (vite.config.ts).

## Header

As in Voyager Earth: the Voyager Space logo and a breadcrumb on the left; on the right
**Buy me a coffee**, **Apps home** and the site's theme toggle. The header plate is always dark,
so these keep their dark-mode colours in light mode too.

- Buy me a coffee is the button from nassau.se/apps (Buy Me a Coffee logo, signal green with the
  coffee in Signal On) and opens the same support panel as the Apps page (`src/lib/support.ts`,
  `.nx-bmc` styles copied from the page). With a modifier key it opens buymeacoffee.com/nassau in
  a new tab. Below 1000 px wide it shows the cup only.
- Apps home is a nav link like the site's main navigation (`.nav-text-link`) and goes to `/apps`.
  On phones it reads "Apps".
- The project menu (download, duplicate, show tips) is the icon button left of the video shape
  select in the step bar. Both live in `src/components/HeaderNav.tsx` and `Editor.tsx`.

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
- Ascent from the Moon, Mercury and Mars: a lander pushing at a few times the local gravity,
  as Apollo's ascent stage did, so the climb takes minutes and rises along an arc that levels off
  into orbit far downrange (src/lib/ascent.ts).
- Landing (optional): airless bodies by a descent-orbit burn and a powered descent (Apollo
  profile) that brakes to a standstill on the spot it lands on. Earth, Mars and Venus by an
  atmospheric entry integrated through a simple atmosphere (drag, a little lift, gravity, the
  curve of the ground), then parachutes as they open on speed or height: Apollo's drogues and
  mains into the sea, Perseverance's parachute and sky-crane descent, Venera's parachute and
  hour-long fall to touch down at about 7 m/s (src/lib/descent.ts). Descents are flown relative
  to the turning ground, so they meet it at the ground's own speed.
- Display scale: planets drawn with radius ∝ √km; near a body distances are compressed with the
  same √ curve, handing over to the parent's scale and to true scale further out through a
  smooth band that leaves both sides exact, so the craft sits exactly on the drawn pad and the
  drawn landing site (src/lib/display.ts). Around a departure or arrival the path is drawn in
  that body's frame, so orbits stay round and approaches come straight in; the cruise is drawn
  heliocentric. The climb from the pad and the descent after touchdown turn with the ground.
  Away from the Moon, Earth's picture keeps the Moon's neighbourhood where the craft left it (or
  will reach it), so the path is not dragged along by the Moon's motion. The path is sampled
  adaptively (tighter where it bends) and drawn relative to the craft, so it stays smooth even
  close up in single-precision graphics.
- Planet maps: 2K–4K maps load with the page; sharper 8K (Earth, Moon, Mars), 6K (Mercury) and
  4K (Jupiter, Saturn, Sun) maps (src/assets/textures/hi, WebP where it is smaller) are fetched
  only when the camera comes close enough to see the difference, and dropped again when it
  leaves. Video export waits for them.
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
