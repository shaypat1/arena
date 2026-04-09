# Arena

Real-world betting platform where users bet on observable events from public livestream camera feeds. Crypto-funded, CV-settled, provably fair.

## Quick Start

```bash
# 1. Copy environment config
cp .env.example .env

# 2. Start all services (postgres, redis, minio, api, frontend, feed simulator)
make dev

# 3. Wait for services to initialize (~15s), then open
open http://localhost:3000
```

## Architecture

```
Frontend (Next.js :3000)
    │
    ├── HTTP REST ──► API Gateway (Express :3001)
    │                     ├── Auth (JWT)
    │                     ├── Wallet Service (deposit/withdraw, USD ledger)
    │                     ├── Betting Engine (rounds, pools, settlement)
    │                     └── Geo-blocking (451 for restricted regions)
    │
    └── WebSocket ──► Socket.IO Server
                          └── Redis Pub/Sub Bridge
                                  │
              ┌─────────────────────┘
              │
    Feed Simulator / CV Pipeline
              │
         Redis "settlement" channel
              │
         Settlement Listener ──► Betting Engine (settleRound)
```

## Services

| Service | Port | Description |
|---|---|---|
| `postgres` | 5432 | PostgreSQL 16 — all platform data |
| `redis` | 6379 | Pub/sub events, rate limiting, price cache |
| `minio` | 9000/9001 | S3-compatible frame/clip storage |
| `api` | 3001 | REST API + WebSocket + round scheduler + settlement listener |
| `frontend` | 3000 | Next.js 14 app |
| `feed-simulator` | — | Dev-mode settlement generator (profile: dev) |
| `cv-pipeline` | — | YOLOv8 real CV detection (profile: full) |

## Make Commands

```bash
make up        # Start core services (no simulator)
make dev       # Start with feed simulator
make full      # Start everything including CV pipeline
make down      # Stop all services
make migrate   # Run database migrations
make logs      # Tail all service logs
make db        # PostgreSQL shell
make redis-cli # Redis shell
make clean     # Remove all volumes
make rebuild   # Rebuild all Docker images
make install   # Install npm dependencies locally
```

## Betting Model

Seeded parimutuel with 5% rake:

- House seeds both sides of every pool weighted by historical probability
- Users bet into the pool — odds are `(total_pool * 0.95) / amount_on_outcome`
- Odds update live as bets come in
- At settlement: 5% rake off the top, remainder split proportionally among winners
- House has zero directional risk — profits from rake regardless of outcome

## Tech Stack

- **Frontend:** Next.js 14, React 18, TailwindCSS, Socket.IO, Zustand
- **API:** Node.js 20, Express, Socket.IO, Bull queues
- **Database:** PostgreSQL 16 (micro-USD BIGINT ledger)
- **Cache/Pubsub:** Redis 7
- **CV Pipeline:** Python 3.11, YOLOv8, OpenCV, ffmpeg
- **Crypto:** ethers.js (ETH), bitcoinjs-lib (BTC), @solana/web3.js (USDT)

## Feeds

4 live camera feeds from YouTube (via worldcams.tv):
- Times Square Crosswalk (New York)
- Abbey Road Crossing (London)
- Jackson Hole Town Square (Wyoming)
- Nampo Port Fish Market (Busan)

Each feed has 2 bet types: Next Car Color (8 outcomes) and Pedestrian Count (over/under).
