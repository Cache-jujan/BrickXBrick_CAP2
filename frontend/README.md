# Brick x Brick — Web Frontend (React)

React web dashboard for the Brick x Brick construction management system,
covering the modules currently live on the backend:

- **F1 — Accounts & RBAC**: login, session handling, System Administrator
  user management (create / list / deactivate / unlock).
- **F2 — Project Initialization**: General Manager creates projects;
  General Manager, Project Manager, Site Manager, and Purchaser all see
  the project list ("broadcast").

This talks to the existing Express backend (`routes/auth.js`,
`routes/adminUsers.js`, `routes/projects.js`) — no backend changes needed.

## Setup

```bash
npm install
cp .env.example .env
# edit .env if your backend isn't on http://localhost:3000
npm run dev
```

Opens at `http://localhost:5173`. Make sure the backend (`node src/server.js`
in the `backend/` folder) is running first.

## Project structure

```
src/
  api/            One file per backend resource (authApi, projectsApi,
                   adminApi) plus a shared axios client that attaches the
                   auth token and centralizes 401 handling. Add new
                   modules here as new routes are built (F3, F4, ...).

  components/
    ui/           Generic, app-agnostic building blocks: Button, Field,
                   Card, Badge, Banner. No knowledge of routes or API
                   calls — safe to reuse anywhere.
    layout/       TopNav + DashboardLayout (the shell every signed-in
                   page renders inside).
    projects/     Components specific to the "projects" domain
                   (ProjectCard, ProjectStatCards) — reused across the
                   dashboard, list, and detail pages.

  context/        AuthContext — the single source of truth for "who is
                   signed in," session persistence, and login/logout.

  routes/         ProtectedRoute (must be signed in) and RoleRoute (must
                   have an allowed role) — both are UX guards. The real
                   enforcement is always the backend's requireAuth /
                   requireRole.

  pages/          One folder per route, grouped by domain
                   (Login, Dashboard, Projects, Admin). Each page owns
                   its own .css file — no shared page-level stylesheet
                   full of unrelated selectors.

  utils/          Small reusable hooks, e.g. useProjects (loading/error/
                   data state for the projects list).

  styles/         tokens.css (design tokens: color, type, spacing) and
                   global.css (resets + a few layout utility classes).
```

## Adding a new module (F3+)

1. Add the API functions to a new file in `src/api/` (or extend an
   existing one), mirroring the new Express route file.
2. Add any domain-specific components under `src/components/<domain>/`.
3. Add the page(s) under `src/pages/<Domain>/`.
3. Wire the route in `src/App.jsx`, wrapped in `RoleRoute` with the same
   roles the backend's `requireRole(...)` call allows.
4. Add a nav link in `src/components/layout/TopNav.jsx` if the module
   needs one, scoped to the roles that should see it.

## Design notes

- Palette: warm paper background, oxide-brick accent (used sparingly —
  wordmark, focus states, primary links), muted blueprint-blue as the
  secondary/informational color. Status badges (Active / At Risk /
  Overdue / Inactive) share one color system across projects and users.
- Flat cards, hairline borders, minimal radius — matches the provided
  wireframes rather than a generic soft-shadow SaaS look.
- Single type family (Inter) with a tightened heading weight; this is a
  dense operational dashboard, not a marketing site, so clarity and
  density took priority over typographic variety.
