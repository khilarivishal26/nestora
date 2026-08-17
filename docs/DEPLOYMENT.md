# Nestora — Production Deployment Guide

This guide provides end-to-end instructions for deploying Nestora to cloud platforms (Render, Railway, Fly.io, AWS, or Docker).

---

## 1. Prerequisites

- **Node.js**: `v20.x` or `v22.x` LTS
- **MongoDB**: MongoDB Atlas Cluster (v6.0+ or v7.0+)
- **Cloudinary Account**: For cloud image storage
- **Mapbox Account**: Public access token for interactive maps
- **Razorpay Account**: Live or Test Key ID & Secret for payments

---

## 2. Required Production Environment Variables

| Variable | Description | Source / How to Obtain |
|---|---|---|
| `NODE_ENV` | Must be `production` | Set manually to `production` |
| `PORT` | HTTP port the server binds to | Default: `8080` (or platform assigned) |
| `MONGODB_URI` | MongoDB connection string | MongoDB Atlas Dashboard &rarr; Connect |
| `SESSION_SECRET` | 64+ char random string for session encryption | Generate via `openssl rand -hex 32` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account name | Cloudinary Console Dashboard |
| `CLOUDINARY_API_KEY` | Cloudinary API Key | Cloudinary Console Dashboard |
| `CLOUDINARY_API_SECRET` | Cloudinary API Secret | Cloudinary Console Dashboard |
| `MAPBOX_ACCESS_TOKEN` | Mapbox public access token | Mapbox Account Dashboard |
| `RAZORPAY_KEY_ID` | Razorpay Key ID | Razorpay Dashboard &rarr; API Keys |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret | Razorpay Dashboard &rarr; API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Webhook secret | Razorpay Dashboard &rarr; Webhooks |

---

## 3. Database Initialization & Admin Seeding

After deploying and pointing to a fresh MongoDB Atlas database, seed the initial Administrator account:

```bash
npm run seed:admin
```

Default seeded credentials:
- **Username:** `admin`
- **Email:** `admin@nestora.com`
- **Password:** `Admin@123` *(Change immediately in production)*

---

## 4. Deployment Methods

### Option A: Render (Recommended — 1-Click via `render.yaml`)

1. Connect your GitHub repository to [Render.com](https://render.com).
2. Create a **New Web Service** from Blueprint (`render.yaml`).
3. Fill in the environment variables (`MONGODB_URI`, `CLOUDINARY_*`, `MAPBOX_ACCESS_TOKEN`, `RAZORPAY_*`).
4. Build command: `npm install`
5. Start command: `npm start`
6. Health check path: `/health`
7. Click **Deploy**.

### Option B: Docker Container Deployment

1. **Build the container image:**
   ```bash
   docker build -t nestora:latest .
   ```
2. **Run container locally with environment file:**
   ```bash
   docker run -d -p 8080:8080 --env-file .env --name nestora-app nestora:latest
   ```
3. **Verify running container:**
   ```bash
   docker ps
   curl http://localhost:8080/health
   ```

---

## 5. Health Check & Monitoring

- **Endpoint:** `GET /health`
- **Response Format:**
  ```json
  {
    "status": "ok",
    "service": "nestora",
    "uptime": 124,
    "timestamp": "2026-08-17T12:00:00.000Z",
    "database": "connected",
    "environment": "production"
  }
  ```
- **HTTP Status:** `200 OK` (or `503 Service Unavailable` if database is disconnected).

---

## 6. Post-Deployment Verification Checklist

1. [ ] Check health status: `curl https://your-domain.com/health` returns `200 OK`
2. [ ] Visit homepage `https://your-domain.com` and verify listings load
3. [ ] Register a new guest user at `/register`
4. [ ] Log in as Admin at `/login` and access `/admin`
5. [ ] Open a property details page and verify Mapbox map loads
6. [ ] Initiate a booking and test Razorpay Checkout modal
7. [ ] Verify SSL certificate and HTTPS secure session cookies

---

## 7. Rollback Procedure

1. **Render / Railway / Cloud Provider:**
   Navigate to Deployment History &rarr; Select previous healthy build &rarr; Click **Rollback to this revision**.
2. **Docker / Git:**
   ```bash
   git checkout <previous-stable-tag>
   npm install --omit=dev
   npm test
   npm start
   ```
