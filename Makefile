.PHONY: up down migrate seed logs test dev clean full rebuild db redis-cli

# Start core services (postgres, redis, minio, api, frontend)
up:
	docker-compose up -d postgres redis minio
	@echo "Waiting for services to be healthy..."
	@sleep 3
	docker-compose up -d api frontend

# Start with feed simulator for development
dev:
	docker-compose --profile dev up -d

# Start everything including CV pipeline
full:
	docker-compose --profile dev --profile full up -d

# Stop all services
down:
	docker-compose down

# Run database migrations
migrate:
	@docker-compose exec postgres psql -U arena -d arena -f /docker-entrypoint-initdb.d/001_initial_schema.sql
	@docker-compose exec postgres psql -U arena -d arena -f /docker-entrypoint-initdb.d/002_seed_feeds.sql
	@docker-compose exec postgres psql -U arena -d arena -f /docker-entrypoint-initdb.d/003_balance_audit.sql
	@echo "Migrations complete."

# Seed database (runs migrations)
seed: migrate

# View logs
logs:
	docker-compose logs -f

# View logs for specific service
logs-%:
	docker-compose logs -f $*

# Run all tests
test:
	cd services/api && npm test
	cd services/cv-pipeline && python -m pytest

# Clean everything (volumes included)
clean:
	docker-compose down -v
	@echo "All volumes removed."

# Rebuild all images
rebuild:
	docker-compose build --no-cache

# Database shell
db:
	docker-compose exec postgres psql -U arena -d arena

# Redis shell
redis-cli:
	docker-compose exec redis redis-cli

# Install all dependencies locally
install:
	cd services/api && npm install
	cd services/wallet && npm install
	cd frontend && npm install
