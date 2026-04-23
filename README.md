# Evalchain

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

1. **Register a 42 app** at [profile.intra.42.fr/oauth/applications/new](https://profile.intra.42.fr/oauth/applications/new). Redirect URI `http://localhost:3000/callback`, scope `public` is enough.

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

- **`web/vite.config.ts`** — Vite dev-server middleware exposing two endpoints. Keeps the client secret server-side:
  - `GET /api/probe/:login` — fetches `as_corrected` and `as_corrector` scale_teams, resolves peer profiles in batches, computes tiers, caches to disk.
  - `GET /api/search/:q` — type-ahead user search used by the header dropdown.
- **`web/src/App.tsx`** — React + Cytoscape.js single-page app. Uses a `preset` layout with hand-placed ring radii and a scatter→settle animation.
- **`explore.mjs`** — stand-alone CLI probe (same logic as the middleware). Useful for scripting or pre-warming caches:

  ```bash
  node --env-file=.env explore.mjs <login>
  ```

## Status

Dev-only for now. Shipping publicly would need a hosted backend (replacing the Vite middleware) and a decision on whether the tool is login-gated (your own map only) or open.

## Codename

`Cheatmap` internally. `Evalchain` is the softer public-facing name — same tool, less bite.
