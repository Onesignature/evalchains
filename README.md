<p align="left">
  <img src="web/public/favicon.svg" alt="Evalchains" width="56" height="56" />
</p>

# Evalchains

A beautiful, interactive evaluation-pattern visualizer for the 42 Network. 

Search any 42 login, and Evalchains instantly builds a dynamic network map of every peer who has evaluated them (and every peer they've evaluated), grouping them into visual rings based on interaction frequency.

## What is it for?

- **A Trip Down Memory Lane:** See your entire 42 journey mapped out. Who did you evaluate the most? Who evaluated you? 
- **Peeping on Peers:** Look up your friends, explore their evaluation circles, and discover who their tightest peers are.
- **Academic Integrity:** Quickly identify "evaluation rings" where users evaluate each other suspiciously often. 

## The Tiers

A peer orbiting a subject is categorized into one of four tiers based on their evaluation frequency:
- **Tight (Pink)** — Highly concentrated mutual or one-way evaluations.
- **Reciprocal (Orange)** — You evaluated each other at least twice.
- **Lopsided (Cyan)** — Heavy evaluations in one direction with no echo.
- **Normal (Grey)** — Standard, infrequent evaluations.

## Running Locally

Requirements: Node 22+ and a 42 OAuth application.

1. Register a 42 app with the redirect URI `http://localhost:5173/api/auth/callback`.
2. Create a `.env` file at the root:
   ```
   FT_CLIENT_ID=your_uid
   FT_CLIENT_SECRET=your_secret
   ```
3. Run the application:
   ```bash
   cd web
   npm install
   npm run dev
   ```

## Staff / Matchmaking API

Evalchains provides a headless, programmatic endpoint specifically designed for Bocal or automated matchmaking systems to break up evaluation rings in real-time.

**Endpoint:** `GET /api/staff/blacklist/<login>`

This endpoint skips the UI and returns a clean JSON array of peers who fall into the "tight" tier.

**Example Response:**
```json
{
  "target": "bsaeed",
  "reason": "Highly concentrated evaluations (tight tier)",
  "blacklist": ["jdoe", "asmith"]
}
```

Right before the 42 matchmaking system assigns an evaluator, it can query this endpoint and automatically exclude anyone in the `blacklist` array from the pool of potential peers.
