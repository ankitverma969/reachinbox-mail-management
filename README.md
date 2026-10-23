# ReachInbox Full-Stack Email Job Scheduler

A production-grade, distributed email scheduling, delivery, and tracking platform built with **TypeScript**, **Express**, **PostgreSQL (Prisma ORM)**, **BullMQ**, **Redis**, and a modern **React + Vite + Tailwind CSS** frontend adhering strictly to the official Figma design.

Designed to handle high-throughput outreach campaigns (1,000+ emails per batch) with persistent restart recovery, multi-worker concurrency, distributed hourly rate limiting, official Google OAuth 2.0, real Slack alerts, and full-text Elasticsearch indexing.

---

## 1. System Architecture

```
                   +-------------------------------------------------------------+
                   |                 Frontend Dashboard (React + Vite)           |
                   |  - Google OAuth / Dev Session  - Lead CSV/TXT Upload        |
                   |  - Scheduled & Sent Tables     - Multi-Sender Identity Ops  |
                   |  - Live Search (Debounced)     - Slack Integration Manager  |
                   +-------------------------------------------------------------+
                                                  |  HTTP + Cookie Session
                                                  v
                   +-------------------------------------------------------------+
                   |                 HTTP API Layer (Express.js)                 |
                   |  Auth: /api/v1/auth/{google, callback, me, logout}         |
                   |  Emails: /api/v1/emails/{schedule, scheduled, sent, search} |
                   |  Senders: /api/v1/senders (Masked SMTP Credentials)         |
                   |  Integrations: /api/v1/integrations/slack/*                 |
                   |  Bull Board: /admin/queues (Dedicated Admin Basic Auth)     |
                   +-------------------------------------------------------------+
                                     |                           |
               1. ACID Persistence   |                           | 2. Pipelined addBulk
              (Batch + EmailJobs)    v                           v
                  +----------------------+               +--------------------------+
                  | PostgreSQL Database  |               | Redis Master (Port 6379) |
                  |  (Source of Truth)   |               | bull:email-delivery-queue|
                  +----------------------+               +--------------------------+
                         |           ^                                |
       Durable Outbox    |           |                                | Delayed Jobs Promoted
       Event Recording   v           |                                v
                  +--------------+   |           +------------------------------------------+
                  | Indexing     |   |           |          BullMQ Delivery Worker          |
                  | Outbox Table |   |           |  - Worker Concurrency (Default: 5)       |
                  +--------------+   |           |  - Atomic DB Claiming (-> PROCESSING)    |
                         |           |           |  - Cross-Worker Throttle (Redis Lua)     |
             Continuous  |           |           |  - Distributed Hourly Quota (Redis Lua)  |
             Sync Loop   v           |           |  - Next-Hour Rescheduling with Jitter    |
                  +--------------+   |           |  - Real Slack Alert (Redis Deduplication)|
                  |Elasticsearch |   |           |  - Ethereal SMTP Transport & Preview URL |
                  | Cluster 9200 |   |           +------------------------------------------+
                  +--------------+   |                                |
                                     +--------------------------------+
                                       Update Status -> SENT / FAILED
```

### Core Design Principles
1. **PostgreSQL as Source of Truth**: All campaigns, lead states, sender configurations, and delivery attempts are durably persisted in PostgreSQL. Redis and BullMQ manage distributed delayed execution without single-point data residency.
2. **Strictly No Cron Jobs**: Neither OS-level cron (`crontab`) nor Node cron libraries (`node-cron`, `agenda`) are used. Timed dispatch is driven by Redis sorted sets (`ZSET`) where scores represent millisecond epoch timestamps.
3. **Atomic Multi-Instance Concurrency**: Atomic Redis Lua scripts and database row claiming (`UPDATE ... WHERE status = 'SCHEDULED'`) prevent race conditions across parallel worker instances.
4. **Transactional Outbox for Search**: Indexing events are recorded inside the database transaction before writing to Elasticsearch, guaranteeing zero search index drift even during cluster downtime.

---

## 2. Distributed Hourly Rate Limiting

Outreach senders are governed by configurable hourly quotas to safeguard sender domain reputation:

### 2.1 UTC Window Semantics
- Counter keys are scoped strictly to UTC calendar hour boundaries:
  $$\text{Key} = \text{ratelimit:sender:}\{\text{senderId}\}:\{\text{YYYYMMDDTHH}\}$$
- Global counter keys:
  $$\text{Key} = \text{ratelimit:global:}\{\text{YYYYMMDDTHH}\}$$
- Keys expire with a 7,200-second (2-hour) TTL to cleanly span across current window transitions without accumulating orphan keys in Redis.

### 2.2 Atomic Multi-Limit Lua Script
The check-and-reservation executes inside an atomic Redis Lua script ([`check-and-increment-quota.lua`](file:///e:/reachinbox-hiring-assignment/backend/src/modules/rate-limiting/scripts/check-and-increment-quota.lua)):
```lua
-- Deduplicate retried attempts for the same job in the same window
if tonumber(ARGV[5]) == 1 and redis.call('GET', KEYS[3]) then
  return 1 -- Already reserved for this job; prevent double counting
end

-- Check sender and global limits
if (currentSender >= maxSender) then return 0 end
if (hasGlobal == 1 and currentGlobal >= maxGlobal) then return -1 end

-- Atomically reserve quota
redis.call('INCR', KEYS[1])
if hasGlobal == 1 then redis.call('INCR', KEYS[2]) end
if tonumber(ARGV[5]) == 1 then redis.call('SET', KEYS[3], '1', 'EX', expireSec) end
return 1
```

### 2.3 Rescheduling & Ordering Preservation
When a sender hits their hourly limit:
1. **Never Drop or Fail Jobs**: The lead is strictly preserved.
2. **Transition to `RATE_LIMITED_RESCHEDULED`**: Persists the updated state in PostgreSQL.
3. **Reschedule into Next Hour**: Calculates `currentHour + 3600000` plus random jitter (0–60s) to prevent thundering-herd collisions.
4. **Slack Alert Dispatch**: Dispatches an alert to the user's connected Slack workspace, with atomic Redis deduplication ensuring only one alert per sender per hour window.

---

## 3. Technology Stack

### Backend
- **Language**: TypeScript 5.6
- **Runtime**: Node.js 20+ (ES Modules)
- **Framework**: Express.js 4.21
- **Database**: PostgreSQL 16 (via Supabase / Local) + Prisma ORM 5.22
- **Queue Engine**: BullMQ 5.21 backed by Redis 7+
- **Search Engine**: Elasticsearch 8/9 with custom email analyzer
- **Email Delivery**: Nodemailer + Ethereal Fake SMTP
- **Monitoring**: Bull Board (`@bull-board/express`)

### Frontend
- **Framework**: React 18 + Vite 5 + TypeScript
- **Styling**: Tailwind CSS 3 (curated SaaS color palette matching Figma)
- **Icons**: Lucide React
- **CSV Ingestion**: PapaParse (auto header detection & RFC validation)
- **State & HTTP**: Context API + Axios with `withCredentials: true`

---

## 4. Environment Configuration

### Backend Configuration (`backend/.env`)

```env
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Database (PostgreSQL)
DATABASE_URL="postgresql://user:pass@localhost:5432/reachinbox_db?schema=public"

# Redis (BullMQ & Rate Limiter)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Elasticsearch Full-Text Search
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX_PREFIX=reachinbox

# Worker Settings
EMAIL_WORKER_CONCURRENCY=5
MIN_EMAIL_SEND_DELAY_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=200

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/v1/auth/google/callback

# Slack OAuth 2.0 Integration
SLACK_CLIENT_ID=your-slack-client-id
SLACK_CLIENT_SECRET=your-slack-client-secret
SLACK_CALLBACK_URL=http://localhost:5000/api/v1/integrations/slack/callback
SLACK_DEFAULT_CHANNEL=D0CBFH91A5B

# Ethereal Fake SMTP Credentials
ETHEREAL_HOST=smtp.ethereal.email
ETHEREAL_PORT=587
ETHEREAL_USER=your-ethereal-user@ethereal.email
ETHEREAL_PASSWORD=your-ethereal-password

# Dedicated Bull Board Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=reachinbox_admin_secure_pass_2026
ADMIN_API_KEY=reachinbox_admin_api_key_2026

# Security & Secrets
JWT_SECRET=super_secret_jwt_signing_key_minimum_32_characters_long
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
ENABLE_DEV_LOGIN=true
```

### Frontend Configuration (`frontend/.env`)

```env
VITE_API_BASE_URL=http://localhost:5000
```

---

## 5. Local Setup & Startup Commands (Windows PowerShell)

### Step 1: Start Redis Server
```powershell
redis-server --port 6379
```

### Step 2: Backend Setup & Startup
```powershell
cd E:\reachinbox-hiring-assignment\backend
npm install
npx prisma db push
npm run build
npm run dev
```

### Step 3: Frontend Setup & Startup
Open a second terminal:
```powershell
cd E:\reachinbox-hiring-assignment\frontend
npm install
npm run build
npm run dev
```

The frontend dashboard will be available at `http://localhost:5173`.
The backend API and health checks will be available at `http://localhost:5000`.
The Bull Board Queue Monitor will be available at `http://localhost:5000/admin/queues`.

---

## 6. Running Automated Tests

### Backend Test Suites (7 Suites, 75 Tests)
```powershell
cd E:\reachinbox-hiring-assignment\backend
npm test
```
Verifies:
- `health.test.ts`: Service availability and infrastructure health probes.
- `persistence.test.ts`: PostgreSQL models, foreign keys, and transaction rollbacks.
- `phase3-scheduler.test.ts`: Delayed scheduling, 2s throttle delay, worker lifecycle, restart reconciliation, and 1,000-email batch benchmark.
- `phase4-ratelimit-slack.test.ts`: Distributed hourly rate limit, next-hour rollover, and Slack alert deduplication.
- `phase5-search-dashboard.test.ts`: Elasticsearch full-text search, cursor reindex, and Bull Board access.
- `phase6-auth-senders-outbox.test.ts`: Google OAuth state, sender identity manager, and transactional outbox.
- `phase7-security-audit.test.ts`: Production dev-login rejection, constant-time admin auth, brute-force rate limiting, and cross-tenant isolation.

### Frontend Unit Tests (6 Tests)
```powershell
cd E:\reachinbox-hiring-assignment\frontend
npm test
```
Verifies CSV lead parsing, alternative column headers, duplicate elimination, plain-text email lists, and invalid row diagnostics.

---

## 7. API Endpoint Reference

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | TCP infrastructure health probes (DB, Redis, ES) | None |
| `GET` | `/api/v1/auth/google` | Initiates Google OAuth with Redis CSRF state | None |
| `GET` | `/api/v1/auth/google/callback`| Exchanges code, verifies ID token, sets cookie | None |
| `GET` | `/api/v1/auth/me` | Current user profile hydration | Session / Bearer |
| `POST`| `/api/v1/auth/logout` | Clears HttpOnly session cookie | None |
| `POST`| `/api/v1/auth/dev-login` | Local evaluation login (disabled in production) | Local only |
| `GET` | `/api/v1/emails/scheduled` | Paginated scheduled jobs with status and times | User |
| `GET` | `/api/v1/emails/sent` | Paginated sent jobs with Ethereal preview URLs | User |
| `POST`| `/api/v1/emails/schedule` | Bulk schedules outreach batch into PostgreSQL & BullMQ | User |
| `DELETE`| `/api/v1/emails/scheduled/:id` | Cancels scheduled job in PostgreSQL and BullMQ | User (Owner) |
| `GET` | `/api/v1/emails/search` | Scoped Elasticsearch full-text query with highlights | User (Tenant) |
| `GET` | `/api/v1/senders` | Lists user's active sender identities (masked secrets)| User |
| `POST`| `/api/v1/senders` | Creates a new SMTP sender identity | User |
| `GET` | `/api/v1/integrations/slack/authorize` | Initiates Slack workspace OAuth authorization | User |
| `GET` | `/api/v1/integrations/slack/status` | Current Slack workspace connection state | User |
| `POST`| `/api/v1/integrations/slack/test` | Dispatches real-time test alert to Slack | User |
| `DELETE`| `/api/v1/integrations/slack/disconnect` | Revokes and cleans up Slack workspace credentials | User |
| `GET` | `/admin/queues` | Live BullMQ Bull Board dashboard | Admin Basic Auth |

---

## 8. Reliability, Idempotency & Known Trade-offs

### 1. Two Generals Problem & SMTP Delivery Ambiguity
In distributed email architectures, an edge case exists where the SMTP server accepts a message, but network termination occurs before the TCP `250 OK` acknowledgment reaches the worker. Because SMTP does not natively provide transaction rollback, blind retries would cause duplicate outreach emails.
- **Handling**: Delivery attempts record their progress. If the network drops ambiguously, the attempt is recorded as `UNKNOWN_AMBIGUOUS` and requires administrative review rather than uncontrolled duplicate dispatch.

### 2. Redis AOF & Counter Loss Recovery
Rate limit counters are stored in Redis master for sub-millisecond atomic checks. If Redis experiences catastrophic unpersisted reboot, the startup reconciliation pass re-evaluates database `RateLimitAuditLog` records to prevent exceeding hourly allowances.

### 3. Outbox Continuous Synchronization
Elasticsearch dual-write utilizes the **Transactional Outbox Pattern** (`IndexingOutbox` table). A continuous background worker drains pending records every 10 seconds with exponential backoff, ensuring eventual consistency even during Elasticsearch node maintenance.

---

## 9. Evaluation Walkthrough Demo Script
A comprehensive 5-minute evaluation walkthrough script is available at:
`planning/DEMO_SCRIPT.md`