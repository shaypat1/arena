.PHONY: start stop migrate install db redis-cli

# Start everything (API + frontend + simulator)
start:
	@echo "Starting API..."
	@cd services/api && export $$(grep -v '^#' ../../.env | xargs) && NODE_PATH=./node_modules:../wallet/node_modules node index.js &
	@echo "Starting frontend..."
	@cd frontend && npx next dev --port 3000 &
	@echo "Starting feed simulator..."
	@cd services/feed-simulator && python3 simulator.py &
	@echo "All services started"

# Stop all
stop:
	@pkill -f "node index.js" 2>/dev/null; pkill -f "next dev" 2>/dev/null; pkill -f "simulator.py" 2>/dev/null; echo "Stopped"

# Run database migrations
migrate:
	@/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena -f db/migrations/001_initial_schema.sql
	@/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena -f db/migrations/002_seed_feeds.sql
	@/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena -f db/migrations/003_balance_audit.sql
	@/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena -f db/migrations/004_cameras.sql
	@echo "Migrations complete"

# Install all dependencies
install:
	cd services/api && npm install
	cd services/wallet && npm install
	cd frontend && npm install
	pip3 install redis psycopg2-binary numpy

# Database shell
db:
	/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena

# Redis shell
redis-cli:
	redis-cli
