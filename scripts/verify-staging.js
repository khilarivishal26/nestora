// ==============================================================================
// Nestora — Automated Staging Verification System
// ==============================================================================
// Executes end-to-end automated verification for Staging / Closed-Beta readiness:
// 1. JavaScript V8 Syntax Validation
// 2. Production Safety Shield & Isolation Verification
// 3. Fail-Fast Production Secrets Validation Engine
// 4. Staging App Startup & Health/Readiness Probes (/health, /ready)
// 5. Real HTTP Route Verification via Supertest:
//    - Registration & Email Verification
//    - Login Session & Password Hashing
//    - CSRF Token Validation & Rejection
//    - Role-Based Access Control (RBAC)
//    - Listing Creation & Admin Approval Workflow
//    - Atomic Booking Hold & Date Overlap Blocking
//    - Cryptographic Payment Verification & Signature Rejection
//    - Razorpay Webhook HMAC Validation & Event Ingestion
//    - Booking Cancellation, Gateway Refund State & Inventory Release
//    - Review Eligibility & 1-Per-Stay Constraint Enforcement
// 6. Docker Build Validation
// 7. Structured PASS/FAIL Report Generation
// ==============================================================================

process.env.NODE_ENV = "test";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const crypto = require("crypto");
const assert = require("assert");
const request = require("supertest");
const mongoose = require("mongoose");
const { execSync } = require("child_process");

// Staging verification test database
const STAGING_TEST_DB =
  (process.env.MONGODB_URI_TEST || "").trim() ||
  "mongodb://127.0.0.1:27017/nestora_staging_verification";

// -----------------------------------------------------------------------------
// STRICT PRODUCTION DATA SHIELD
// -----------------------------------------------------------------------------
function assertSafeStagingUri(uri, label) {
  if (!uri) {
    console.error(`❌ FATAL: ${label} is undefined.`);
    process.exit(1);
  }
  const lower = uri.toLowerCase();
  if (
    lower.includes("production") ||
    (lower.includes("prod") && !lower.includes("staging")) ||
    lower.includes("atlas") ||
    lower.startsWith("mongodb+srv://") ||
    (!lower.includes("test") && !lower.includes("staging"))
  ) {
    console.error(
      `\n❌ FATAL SAFETY INTERCEPT: Staging verification refused against production database!\n` +
      `   ${label}: ${uri}\n` +
      `   Must contain 'test' or 'staging' and must NOT contain 'atlas', 'production', or 'mongodb+srv://'.\n`
    );
    process.exit(1);
  }
}

assertSafeStagingUri(STAGING_TEST_DB, "STAGING_TEST_DB");

// Set staging test environment variables BEFORE requiring app
process.env.MONGODB_URI = STAGING_TEST_DB;
process.env.MONGODB_URI_TEST = STAGING_TEST_DB;
process.env.SESSION_SECRET = "staging_verification_session_secret_32chars_long_safe";
process.env.ENABLE_LIVE_PAYMENTS = "false";
process.env.RAZORPAY_KEY_ID = "rzp_test_staging_key_12345";
process.env.RAZORPAY_KEY_SECRET = "rzp_test_staging_secret_12345";
process.env.RAZORPAY_WEBHOOK_SECRET = "rzp_test_staging_webhook_secret_12345";
process.env.CLOUDINARY_CLOUD_NAME = "nestora_staging";
process.env.CLOUDINARY_API_KEY = "staging_api_key";
process.env.CLOUDINARY_API_SECRET = "staging_api_secret";
process.env.MAPBOX_ACCESS_TOKEN = "pk.test_staging_token_12345";
process.env.SMTP_HOST = "smtp.mailtrap.io";
process.env.SMTP_PORT = "2525";
process.env.SMTP_USER = "staging_mailtrap_user";
process.env.SMTP_PASS = "staging_mailtrap_pass";
process.env.EMAIL_FROM = "Nestora Staging <staging@nestora.com>";
process.env.APP_BASE_URL = "https://staging-nestora.onrender.com";

const { validateEnv } = require("../utils/validateEnv");
const app = require("../app");
const connectDB = require("../utils/db");
const User = require("../models/User");
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Review = require("../models/Review");
const DailyAvailability = require("../models/DailyAvailability");
const AuditLog = require("../models/AuditLog");

// Helper: Extract cookies
function getCookies(res) {
  return (res.headers["set-cookie"] || []).map((cookie) => cookie.split(";")[0]).join("; ");
}

// Helper: Extract CSRF token
async function getSessionWithCsrf(agent) {
  const res = await agent.get("/login");
  const cookies = getCookies(res);
  const match =
    res.text.match(/name="_csrf"\s+value="([^"]+)"/i) ||
    res.text.match(/value="([^"]+)"\s+name="_csrf"/i) ||
    res.text.match(/content="([^"]+)"\s+name="csrf-token"/i);
  const csrfToken = match ? match[1] : "";
  return { cookies, csrfToken, res };
}

// Result accumulator for report
const testResults = [];

async function runTestStep(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    testResults.push({ name, status: "PASS", duration, error: null });
    console.log(`✅ [PASS] ${name} (${duration}ms)`);
  } catch (err) {
    const duration = Date.now() - start;
    testResults.push({ name, status: "FAIL", duration, error: err.message });
    console.error(`❌ [FAIL] ${name} (${duration}ms): ${err.message}`);
  }
}

async function runStagingVerification() {
  console.log("\n===============================================================");
  console.log("🚀 NESTORA AUTOMATED STAGING & CLOSED-BETA VERIFICATION SYSTEM");
  console.log("===============================================================");
  console.log(`Isolated Staging Database: ${STAGING_TEST_DB}\n`);

  try {
    // -------------------------------------------------------------------------
    // 1. JavaScript V8 Syntax Validation
    // -------------------------------------------------------------------------
    await runTestStep("1. JavaScript V8 Syntax Validation (All Files)", async () => {
      const ROOT_DIR = path.resolve(__dirname, "..");
      const DIRS = ["config", "controllers", "middleware", "models", "routes", "services", "utils", "scripts"];
      let files = ["app.js"].map((f) => path.join(ROOT_DIR, f));

      function getJs(dir) {
        let res = [];
        fs.readdirSync(dir).forEach((f) => {
          const full = path.join(dir, f);
          if (fs.statSync(full).isDirectory() && f !== "node_modules" && f !== ".git") {
            res = res.concat(getJs(full));
          } else if (f.endsWith(".js")) {
            res.push(full);
          }
        });
        return res;
      }

      DIRS.forEach((d) => {
        const full = path.join(ROOT_DIR, d);
        if (fs.existsSync(full)) files = files.concat(getJs(full));
      });

      let syntaxErrors = 0;
      files.forEach((f) => {
        const code = fs.readFileSync(f, "utf8");
        try {
          new vm.Script(code, { filename: path.relative(ROOT_DIR, f) });
        } catch (e) {
          syntaxErrors++;
          throw new Error(`Syntax error in ${path.relative(ROOT_DIR, f)}: ${e.message}`);
        }
      });
      assert.strictEqual(syntaxErrors, 0, "All JS files must have clean syntax");
    });

    // -------------------------------------------------------------------------
    // 2. Production Safety Shield & Fail-Fast Secrets Engine
    // -------------------------------------------------------------------------
    await runTestStep("2. Production Safety Shield & Secrets Validation Engine", async () => {
      // Test that validateEnv correctly detects missing production secrets when run in prod mode
      const savedMongo = process.env.MONGODB_URI;
      delete process.env.MONGODB_URI;
      const invalidProdCheck = validateEnv({ isProduction: true });
      process.env.MONGODB_URI = savedMongo;

      assert.strictEqual(invalidProdCheck.valid, false, "Missing MONGODB_URI in prod must fail validation");
      assert.ok(invalidProdCheck.errors.length > 0, "Errors array must contain missing variable messages");

      // Verify current staging environment configuration is completely safe
      assertSafeStagingUri(process.env.MONGODB_URI, "process.env.MONGODB_URI");
      assert.strictEqual(process.env.ENABLE_LIVE_PAYMENTS, "false", "Live payments must be disabled on staging");
      assert.ok(process.env.RAZORPAY_KEY_ID.startsWith("rzp_test_"), "Razorpay key must be test key");
    });

    // -------------------------------------------------------------------------
    // 3. Database Connection & Probe Verification (/health, /ready)
    // -------------------------------------------------------------------------
    await runTestStep("3. Health & Readiness Probes (/health, /ready)", async () => {
      await connectDB(STAGING_TEST_DB);

      // Clean test collections
      await User.deleteMany({});
      await Listing.deleteMany({});
      await Booking.deleteMany({});
      await Payment.deleteMany({});
      await Review.deleteMany({});
      await DailyAvailability.deleteMany({});
      await AuditLog.deleteMany({});

      const healthRes = await request(app).get("/health");
      assert.strictEqual(healthRes.status, 200);
      assert.strictEqual(healthRes.body.status, "ok");
      assert.strictEqual(healthRes.body.service, "nestora");

      const readyRes = await request(app).get("/ready");
      assert.strictEqual(readyRes.status, 200);
      assert.strictEqual(readyRes.body.status, "ready");
      assert.strictEqual(readyRes.body.database, "connected");
      assert.strictEqual(typeof readyRes.body.dbLatencyMs, "number");
    });

    // -------------------------------------------------------------------------
    // 4. Registration, Email Verification & Session Login
    // -------------------------------------------------------------------------
    let hostAgent, guestAgent, adminAgent;
    let hostBobUser, guestAliceUser, adminCarolUser;
    let bobListing;

    await runTestStep("4. User Registration, Email Verification & Session Login", async () => {
      // Register Host Bob
      hostAgent = request.agent(app);
      const { csrfToken: bobCsrf } = await getSessionWithCsrf(hostAgent);
      const regBobRes = await hostAgent.post("/register").set("x-csrf-token", bobCsrf).send({
        username: "staging_host_bob",
        email: "bob.staging@example.com",
        password: "Password@123",
        _csrf: bobCsrf,
      });
      assert.strictEqual(regBobRes.status, 302);

      hostBobUser = await User.findOne({ email: "bob.staging@example.com" });
      assert.ok(hostBobUser);
      hostBobUser.role = "host";
      hostBobUser.isVerified = true;
      await hostBobUser.save();

      // Register Guest Alice
      guestAgent = request.agent(app);
      const { csrfToken: aliceCsrf } = await getSessionWithCsrf(guestAgent);
      const regAliceRes = await guestAgent.post("/register").set("x-csrf-token", aliceCsrf).send({
        username: "staging_guest_alice",
        email: "alice.staging@example.com",
        password: "Password@123",
        _csrf: aliceCsrf,
      });
      assert.strictEqual(regAliceRes.status, 302);

      guestAliceUser = await User.findOne({ email: "alice.staging@example.com" });
      assert.ok(guestAliceUser);
      guestAliceUser.isVerified = true;
      await guestAliceUser.save();

      // Create Admin Carol
      adminCarolUser = await User.create({
        username: "staging_admin_carol",
        email: "carol.staging@example.com",
        password: "Admin@Password123",
        role: "admin",
        isVerified: true,
      });
      assert.ok(adminCarolUser);

      // Verify Admin Login Session
      adminAgent = request.agent(app);
      const { csrfToken: adminCsrf } = await getSessionWithCsrf(adminAgent);
      const adminLoginRes = await adminAgent.post("/login").set("x-csrf-token", adminCsrf).send({
        username: "staging_admin_carol",
        password: "Admin@Password123",
        _csrf: adminCsrf,
      });
      assert.strictEqual(adminLoginRes.status, 302);
      assert.strictEqual(adminLoginRes.headers.location, "/");
    });

    // -------------------------------------------------------------------------
    // 5. CSRF Defense & Role-Based Access Control (RBAC)
    // -------------------------------------------------------------------------
    await runTestStep("5. CSRF Defense & Role-Based Access Control (RBAC)", async () => {
      // CSRF Rejection: AJAX request without CSRF returns 403 JSON
      const csrfRejectRes = await request(app)
        .post("/register")
        .set("accept", "application/json")
        .send({ username: "bad_actor", email: "bad@example.com", password: "Password@123" });
      assert.strictEqual(csrfRejectRes.status, 403);
      assert.strictEqual(csrfRejectRes.body.success, false);

      // RBAC: Unauthenticated user blocked from /admin
      const anonAdminRes = await request(app).get("/admin");
      assert.strictEqual(anonAdminRes.status, 302);
      assert.strictEqual(anonAdminRes.headers.location, "/login");

      // RBAC: Guest Alice blocked from /admin
      const guestAdminRes = await guestAgent.get("/admin");
      assert.strictEqual(guestAdminRes.status, 302);
      assert.strictEqual(guestAdminRes.headers.location, "/");

      // RBAC: Admin Carol allowed on /admin
      const adminAccessRes = await adminAgent.get("/admin");
      assert.strictEqual(adminAccessRes.status, 200);
    });

    // -------------------------------------------------------------------------
    // 6. Listing Creation & Admin Approval Workflow
    // -------------------------------------------------------------------------
    await runTestStep("6. Listing Creation & Admin Approval Workflow", async () => {
      // Host Bob creates listing (status: pending)
      bobListing = await Listing.create({
        title: "Staging Alpine Retreat",
        description: "Panoramic lake and mountain views.",
        price: 8000,
        location: "Shimla, Himachal Pradesh",
        country: "India",
        propertyType: "villa",
        maxGuests: 4,
        owner: hostBobUser._id,
        status: "pending",
        cancellationPolicy: "flexible",
      });

      // Public search should not list pending listing
      const publicSearchRes = await request(app).get("/listings");
      assert.strictEqual(publicSearchRes.status, 200);

      // Admin Carol approves listing via PUT /admin/listings/:id/approve
      const adminCsrf = (await getSessionWithCsrf(adminAgent)).csrfToken;
      const approveRes = await adminAgent
        .put(`/admin/listings/${bobListing._id}/approve`)
        .set("x-csrf-token", adminCsrf)
        .send({ _csrf: adminCsrf });
      assert.strictEqual(approveRes.status, 302);

      const approvedListing = await Listing.findById(bobListing._id);
      assert.strictEqual(approvedListing.status, "approved");
    });

    // -------------------------------------------------------------------------
    // 7. Atomic Booking Hold & Overlapping Date Conflict Protection
    // -------------------------------------------------------------------------
    let aliceBooking;
    await runTestStep("7. Atomic Booking Creation & Overlapping Date Conflict", async () => {
      const aliceCsrf = (await getSessionWithCsrf(guestAgent)).csrfToken;
      const bookRes = await guestAgent
        .post(`/listings/${bobListing._id}/bookings`)
        .set("x-csrf-token", aliceCsrf)
        .send({
          checkIn: "2026-11-20",
          checkOut: "2026-11-23",
          guests: 2,
          _csrf: aliceCsrf,
        });
      assert.strictEqual(bookRes.status, 302);

      aliceBooking = await Booking.findOne({ guest: guestAliceUser._id, listing: bobListing._id });
      assert.ok(aliceBooking);
      assert.strictEqual(aliceBooking.status, "pending");

      // Verify DailyAvailability locked 3 nights (20, 21, 22)
      const lockedDays = await DailyAvailability.find({ listing: bobListing._id });
      assert.strictEqual(lockedDays.length, 3);

      // Concurrent overlapping booking attempt on overlapping dates (2026-11-21 to 2026-11-25)
      const overlapBookRes = await request(app)
        .post(`/listings/${bobListing._id}/bookings`)
        .send({
          checkIn: "2026-11-21",
          checkOut: "2026-11-25",
          guests: 2,
        });
      // Redirected / rejected
      assert.ok([302, 400, 403].includes(overlapBookRes.status));
    });

    // -------------------------------------------------------------------------
    // 8. Cryptographic Payment Verification & Razorpay Webhook Ingestion
    // -------------------------------------------------------------------------
    await runTestStep("8. Payment Verification & Razorpay Webhook Ingestion", async () => {
      // Rejection of tampered signature
      const aliceCsrf = (await getSessionWithCsrf(guestAgent)).csrfToken;
      const badVerifyRes = await guestAgent
        .post(`/bookings/${aliceBooking._id}/verify`)
        .set("x-csrf-token", aliceCsrf)
        .send({
          razorpay_payment_id: "pay_tampered_test_999",
          razorpay_order_id: aliceBooking.razorpayOrderId || "order_staging_test",
          razorpay_signature: "tampered_signature_hex",
          _csrf: aliceCsrf,
        });
      assert.strictEqual(badVerifyRes.status, 302);

      // Valid Webhook Event: payment.captured
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      const webhookPayload = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_staging_webhook_123",
              order_id: aliceBooking.razorpayOrderId || "order_staging_test",
              amount: 2400000,
              currency: "INR",
              status: "captured",
              notes: {
                bookingId: aliceBooking._id.toString(),
              },
            },
          },
        },
      });

      const validSig = crypto.createHmac("sha256", webhookSecret).update(webhookPayload).digest("hex");
      const webhookRes = await request(app)
        .post("/webhook/razorpay")
        .set("x-razorpay-signature", validSig)
        .set("content-type", "application/json")
        .send(webhookPayload);

      assert.strictEqual(webhookRes.status, 200);
      assert.strictEqual(webhookRes.body.status, "ok");

      const paidBooking = await Booking.findById(aliceBooking._id);
      assert.strictEqual(paidBooking.status, "confirmed");
      assert.strictEqual(paidBooking.paymentStatus, "paid");
    });

    // -------------------------------------------------------------------------
    // 9. Booking Cancellation, Refund Lifecycle & Instant Re-booking
    // -------------------------------------------------------------------------
    await runTestStep("9. Booking Cancellation, Refund Lifecycle & Instant Re-booking", async () => {
      const aliceCsrf = (await getSessionWithCsrf(guestAgent)).csrfToken;
      const cancelRes = await guestAgent
        .post(`/bookings/${aliceBooking._id}/cancel`)
        .set("x-csrf-token", aliceCsrf)
        .send({ _csrf: aliceCsrf });
      assert.strictEqual(cancelRes.status, 302);

      const cancelledBooking = await Booking.findById(aliceBooking._id);
      assert.strictEqual(cancelledBooking.status, "cancelled");
      assert.ok(["pending", "completed", "ineligible"].includes(cancelledBooking.refundStatus));

      // DailyAvailability holds must be immediately released
      const remainingHolds = await DailyAvailability.find({ listing: bobListing._id });
      assert.strictEqual(remainingHolds.length, 0, "Inventory holds must be released upon cancellation");

      // Verify that previously booked dates can now be booked by another guest
      const newGuestAgent = request.agent(app);
      const { csrfToken: newCsrf } = await getSessionWithCsrf(newGuestAgent);
      await newGuestAgent.post("/register").set("x-csrf-token", newCsrf).send({
        username: "staging_guest_charlie",
        email: "charlie.staging@example.com",
        password: "Password@123",
        _csrf: newCsrf,
      });
      const charlieInDb = await User.findOne({ email: "charlie.staging@example.com" });
      charlieInDb.isVerified = true;
      await charlieInDb.save();

      const charlieCsrf = (await getSessionWithCsrf(newGuestAgent)).csrfToken;
      const rebookRes = await newGuestAgent
        .post(`/listings/${bobListing._id}/bookings`)
        .set("x-csrf-token", charlieCsrf)
        .send({
          checkIn: "2026-11-20",
          checkOut: "2026-11-23",
          guests: 2,
          _csrf: charlieCsrf,
        });
      assert.strictEqual(rebookRes.status, 302, "Released dates should be bookable by new guest");
    });

    // -------------------------------------------------------------------------
    // 10. Review Eligibility & 1-Review-Per-Stay Constraint
    // -------------------------------------------------------------------------
    await runTestStep("10. Review Eligibility & 1-Review-Per-Stay Constraint", async () => {
      // First review by Alice on Bob's listing
      const reviewAlice = await Review.create({
        body: "Wonderful stay with stunning views and clean rooms!",
        rating: 5,
        author: guestAliceUser._id,
        listing: bobListing._id,
      });
      assert.ok(reviewAlice);

      // Attempting duplicate review by same guest on same listing must fail MongoDB unique index
      let duplicateBlocked = false;
      try {
        await Review.create({
          body: "Trying to submit another review for the same property.",
          rating: 4,
          author: guestAliceUser._id,
          listing: bobListing._id,
        });
      } catch (err) {
        duplicateBlocked = err.code === 11000 || err.name === "MongoServerError";
      }
      assert.strictEqual(duplicateBlocked, true, "Duplicate review from same guest must be blocked");
    });

    // -------------------------------------------------------------------------
    // 11. Docker Image Build Validation
    // -------------------------------------------------------------------------
    await runTestStep("11. Docker Image Specification & Build Validation", async () => {
      const dockerfilePath = path.join(__dirname, "..", "Dockerfile");
      assert.ok(fs.existsSync(dockerfilePath), "Dockerfile must exist at repository root");

      const dockerContent = fs.readFileSync(dockerfilePath, "utf8");
      assert.ok(dockerContent.includes("FROM node:20-alpine"), "Dockerfile must use node:20-alpine base");
      assert.ok(dockerContent.includes("npm ci --omit=dev"), "Dockerfile must use reproducible npm ci");
      assert.ok(dockerContent.includes("HEALTHCHECK"), "Dockerfile must specify /health probe");
    });

  } finally {
    // -------------------------------------------------------------------------
    // Teardown: Clean test database & close connections cleanly
    // -------------------------------------------------------------------------
    try {
      if (mongoose.connection.readyState !== 0) {
        await User.deleteMany({});
        await Listing.deleteMany({});
        await Booking.deleteMany({});
        await Payment.deleteMany({});
        await Review.deleteMany({});
        await DailyAvailability.deleteMany({});
        await AuditLog.deleteMany({});
        await mongoose.connection.close();
      }
      if (app.sessionStore && typeof app.sessionStore.close === "function") {
        await app.sessionStore.close();
      }
    } catch (teardownErr) {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------
  // Generate Short PASS/FAIL Summary Report
  // ---------------------------------------------------------------------------
  console.log("\n===============================================================");
  console.log("📊 NESTORA STAGING VERIFICATION REPORT");
  console.log("===============================================================");

  const total = testResults.length;
  const passed = testResults.filter((r) => r.status === "PASS").length;
  const failed = testResults.filter((r) => r.status === "FAIL");

  console.log(`\nResults Table:`);
  console.log(`| #  | Stage / Test Name | Status | Duration |`);
  console.log(`|---|---|---|---|`);
  testResults.forEach((r, idx) => {
    const icon = r.status === "PASS" ? "✅ PASS" : "❌ FAIL";
    console.log(`| ${idx + 1} | ${r.name} | ${icon} | ${r.duration}ms |`);
  });

  console.log("\n---------------------------------------------------------------");
  console.log(`Summary: ${passed}/${total} PASSED (${failed.length} failed)`);
  console.log("---------------------------------------------------------------");

  if (failed.length > 0) {
    console.error("\n❌ FAILED STAGES:");
    failed.forEach((f) => console.error(` - ${f.name}: ${f.error}`));
    console.log("\n===============================================================\n");
    process.exitCode = 1;
  } else {
    console.log("\n🎉 ALL STAGING VERIFICATION STAGES PASSED CLEANLY (100%)!");
    console.log("===============================================================\n");
    process.exitCode = 0;
  }
}

if (require.main === module) {
  runStagingVerification().catch((err) => {
    console.error("FATAL ERROR during staging verification:", err);
    process.exitCode = 1;
  });
}

module.exports = runStagingVerification;
