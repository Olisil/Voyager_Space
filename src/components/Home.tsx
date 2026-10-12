import { useEffect, useState } from "react";
import { deleteProject, downloadProjectFile, duplicateProject, importProjectFile, listProjects, saveProject } from "../lib/db";
import { BODIES, type BodyId } from "../lib/bodies";
import { navigate } from "../router";
import { ThemeToggle } from "../theme";
import logoUrl from "../assets/voyager-space-logo.svg";
import { demoProject, newProject, type Project } from "../lib/types";

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const LABEL: Record<string, string> = { leo: "Low Earth orbit", sso: "Sun-synchronous orbit", gto: "Geostationary transfer", geo: "Geostationary orbit" };

/** A small orbit diagram: where the trip starts and where it goes. */
function MissionThumb({ project }: { project: Project }) {
  const from = BODIES[project.start.body];
  const dest = project.schedule.destination;
  const toName = project.mode === "observer" ? "Observer" : !dest ? "destination to come" : (LABEL[dest] ?? BODIES[dest as BodyId]?.name ?? "");
  const to = dest ? BODIES[dest as BodyId] : undefined;
  return (
    <svg className="thumb thumb-space" viewBox="0 0 320 180" aria-hidden>
      <rect width="320" height="180" fill="#05070b" />
      {Array.from({ length: 40 }, (_, i) => (
        <circle key={i} cx={(i * 73) % 320} cy={(i * 41) % 180} r={i % 7 === 0 ? 1.1 : 0.6} fill="#fff" opacity={0.5} />
      ))}
      <circle cx="90" cy="110" r="22" fill={from.color} />
      {project.mode === "vehicle" && (
        <>
          <path d="M112 104 C 160 40, 210 40, 240 76" fill="none" stroke={project.look.pathColor} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="250" cy="84" r={to ? 12 : 30} fill={to ? to.color : "none"} stroke={to ? "none" : "#fff"} strokeOpacity="0.4" />
        </>
      )}
      <text x="16" y="164" fill="#e6e6e6" fontSize="13" fontFamily="Raleway, sans-serif">
        {from.name} → {toName}
      </text>
    </svg>
  );
}

export function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const refresh = () =>
    listProjects()
      .then(setProjects)
      .catch(() => {
        setProjects([]);
        setError("This browser won't let the app save projects. Private windows often block it; try a normal window.");
      });
  useEffect(() => {
    refresh();
  }, []);

  const create = async (demo = false) => {
    const p = demo ? demoProject() : newProject();
    await saveProject(p);
    navigate(`/p/${p.id}`);
  };
  const open = async (f: File) => {
    try {
      const p = await importProjectFile(f);
      navigate(`/p/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file couldn't be opened.");
    }
  };

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragOver(true);
    };
    const leave = (e: DragEvent) => e.relatedTarget === null && setDragOver(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) open(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div className="home">
      <header className="topbar app-header home-header">
        <div className="app-header-start">
          <a className="app-logo" href="#/" aria-label="Voyager Space">
            <img src={logoUrl} alt="Voyager Space" width={218} height={25} />
          </a>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span className="crumb-current">Projects</span>
          </nav>
        </div>
        <div className="topbar-end">
          <ThemeToggle />
        </div>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <h1>Animated space voyages</h1>
          <p className="lead">Launch from a real spaceport to an orbit, the Moon or a planet, with real planet positions and real transfer windows. Or fly a camera through the solar system on any date. Render an MP4 up to 4K.</p>
          <div className="button-group">
            <button type="button" className="btn btn-primary" onClick={() => create()}>
              Create project
            </button>
            <label className="btn btn-secondary">
              Open a project file
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) open(f);
                }}
              />
            </label>
          </div>
          <p className="hint">Free, no account. Projects are saved in this browser; download a project file to move one to another computer.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="home-projects" aria-labelledby="projects-title">
          <div className="home-projects-head">
            <h2 id="projects-title">Your projects</h2>
            {projects && projects.length > 0 && (
              <span className="pill">
                {projects.length} {projects.length === 1 ? "project" : "projects"}
              </span>
            )}
          </div>
          {projects === null ? null : projects.length === 0 ? (
            <div className="empty">
              <p>No projects yet. Create one, open a project file, or start from an example mission.</p>
              <button type="button" className="btn" onClick={() => create(true)}>
                Open the example
              </button>
            </div>
          ) : (
            <ul className="cards">
              {projects.map((p) => (
                <li key={p.id} className="card">
                  <a className="card-open" href={`#/p/${p.id}`}>
                    <MissionThumb project={p} />
                    <span className="card-name">{p.name || "Untitled mission"}</span>
                  </a>
                  <div className="card-meta">
                    <span className="pill">{p.output.aspect}</span>
                    <span className="card-time">Edited {ago(p.updatedAt)}</span>
                  </div>
                  <div className="card-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={async () => {
                        await duplicateProject(p);
                        refresh();
                      }}
                    >
                      Duplicate
                    </button>
                    <button type="button" className="btn btn-small" onClick={() => downloadProjectFile(p)}>
                      Download file
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-quiet btn-danger"
                      onClick={async () => {
                        if (!confirm(`Delete ${p.name}? It's removed from this browser. Download the project file first if you want to keep it.`)) return;
                        await deleteProject(p.id);
                        refresh();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="home-foot">
        <span>Maps © OpenStreetMap contributors, OpenMapTiles, OpenFreeMap</span>
        <a href="/">nassau.se</a>
      </footer>
      {dragOver && <div className="drop-veil">Drop a project file to open it</div>}
    </div>
  );
}
