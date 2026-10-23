# ReachInbox Local Infrastructure

This directory documents the Docker Compose infrastructure required for local development and testing of the ReachInbox Email Scheduler.

## Service Inventory

| Service | Image | Local Port | Volume | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **PostgreSQL** | `postgres:16-alpine` | `5432` | `postgres_data` | Relational single-source-of-truth storage for users, senders, jobs, and audit logs. |
| **Redis** | `redis:7-alpine` | `6379` | `redis_data` | Distributed queue broker (BullMQ), atomic rate limit counters, and temporary locks. Configured with AOF persistence. |
| **Elasticsearch** | `elasticsearch:8.11.3` | `9200` | `elasticsearch_data` | Sub-second full-text email search across subject, body, and recipient records. Security disabled for development. |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine installed and running.
- Ensure ports `5432`, `6379`, and `9200` are free on the host machine.

---

## Operational Commands

### 1. Validate Compose Configuration
```bash
docker compose config
```

### 2. Start Services in Background
```bash
docker compose up -d
```

### 3. Check Service Health & Status
```bash
docker compose ps
```

### 4. Inspect Live Logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f postgres
docker compose logs -f redis
docker compose logs -f elasticsearch
```

### 5. Stop Services
```bash
# Stop containers while preserving volume data
docker compose down

# Stop and wipe persistent volume data (destructive clean reset)
docker compose down -v
```

---

## Healthcheck Diagnostics

- **PostgreSQL**: Tested via `pg_isready -U reachinbox -d reachinbox_db` every 5 seconds.
- **Redis**: Tested via `redis-cli ping` expecting `PONG` every 5 seconds.
- **Elasticsearch**: Tested via cluster health query returning `green` or `yellow` status.
