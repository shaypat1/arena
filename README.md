# Arena

Bet on cars from around the world. Watch live traffic cameras, predict even/odd/zero car counts, win.

## Setup

```bash
# Prerequisites: Homebrew, Node 20, Python 3
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis

# Create database
psql -U $(whoami) -d postgres -c "CREATE USER arena WITH PASSWORD 'arena_dev' CREATEDB;"
psql -U $(whoami) -d postgres -c "CREATE DATABASE arena OWNER arena;"

# Install dependencies
make install

# Run migrations
cp .env.example .env
make migrate

# Start everything
make start
```

Open http://localhost:3000

## How it runs

- **PostgreSQL** — users, bets, rounds, cameras (43 live traffic cams worldwide)
- **Redis** — pub/sub for round events and settlement
- **API** (port 3001) — Express + Socket.IO, round scheduler, settlement listener
- **Frontend** (port 3000) — Next.js, HLS video player, betting UI
- **Feed simulator** — settles rounds with random outcomes (temporary until CV is wired in)

## Game loop

1. Random daytime camera selected (timezone-aware filtering)
2. **15 seconds** — "Place Your Bets" (feed hidden, location shown)
3. **15 seconds** — "Counting Cars" (feed revealed, bets locked)
4. Round settles, next camera loads

## Betting

- **Even** — even number of cars (pays 1.96x)
- **Odd** — odd number of cars (pays 1.96x)
- **Zero** — no cars at all (pays 100x)

House edge: 2% on even/odd via payout, plus the zero outcome killing both sides.
