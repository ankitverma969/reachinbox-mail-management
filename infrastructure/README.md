# ReachInbox Local Infrastructure Guide

This directory documents the containerized local infrastructure powering the ReachInbox Email Job Scheduler.

We use **Docker Compose** to manage the underlying storage, caching, and search layers so that you can run the entire system on any machine without installing individual databases manually.

---

## 1. What Services Run Here?

The system coordinates three specialized services:

| Service | Technology | Port | What it does in plain English | Why we need it |
|---|---|:---:|---|---|
| **Primary Database** | **PostgreSQL 16** (`postgres:16-alpine`) | `5432` | The **permanent filing cabinet**. Stores all users, sender accounts, email campaign batches, delivery attempt records, and audit logs. | Guarantees that no data is ever lost, even if servers restart or power fails (ACID compliance). |
| **Queue & Cache Broker** | **Redis 7** (`redis:7-alpine`) | `6379` | The **high-speed timer and conveyer belt**. Holds delayed email jobs for BullMQ and tracks hourly sending quotas in microseconds. | Relational databases are too slow for high-frequency millisecond timers and distributed locks; Redis provides lightning-fast in-memory operations. |
| **Search Engine** | **Elasticsearch 8.11** (`elasticsearch:8.11.3`) | `9200` | The **supercharged library catalog**. Indexes the subject, body, and recipient of every email. | Allows users to search through tens of thousands of emails in milliseconds with typo-tolerance and highlighting. |

---

## 2. Prerequisites

- [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) installed and running.
- Ensure ports `5432` (PostgreSQL), `6379` (Redis), and `9200` (Elasticsearch) are not in use by other local software.

---

## 3. Operational Commands (Windows PowerShell)

Run these commands from the root directory of the repository (`E:\reachinbox-hiring-assignment`):

### 1. Validate Docker Compose Configuration
Checks that `docker-compose.yml` has valid syntax and parameters against `backend/.env`:
```powershell
docker compose --env-file backend/.env config
```

### 2. Start Services in the Background
Downloads images (if not already cached) and starts the core containers:
```powershell
docker compose --env-file backend/.env up -d
```

### 3. Check Service Health & Status
Verify that services show `running` and `healthy`:
```powershell
docker compose --env-file backend/.env ps
```

### 4. Inspect Live Logs
To see what a specific database is doing in real time:
```powershell
# Stream logs for all services
docker compose logs -f

# Stream logs for a specific service
docker compose logs -f postgres
docker compose logs -f redis
docker compose logs -f elasticsearch
```

### 5. Stop Services
```powershell
# Stop containers safely without deleting your saved data
docker compose down

# Stop containers AND delete database storage (Destructive clean reset)
docker compose down -v
```

---

## 4. Automatic Health Checks

Docker Compose is configured with automated health probes that verify each service is responsive before dependent services connect:

- **PostgreSQL**: Runs `pg_isready -U reachinbox -d reachinbox_db` every 5 seconds.
- **Redis**: Runs `redis-cli ping` expecting `PONG` every 5 seconds. AOF (Append-Only File) persistence is enabled (`--appendonly yes`) to write operations to disk every second.
- **Elasticsearch**: Executes an HTTP health check (`curl -s http://localhost:9200/_cluster/health`) expecting a `green` or `yellow` cluster status.

---

## 5. Troubleshooting & FAQ

### Port Collision (e.g. `Bind for 0.0.0.0:5432 failed: port is already allocated`)
- **Cause**: A local PostgreSQL or Redis instance is already running natively on your Windows host.
- **Solution**: Either stop the local Windows service in Windows Services (`services.msc`), or point `DATABASE_URL` in `backend/.env` directly to your local instance.

### Elasticsearch Exits Immediately
- **Cause**: Elasticsearch requires a minimum of 2 GB of Docker memory to run comfortably.
- **Solution**: Open Docker Desktop Settings → Resources → set Memory to at least 4 GB. Our Compose file sets `-Xms512m -Xmx512m` to minimize memory usage for development.
