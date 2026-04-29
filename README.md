<p align="left">
  <img src="web/public/favicon.svg" alt="Evalchain" width="56" height="56" />
</p>

# Evalchains

A Bubblemaps-style evaluation-pattern visualizer for the 42 Network.

Search a 42 login and Evalchain builds an interactive network map of every peer who has evaluated them (and every peer they've evaluated), grouping those peers into tiers based on how concentrated the interaction is. Useful for spotting evaluation clusters that don't look organic.

## What it shows

- **Subject** in the center (white node) with their real name + avatar.
- **Peers** orbit in concentric rings, colored by tier:
  - **tight** (pink) — reciprocal ≥ 3, OR one-direction `max ≥ 5`. Strongest signal.
  - **reciprocal** (orange) — each party evaluated the other at least twice.
  - **lopsided** (cyan) — one direction ≥ 3 with no mutual echo.
  - **normal** (grey) — everyone else, shown in a 5-ring outer cloud.
- Click any bubble for a detail panel: avatar, display name, directional counts, and a link to their 42 intra profile.
- Click a tier pill in the bottom-right legend to hide/show that tier.

## Why this isn't just "count repeat evaluators"

A single peer evaluating you 5 times isn't necessarily cheating — it happens on small campuses. The real pattern is directional concentration (you evaluated them 5 times → you may have helped them cheat) or mutual concentration (you evaluated each other repeatedly). Evalchain surfaces both:

- `reciprocal = min(received, given)` — mutuality
- `max = max(received, given)` — concentration in the heavier direction

A profile only flags if *one of those* crosses a threshold, so one-way repeat evaluations don't vanish behind a reciprocity-only metric.

## Running it

Requirements: Node 22+, a 42 OAuth application (UID + SECRET).

1. **Register a 42 app** at [profile.intra.42.fr/oauth/applications/new](https://profile.intra.42.fr/oauth/applications/new). Redirect URI must be exactly `http://localhost:5173/api/auth/callback`, scope `public` is enough.

2. **Create `.env`** at the repo root:

   ```
   FT_CLIENT_ID=your_uid
   FT_CLIENT_SECRET=your_secret
   ```

3. **Install + run** the dev server:

   ```bash
   cd web
   npm install
   npm run dev
   ```

4. Open [http://localhost:5173](http://localhost:5173) and search any 42 login.

First probe for a given login takes 30–60 seconds (paginated API calls, rate-limited at 2 req/s). Subsequent probes hit the local cache at `web/public/<login>.json` and return instantly.

## Architecture

- **`web/vite.config.ts`** — Vite dev-server middleware. Keeps the client secret server-side and manages endpoints:
  - **Auth:** `GET /api/auth/login`, `callback`, and `me` to enforce 42 Intra authentication via OAuth.
  - **Probe:** `GET /api/probe/:login` — fetches scale_teams, computes tiers, and caches to disk. Protected by session cookie.
  - **Search:** `GET /api/search/:q` — type-ahead user search. Protected by session cookie.
  - **Staff API:** `GET /api/staff/blacklist/:login` — Unauthenticated/programmatic endpoint that returns an array of "tight" tier logins for the target user. Useful for auto-matchmaking blacklists.
- **`web/src/App.tsx`** — React + Cytoscape.js single-page app. Features a gorgeous landing dashboard and interactive preset ring layout.
- **`explore.mjs`** — stand-alone CLI probe (same logic as the middleware). Useful for scripting or pre-warming caches:

  ```bash
  node --env-file=.env explore.mjs <login>
  ```

## Status

Ready for public or staff use! Access is now gated by a secure 42 OAuth flow, ensuring only authenticated 42 students can utilize the visualizer, while providing a headless Staff API for backend integrations.

## Codename

`Cheatmap` internally. `Evalchains` is the softer public-facing name — same tool, less bite.
