.PHONY: start stop migrate install db redis-cli

# Start everything (API + frontend + simulator)
start:
	@echo "Starting API..."
	@cd services/api && export $$(grep -v '^#' ../../.env | xargs) && NODE_PATH=./node_modules:../wallet/node_modules node index.js &
	@echo "Starting frontend..."
	@cd frontend && npx next dev --port 3000 &
	@echo "Starting feed simulator..."
	@cd services/feed-simulator && ./venv/bin/python simulator.py &
	@echo "Starting CV counter..."
	@cd services/cv-counter && ./venv/bin/python main.py > /tmp/cv-counter.log 2>&1 &
	@echo "All services started"

# Stop all
stop:
	@pkill -f "node index.js" 2>/dev/null; pkill -f "next dev" 2>/dev/null; pkill -f "feed-simulator.*simulator.py" 2>/dev/null; pkill -f "cv-counter.*main.py" 2>/dev/null; pkill -9 -f "Python main.py" 2>/dev/null; echo "Stopped"

# Run database migrations
migrate:
	@/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena -f db/migrations/001_initial_schema.sql
	@/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena -f db/migrations/002_seed_feeds.sql
	@/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena -f db/migrations/003_balance_audit.sql
	@/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena -f db/migrations/004_cameras.sql
	@/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena -f db/migrations/005_seed_cameras.sql
	@/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena -f db/migrations/006_car_count_and_roi.sql
	@echo "Migrations complete"

# Install all dependencies
install:
	cd services/api && npm install
	cd services/wallet && npm install
	cd frontend && npm install
	cd services/feed-simulator && python3 -m venv venv && ./venv/bin/pip install -q redis psycopg2-binary numpy
	cd services/cv-counter && python3 -m venv venv && ./venv/bin/pip install -q -r requirements.txt

# Database shell
db:
	/opt/homebrew/opt/postgresql@16/bin/psql -U arena -d arena

# Redis shell
redis-cli:
	redis-cli
