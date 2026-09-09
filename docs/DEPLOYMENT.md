# Nestora — Production Deployment & Operations Guide

This guide provides end-to-end instructions for deploying, operating, backing up, monitoring, and rolling back Nestora on cloud platforms (Render, Railway, Fly.io, AWS, or Docker).

---

## 1. Prerequisites

- **Node.js**: `v20.x` or `v22.x` LTS
- **MongoDB**: MongoDB Atlas Cluster (v6.0+ or v7.0+) with replica set support
- **Cloudinary Account**: Cloud image hosting and optimized media delivery
- **Mapbox Account**: Public access token for interactive stay maps
- **Razorpay Account**: Live or Test Key ID & Secret for cryptographic payments
- **SMTP Service**: SendGrid, AWS SES, Mailgun, Postmark, or standard SMTP credentials for transactional emails

---

## 2. Production Environment Variables

| Variable | Required | Description | Example / Source |
|---|---|---|---|
| `NODE_ENV` | Yes | Runtime environment | `production` |
| `PORT` | Yes | Application port | `8080` (or platform default) |
| `MONGODB_URI` | Yes | MongoDB Atlas connection string | `mongodb+srv://user:pass@cluster.mongodb.net/nestora?retryWrites=true&w=majority` |
| `SESSION_SECRET` | Yes | 64+ char random key for session encryption | `openssl rand -hex 32` |
| `CLOUDINARY_CLOUD_NAME` | Yes | Cloudinary account identifier | Cloudinary Dashboard |
| `CLOUDINARY_API_KEY` | Yes | Cloudinary public API key | Cloudinary Dashboard |
| `CLOUDINARY_API_SECRET` | Yes | Cloudinary private secret key | Cloudinary Dashboard |
| `MAPBOX_ACCESS_TOKEN` | Yes | Mapbox GL public client token | Mapbox Account Dashboard |
| `RAZORPAY_KEY_ID` | Yes | Razorpay Gateway public key | Razorpay Dashboard &rarr; API Keys |
| `RAZORPAY_KEY_SECRET` | Yes | Razorpay Gateway private HMAC key | Razorpay Dashboard &rarr; API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | Yes | Razorpay Webhook HMAC secret | Razorpay Dashboard &rarr; Webhooks |
| `SMTP_HOST` | Optional | SMTP mail server hostname | `smtp.sendgrid.net` |
| `SMTP_PORT` | Optional | SMTP mail port | `587` (TLS) or `465` (SSL) |
| `SMTP_USER` | Optional | SMTP username / API key | `apikey` |
| `SMTP_PASS` | Optional | SMTP password / API token | `SG.xxxxxxxx...` |
| `EMAIL_FROM` | Optional | Default transactional sender address | `Nestora Stays <notifications@nestora.com>` |
| `APP_BASE_URL` | Optional | Canonical application URL | `https://nestora.onrender.com` |

---

## 3. Reproducible Builds & Package Installation

Always install dependencies using `npm ci` to guarantee that builds match `package-lock.json` precisely without version drift:

```bash
# Production install (skips devDependencies)
npm ci --omit=dev

# Development / CI install
npm ci
```

---

## 4. Database Initialization & Seeding

After provisioning a fresh database, seed the initial Administrator account:

```bash
npm run seed:admin
```

Default seeded credentials:
- **Username:** `admin`
- **Email:** `admin@nestora.com`
- **Password:** `Admin@123` *(Must be rotated immediately upon first login)*

---

## 5. Automated Database Backup & Disaster Recovery

### 5.1 MongoDB Atlas Continuous Backups (Recommended)
1. In the MongoDB Atlas Console, navigate to **Backup** under your cluster.
2. Enable **Cloud Backup** with snapshot schedules:
   - **Hourly snapshots** retained for 24 hours.
   - **Daily snapshots** retained for 30 days.
   - **Weekly snapshots** retained for 1 year.
3. Enable Point-in-Time Restore (PITR) for sub-minute recovery.

### 5.2 Manual Snapshot via `mongodump`
```bash
# Export compressed archive
mongodump --uri="$MONGODB_URI" --archive="nestora_backup_$(date +%Y%m%d_%H%M%S).gz" --gzip

# Restore from compressed archive
mongorestore --uri="$MONGODB_URI" --archive="nestora_backup_20260908_120000.gz" --gzip --drop
```

---

## 6. Secret Management & Key Rotation

1. **Storage:**
   - Use encrypted environment managers (Render Environment Groups, AWS Secrets Manager, Doppler, or HashiCorp Vault).
   - Never commit `.env` or secrets into git.
2. **Rotation Protocol:**
   - **Razorpay Secrets:** Generate a new key in Razorpay Dashboard with dual-key grace period &rarr; Update `RAZORPAY_KEY_SECRET` in cloud env &rarr; Revoke old key.
   - **Session Secret:** Rotating `SESSION_SECRET` will gracefully invalidate active guest sessions, prompting clean re-login.
   - **Cloudinary / SMTP:** Rotate via respective provider dashboards and restart deployment services.

---

## 7. Monitoring, Observability & Health Probes

### 7.1 Liveness Probe (`GET /health`)
- **Purpose:** Verifies that the Node.js event loop is responsive.
- **HTTP Status:** `200 OK`
- **Payload:**
  ```json
  {
    "status": "ok",
    "service": "nestora",
    "uptime": 3600,
    "timestamp": "2026-09-08T20:00:00.000Z",
    "memoryUsage": { "rss": 45123456, "heapUsed": 28456123 },
    "environment": "production"
  }
  ```

### 7.2 Readiness Probe (`GET /ready`)
- **Purpose:** Validates active MongoDB database connectivity and measures round-trip latency.
- **HTTP Status:** `200 OK` (or `503 Service Unavailable` if database disconnected).
- **Payload:**
  ```json
  {
    "status": "ready",
    "service": "nestora",
    "database": "connected",
    "dbLatencyMs": 3,
    "timestamp": "2026-09-08T20:00:00.000Z"
  }
  ```

### 7.3 Correlation IDs & Structured Request Logs
- Every request is tagged with an `X-Request-Id` UUID correlation header.
- Structured JSON output enables instant ingestion by Datadog, Better Stack, CloudWatch, or Logtail:
  ```json
  {"timestamp":"2026-09-08T20:00:00.000Z","requestId":"3c9a1b2c-4d5e...","method":"POST","url":"/bookings/123/verify","statusCode":302,"durationMs":42,"ip":"192.0.2.1","userId":"66df...","role":"guest"}
  ```

---

## 8. Continuous Integration (CI/CD Pipeline)

GitHub Actions workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) executes automatically on all pull requests and commits to `main`:
1. Matrix test on **Node.js 20.x and 22.x**.
2. Spin up ephemeral **MongoDB 7.0 service container**.
3. Execute `npm ci` for reproducible dependency resolution.
4. Run JavaScript syntax validation (`npm run test:syntax`).
5. Execute end-to-end integration test suite (`npm test`).
6. Run full regression suite (`npm run test:all`).

---

## 9. Deployment Methods

### Option A: Render (1-Click Blueprint via `render.yaml`)
1. Connect repository to [Render](https://render.com).
2. Create **New Web Service** from Blueprint.
3. Fill in secret variables (`MONGODB_URI`, `CLOUDINARY_*`, `MAPBOX_ACCESS_TOKEN`, `RAZORPAY_*`, `SESSION_SECRET`).
4. Build command: `npm ci --omit=dev`
5. Start command: `npm start`
6. Health check: `/health`
7. Click **Deploy**.

### Option B: Docker Container Deployment
```bash
# Build multi-stage optimized image
docker build -t nestora:latest .

# Run hardened container with non-root user
docker run -d \
  -p 8080:8080 \
  --env-file .env.production \
  --name nestora-app \
  nestora:latest
```

---

## 10. Post-Deployment Verification Checklist

1. [ ] **Liveness Check:** `curl -f https://your-domain.com/health` returns `HTTP 200`.
2. [ ] **Readiness Check:** `curl -f https://your-domain.com/ready` returns `HTTP 200` with `dbLatencyMs`.
3. [ ] **Explore Stays:** Verify listings load with pagination, images, and Mapbox map.
4. [ ] **User Auth:** Test Registration, Email verification link, Login, and Password reset.
5. [ ] **Booking Hold:** Create a 15-minute booking hold and verify date overlap blocking.
6. [ ] **Razorpay Checkout:** Verify HMAC signature verification and order ID matching.
7. [ ] **Webhook Endpoint:** Verify Razorpay webhook triggers `payment.captured` with signature verification.
8. [ ] **Cancellation & Refund:** Cancel a booking and verify accurate policy refund calculation.
9. [ ] **Admin Audit Trail:** Access `/admin/audit-logs` and review immutable audit records.
10. [ ] **Security Headers:** Verify Helmet CSP, `X-Frame-Options`, `X-Content-Type-Options`, and HTTPS cookies.

---

## 11. Zero-Downtime Rollback Protocols

1. **Cloud Blueprint Rollback (Render / Railway / Fly.io):**
   - Navigate to **Deployments** &rarr; Select the previous stable commit &rarr; Click **Rollback**.
   - Deployment switches traffic instantly once new container passes `/health`.
2. **Git & Docker Rollback:**
   ```bash
   git checkout <last-known-good-tag>
   npm ci --omit=dev
   npm test
   npm start
   ```
3. **Database Schema Rollback:**
   All Phase 1–6 schemas maintain non-breaking backward compatibility with additive fields and soft deactivations (`isDeleted: true`).
