# Nestora — Database Backup, Disaster Recovery & Rollback Protocols

This runbook outlines operational procedures for backing up MongoDB databases, restoring from snapshots, and executing zero-downtime application and database rollbacks.

---

## 1. Automated & Manual Backup Protocols

### 1.1 MongoDB Atlas Cloud Backups (Continuous)
- **Snapshot Frequency:** Hourly snapshots retained for 24h; Daily snapshots retained for 30 days.
- **Point-in-Time Restore (PITR):** Supported for sub-minute continuous recovery up to 7 days in the past.
- **Trigger Manual Atlas Snapshot:**
  In Atlas Console &rarr; Database Deployments &rarr; Cluster &rarr; **Backup** &rarr; **Take Snapshot Now**.

### 1.2 Manual Snapshot via `mongodump`
```bash
# Set timestamp variable
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Full database backup to compressed archive
mongodump \
  --uri="$MONGODB_URI" \
  --archive="nestora_backup_${TIMESTAMP}.gz" \
  --gzip

# Upload archive to secure cold storage (e.g. AWS S3 / GCS bucket)
aws s3 cp "nestora_backup_${TIMESTAMP}.gz" s3://nestora-db-backups/daily/
```

### 1.3 Database Restoration via `mongorestore`
```bash
# Restore directly from compressed archive (drops existing collections before importing)
mongorestore \
  --uri="$MONGODB_URI" \
  --archive="nestora_backup_20260908_120000.gz" \
  --gzip \
  --drop
```

---

## 2. Emergency Rollback Checklist

When a deployment introduces a critical bug or regression, follow this rollback checklist:

### Step 1: Assess Scope
- [ ] Determine if the issue is Application-layer (Node.js/UI) or Database-layer (schema corruption).

### Step 2: Application Code Rollback (Instant)
- **Render Dashboard:**
  1. Go to **Web Service** &rarr; **Deployments**.
  2. Select the previous stable deployment commit / tag.
  3. Click **Rollback to this revision**.
  4. Traffic routes to the previous healthy container once `/health` responds with `200 OK`.
- **Docker / Git:**
  ```bash
  git checkout <previous-stable-tag>
  docker build -t nestora:latest .
  docker stop nestora-app && docker rm nestora-app
  docker run -d -p 8080:8080 --env-file .env.production --name nestora-app nestora:latest
  ```

### Step 3: Database Schema Backward Compatibility
- Nestora database schemas in all phases are strictly additive (`isDeleted`, `razorpayRefundId`, `DailyAvailability`).
- Rolling back the Node.js application version will not cause database read errors on previously written records.

### Step 4: Post-Rollback Health & Readiness Verification
- [ ] Check Liveness Probe: `curl -f https://<your-domain>/health`
- [ ] Check Readiness Probe: `curl -f https://<your-domain>/ready`
- [ ] Run deployment preflight test: `node scripts/check-deployment-readiness.js`
- [ ] Notify engineering team and record an incident post-mortem in the audit log.
