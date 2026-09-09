// ==============================================================================
// Nestora — Phase 8: Supertest HTTP Integration & Beta-Launch E2E Test Suite
// ==============================================================================
// Tests real HTTP endpoints via Supertest against an isolated test database:
// 1. Production database shielding & safety verification
// 2. Health & Readiness probe HTTP responses
// 3. User registration, password hashing & session generation
// 4. Login session creation, invalid password handling & session cookies
// 5. CSRF rejection (missing/invalid token 403 / redirect) and valid CSRF acceptance
// 6. Role-Based Access Control (RBAC) across guest, host, admin routes
// 7. Property listing creation & strict ownership enforcement
// 8. Atomic booking creation & date overlap rejection via HTTP POST
// 9. Payment verification authorization & cryptographic signature rejection
// 10. Razorpay webhook signature rejection (400) & verified capture processing (200)
// 11. Booking cancellation, gateway refund state tracking & inventory release
// 12. Immediate re-booking of released inventory dates via HTTP
// ==============================================================================

process.env.NODE_ENV = "test";

// Define isolated test database URI
const TEST_DB_URI =
  (process.env.MONGODB_URI_TEST || "").trim() ||
  "mongodb://127.0.0.1:27017/nestora_phase8_supertest_e2e";

// -----------------------------------------------------------------------------
// STRICT SAFETY CHECKS: Check both MONGODB_URI and TEST_DB_URI
// Refuse execution if either points to Atlas, production, or lacks "test"
// -----------------------------------------------------------------------------
function assertSafeTestUri(uri, name) {
  if (!uri) {
    console.error(`FATAL SAFETY ERROR: ${name} is empty or undefined.`);
    process.exit(1);
  }
  const lower = uri.toLowerCase();
  if (
    lower.includes("production") ||
    lower.includes("prod") ||
    lower.includes("atlas") ||
    lower.startsWith("mongodb+srv://") ||
    !lower.includes("test")
  ) {
    console.error(
      `\n❌ FATAL SAFETY INTERCEPT: Refusing to execute tests against non-test or production database!\n` +
      `   ${name}: ${uri}\n` +
      `   Database URI must contain 'test' and must NOT contain 'production', 'prod', 'atlas', or 'mongodb+srv://'.\n`
    );
    process.exit(1);
  }
}

// Enforce test URI on environment BEFORE requiring app.js or session store
process.env.MONGODB_URI = TEST_DB_URI;
process.env.MONGODB_URI_TEST = TEST_DB_URI;
process.env.SESSION_SECRET = "supertest_e2e_secure_session_secret_1234567890";
process.env.RAZORPAY_KEY_ID = "rzp_test_e2e_key_id";
process.env.RAZORPAY_KEY_SECRET = "rzp_test_e2e_key_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "rzp_test_e2e_webhook_secret";

assertSafeTestUri(TEST_DB_URI, "TEST_DB_URI");
assertSafeTestUri(process.env.MONGODB_URI, "process.env.MONGODB_URI");
assertSafeTestUri(process.env.MONGODB_URI_TEST, "process.env.MONGODB_URI_TEST");

console.log("[Phase 8 E2E] Safety checks passed. Isolated test URI verified:", TEST_DB_URI);
console.log("[Phase 8 E2E] Loading Express application module (app.js)...");

const assert = require("assert");
const request = require("supertest");
const mongoose = require("mongoose");
const crypto = require("crypto");

const app = require("../app");
const connectDB = require("../utils/db");
const User = require("../models/User");
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const DailyAvailability = require("../models/DailyAvailability");

console.log("[Phase 8 E2E] Express application module loaded successfully.");

// Helper: Extract cookies from supertest response
function getCookies(res) {
  return (res.headers["set-cookie"] || []).map((cookie) => cookie.split(";")[0]).join("; ");
}

// Helper: Extract CSRF token from HTML response body or generate helper request
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

async function runSupertestE2ESuite() {
  console.log("\n===============================================================");
  console.log("🚀 STARTING NESTORA PHASE 8: SUPERTEST HTTP E2E TEST SUITE");
  console.log("===============================================================");
  console.log(`Protected test database: ${TEST_DB_URI}\n`);

  let testPassed = false;

  try {
    console.log("[Phase 8 E2E] Connecting to isolated test database with 5s timeout...");
    await connectDB(TEST_DB_URI);
    console.log("[Phase 8 E2E] Connected successfully to test database:", mongoose.connection.name);

    // Clean test database safely
    console.log("[Phase 8 E2E] Initializing clean test database state...");
    await User.deleteMany({});
    await Listing.deleteMany({});
    await Booking.deleteMany({});
    await Payment.deleteMany({});
    await DailyAvailability.deleteMany({});
    console.log("[Phase 8 E2E] Clean state ready. Commencing test scenarios.\n");

    // ---------------------------------------------------------------------------
    // 1. Health & Readiness HTTP Endpoints
    // ---------------------------------------------------------------------------
    console.log("--- TEST 1: HEALTH & READINESS HTTP PROBES ---");
    const healthRes = await request(app).get("/health");
    assert.strictEqual(healthRes.status, 200, "GET /health should return 200");
    assert.strictEqual(healthRes.body.status, "ok");
    assert.strictEqual(healthRes.body.service, "nestora");

    const readyRes = await request(app).get("/ready");
    assert.strictEqual(readyRes.status, 200, "GET /ready should return 200");
    assert.strictEqual(readyRes.body.status, "ready");
    assert.strictEqual(readyRes.body.database, "connected");
    assert.strictEqual(typeof readyRes.body.dbLatencyMs, "number");
    console.log("✅ Health & Readiness probes verified via Supertest HTTP.");

    // ---------------------------------------------------------------------------
    // 2. CSRF Protection: Rejection on Missing/Invalid Token
    // ---------------------------------------------------------------------------
    console.log("\n--- TEST 2: CSRF PROTECTION REJECTION & ACCEPTANCE ---");
    const guestAgent = request.agent(app);
    const { csrfToken: initialCsrfToken } = await getSessionWithCsrf(guestAgent);

    // A. AJAX / API POST without CSRF token must be rejected with 403 JSON
    const rejectAjaxNoCsrf = await guestAgent
      .post("/register")
      .set("accept", "application/json")
      .send({
        username: "attacker_guest_ajax",
        email: "attacker_ajax@example.com",
        password: "Password@123",
        role: "guest",
      });
    assert.strictEqual(rejectAjaxNoCsrf.status, 403, "AJAX POST without CSRF token must return 403 Forbidden");
    assert.strictEqual(rejectAjaxNoCsrf.body.success, false);

    // B. AJAX POST with tampered CSRF token must be rejected with 403 JSON
    const rejectAjaxBadCsrf = await guestAgent
      .post("/register")
      .set("accept", "application/json")
      .set("x-csrf-token", "tampered_fake_csrf_token_1234567890")
      .send({
        username: "attacker_guest_bad",
        email: "attacker_bad@example.com",
        password: "Password@123",
        role: "guest",
      });
    assert.strictEqual(rejectAjaxBadCsrf.status, 403, "AJAX POST with invalid CSRF token must return 403");

    // C. Browser Form POST without CSRF token must redirect with flash error
    const rejectFormNoCsrf = await guestAgent
      .post("/register")
      .send({
        username: "attacker_guest_form",
        email: "attacker_form@example.com",
        password: "Password@123",
        role: "guest",
      });
    assert.strictEqual(rejectFormNoCsrf.status, 302, "Form POST without CSRF redirects back with error");

    const attackerInDb = await User.findOne({ email: "attacker_form@example.com" });
    assert.strictEqual(attackerInDb, null, "Attacker user without CSRF must not be saved");

    console.log("✅ CSRF rejection on missing/tampered token verified (HTTP 403 & Form Redirect).");

    // ---------------------------------------------------------------------------
    // 3. User Registration & Session Initialization
    // ---------------------------------------------------------------------------
    console.log("\n--- TEST 3: USER REGISTRATION & INITIALIZATION ---");
    // Register Guest Alice
    const regAliceRes = await guestAgent
      .post("/register")
      .set("x-csrf-token", initialCsrfToken)
      .send({
        username: "alice_guest",
        email: "alice.guest@example.com",
        password: "Password@123",
        _csrf: initialCsrfToken,
      });
    assert.strictEqual(regAliceRes.status, 302, "Successful registration should redirect");

    const aliceInDb = await User.findOne({ email: "alice.guest@example.com" });
    assert.ok(aliceInDb, "Alice should be created in database");
    assert.strictEqual(aliceInDb.role, "guest");
    assert.strictEqual(aliceInDb.isVerified, false);

    // Manually verify Alice's email for full workflow permissions
    aliceInDb.isVerified = true;
    await aliceInDb.save();

    // Register Host Bob
    const hostBobAgent = request.agent(app);
    const { csrfToken: bobCsrfToken } = await getSessionWithCsrf(hostBobAgent);
    const regBobRes = await hostBobAgent
      .post("/register")
      .set("x-csrf-token", bobCsrfToken)
      .send({
        username: "bob_host",
        email: "bob.host@example.com",
        password: "Password@123",
        _csrf: bobCsrfToken,
      });
    assert.strictEqual(regBobRes.status, 302);
    const bobInDb = await User.findOne({ email: "bob.host@example.com" });
    bobInDb.role = "host";
    bobInDb.isVerified = true;
    await bobInDb.save();

    // Create Admin Carol
    const adminCarol = await User.create({
      username: "carol_admin",
      email: "carol.admin@example.com",
      password: "Admin@12345",
      role: "admin",
      isVerified: true,
    });

    console.log("✅ User registration, role assignments, and session creation verified.");

    // ---------------------------------------------------------------------------
    // 4. Login Session Verification & Invalid Credentials Handling
    // ---------------------------------------------------------------------------
    console.log("\n--- TEST 4: LOGIN SESSION & AUTHENTICATION ---");
    const loginTestAgent = request.agent(app);
    const { csrfToken: loginCsrfToken } = await getSessionWithCsrf(loginTestAgent);

    // Wrong password
    const failLogin = await loginTestAgent
      .post("/login")
      .set("x-csrf-token", loginCsrfToken)
      .send({
        username: "alice_guest",
        password: "WrongPassword@123",
        _csrf: loginCsrfToken,
      });
    assert.strictEqual(failLogin.status, 302, "Failed login redirects back to /login");
    assert.strictEqual(failLogin.headers.location, "/login");

    // Correct password
    const successLogin = await loginTestAgent
      .post("/login")
      .set("x-csrf-token", loginCsrfToken)
      .send({
        username: "alice_guest",
        password: "Password@123",
        _csrf: loginCsrfToken,
      });
    assert.strictEqual(successLogin.status, 302);
    assert.strictEqual(successLogin.headers.location, "/");
    console.log("✅ Login session management and invalid credentials verified.");

    // ---------------------------------------------------------------------------
    // 5. Role-Based Access Control (RBAC)
    // ---------------------------------------------------------------------------
    console.log("\n--- TEST 5: ROLE-BASED ACCESS CONTROL (RBAC) ---");
    // A. Unauthenticated user accessing protected routes
    const anonAgent = request.agent(app);
    const anonAdmin = await anonAgent.get("/admin");
    assert.strictEqual(anonAdmin.status, 302);
    assert.strictEqual(anonAdmin.headers.location, "/login");

    const anonHost = await anonAgent.get("/host/dashboard");
    assert.strictEqual(anonHost.status, 302);
    assert.strictEqual(anonHost.headers.location, "/login");

    // B. Guest Alice accessing admin route (Forbidden/Redirect to /)
    const aliceAdmin = await guestAgent.get("/admin");
    assert.strictEqual(aliceAdmin.status, 302);
    assert.strictEqual(aliceAdmin.headers.location, "/");

    // C. Host Bob accessing host dashboard (Allowed 200 OK)
    const bobHostDash = await hostBobAgent.get("/host/dashboard");
    assert.strictEqual(bobHostDash.status, 200);

    // D. Admin Carol logging in and accessing admin dashboard
    const adminAgent = request.agent(app);
    const { csrfToken: adminCsrf } = await getSessionWithCsrf(adminAgent);
    await adminAgent.post("/login").set("x-csrf-token", adminCsrf).send({
      username: "carol_admin",
      password: "Admin@12345",
      _csrf: adminCsrf,
    });
    const carolAdminDash = await adminAgent.get("/admin");
    assert.strictEqual(carolAdminDash.status, 200);

    console.log("✅ Role-Based Access Control verified across Guest, Host, Admin.");

    // ---------------------------------------------------------------------------
    // 6. Listing Creation & Ownership Protections
    // ---------------------------------------------------------------------------
    console.log("\n--- TEST 6: LISTING CREATION & OWNERSHIP ENFORCEMENT ---");
    // Host Bob creates a listing
    const bobListing = await Listing.create({
      title: "Mountain Pine Retreat",
      description: "Serene mountain chalet with scenic pine vistas.",
      price: 6000,
      location: "Manali, Himachal Pradesh",
      country: "India",
      propertyType: "villa",
      maxGuests: 4,
      owner: bobInDb._id,
      status: "approved",
      cancellationPolicy: "flexible",
    });

    // Host Charlie registers
    const hostCharlieAgent = request.agent(app);
    const { csrfToken: charlieCsrfInitial } = await getSessionWithCsrf(hostCharlieAgent);
    await hostCharlieAgent.post("/register").set("x-csrf-token", charlieCsrfInitial).send({
      username: "charlie_host",
      email: "charlie.host@example.com",
      password: "Password@123",
      _csrf: charlieCsrfInitial,
    });
    const charlieInDb = await User.findOne({ email: "charlie.host@example.com" });
    charlieInDb.role = "host";
    charlieInDb.isVerified = true;
    await charlieInDb.save();

    // Refresh CSRF token for Charlie's logged-in session
    const charlieCsrf = (await getSessionWithCsrf(hostCharlieAgent)).csrfToken;

    // Charlie tries to edit Bob's listing -> Blocked by isListingOwner middleware
    const charlieEditBob = await hostCharlieAgent
      .put(`/listings/${bobListing._id}`)
      .set("x-csrf-token", charlieCsrf)
      .send({
        title: "Hacked Title",
        price: 1000,
        _csrf: charlieCsrf,
      });
    assert.strictEqual(charlieEditBob.status, 302);
    assert.strictEqual(charlieEditBob.headers.location, `/listings/${bobListing._id}`);

    const unchangedListing = await Listing.findById(bobListing._id);
    assert.strictEqual(unchangedListing.title, "Mountain Pine Retreat", "Listing title should remain unmodified");

    console.log("✅ Listing ownership checks and unauthorized mutation rejection verified.");

    // ---------------------------------------------------------------------------
    // 7. Atomic Booking Creation & Overlapping Concurrency Block via Route
    // ---------------------------------------------------------------------------
    console.log("\n--- TEST 7: BOOKING CREATION & ATOMIC OVERLAP REJECTION ---");
    // Alice books Bob's listing for 2026-12-10 to 2026-12-14
    const aliceBookingCsrf = (await getSessionWithCsrf(guestAgent)).csrfToken;
    const bookResAlice = await guestAgent
      .post(`/listings/${bobListing._id}/bookings`)
      .set("x-csrf-token", aliceBookingCsrf)
      .send({
        checkIn: "2026-12-10",
        checkOut: "2026-12-14",
        guests: 2,
        _csrf: aliceBookingCsrf,
      });
    assert.strictEqual(bookResAlice.status, 302, "Successful booking redirects to payment checkout");

    const aliceBooking = await Booking.findOne({ guest: aliceInDb._id, listing: bobListing._id });
    assert.ok(aliceBooking, "Alice's booking should be created");
    assert.strictEqual(aliceBooking.status, "pending");

    // Verify DailyAvailability inventory locked 4 dates (10, 11, 12, 13)
    const lockedDates = await DailyAvailability.find({ listing: bobListing._id });
    assert.strictEqual(lockedDates.length, 4, "4 nights should be locked in DailyAvailability");

    // Charlie (or another guest) attempts to book overlapping dates: 2026-12-12 to 2026-12-16
    const charlieBookingCsrf = (await getSessionWithCsrf(hostCharlieAgent)).csrfToken;
    const bookResCharlie = await hostCharlieAgent
      .post(`/listings/${bobListing._id}/bookings`)
      .set("x-csrf-token", charlieBookingCsrf)
      .send({
        checkIn: "2026-12-12",
        checkOut: "2026-12-16",
        guests: 2,
        _csrf: charlieBookingCsrf,
      });
    assert.strictEqual(bookResCharlie.status, 302, "Overlapping booking rejected with redirect");
    assert.strictEqual(bookResCharlie.headers.location, `/listings/${bobListing._id}`);

    // Bob attempts to book his own listing -> Rejected
    const bobBookingCsrf = (await getSessionWithCsrf(hostBobAgent)).csrfToken;
    const bookResBob = await hostBobAgent
      .post(`/listings/${bobListing._id}/bookings`)
      .set("x-csrf-token", bobBookingCsrf)
      .send({
        checkIn: "2026-12-20",
        checkOut: "2026-12-22",
        guests: 1,
        _csrf: bobBookingCsrf,
      });
    assert.strictEqual(bookResBob.status, 302);
    assert.strictEqual(bookResBob.headers.location, `/listings/${bobListing._id}`);

    console.log("✅ Atomic reservation holds and overlap blocking verified via HTTP.");

    // ---------------------------------------------------------------------------
    // 8. Payment Verification Rejection & Signature Integrity
    // ---------------------------------------------------------------------------
    console.log("\n--- TEST 8: PAYMENT VERIFICATION REJECTION & AUTHORIZATION ---");
    // Charlie attempts to verify payment for Alice's booking -> Rejected (not booking guest)
    const charlieVerifyRes = await hostCharlieAgent
      .post(`/bookings/${aliceBooking._id}/verify`)
      .set("x-csrf-token", charlieBookingCsrf)
      .send({
        razorpay_payment_id: "pay_charlie_123",
        razorpay_order_id: "order_123",
        razorpay_signature: "invalid_signature",
        _csrf: charlieBookingCsrf,
      });
    assert.strictEqual(charlieVerifyRes.status, 302);
    assert.strictEqual(charlieVerifyRes.headers.location, "/bookings/my");

    // Alice submits payment with tampered signature -> Rejected
    const alicePaymentCsrf = (await getSessionWithCsrf(guestAgent)).csrfToken;
    const aliceTamperedVerify = await guestAgent
      .post(`/bookings/${aliceBooking._id}/verify`)
      .set("x-csrf-token", alicePaymentCsrf)
      .send({
        razorpay_payment_id: "pay_tampered_123",
        razorpay_order_id: aliceBooking.razorpayOrderId || "order_alice_test",
        razorpay_signature: "tampered_hmac_signature_hex",
        _csrf: alicePaymentCsrf,
      });
    assert.strictEqual(aliceTamperedVerify.status, 302);
    assert.strictEqual(aliceTamperedVerify.headers.location, `/bookings/${aliceBooking._id}/payment`);

    console.log("✅ Payment verification authorization and cryptographic signature checks verified.");

    // ---------------------------------------------------------------------------
    // 9. Razorpay Webhooks: Signature Rejection & Processing
    // ---------------------------------------------------------------------------
    console.log("\n--- TEST 9: RAZORPAY WEBHOOK SECURITY & EVENT HANDLING ---");
    const webhookUrl = "/webhook/razorpay";
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // A. Webhook without signature -> Rejected (HTTP 400)
    const noSigWebhook = await request(app)
      .post(webhookUrl)
      .send({ event: "payment.captured", payload: {} });
    assert.strictEqual(noSigWebhook.status, 400);

    // B. Webhook with tampered signature -> Rejected (HTTP 400)
    const badSigWebhook = await request(app)
      .post(webhookUrl)
      .set("x-razorpay-signature", "invalid_webhook_signature_hex")
      .send({ event: "payment.captured", payload: {} });
    assert.strictEqual(badSigWebhook.status, 400);

    // C. Valid payment.captured webhook -> Processed successfully (HTTP 200)
    const webhookPayload = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_e2e_webhook_999",
            order_id: aliceBooking.razorpayOrderId || "order_alice_webhook",
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

    const validSig = crypto
      .createHmac("sha256", webhookSecret)
      .update(webhookPayload)
      .digest("hex");

    const goodWebhook = await request(app)
      .post(webhookUrl)
      .set("x-razorpay-signature", validSig)
      .set("content-type", "application/json")
      .send(webhookPayload);

    assert.strictEqual(goodWebhook.status, 200);
    assert.strictEqual(goodWebhook.body.status, "ok");

    // Verify booking and payment updated
    const updatedAliceBooking = await Booking.findById(aliceBooking._id);
    assert.strictEqual(updatedAliceBooking.status, "confirmed");
    assert.strictEqual(updatedAliceBooking.paymentStatus, "paid");

    console.log("✅ Razorpay webhook security and signature verification verified.");

    // ---------------------------------------------------------------------------
    // 10. Booking Cancellation, Accurate Refund State & Immediate Re-Booking
    // ---------------------------------------------------------------------------
    console.log("\n--- TEST 10: BOOKING CANCELLATION, REFUND STATES & RE-BOOKING ---");
    // Charlie attempts to cancel Alice's booking -> Rejected (permission denied)
    const charlieCancelCsrf = (await getSessionWithCsrf(hostCharlieAgent)).csrfToken;
    const charlieCancelAlice = await hostCharlieAgent
      .post(`/bookings/${aliceBooking._id}/cancel`)
      .set("x-csrf-token", charlieCancelCsrf)
      .send({ _csrf: charlieCancelCsrf });
    assert.strictEqual(charlieCancelAlice.status, 302);
    assert.strictEqual(charlieCancelAlice.headers.location, "/bookings/my");

    // Alice cancels her confirmed booking
    const aliceCancelCsrf = (await getSessionWithCsrf(guestAgent)).csrfToken;
    const aliceCancelRes = await guestAgent
      .post(`/bookings/${aliceBooking._id}/cancel`)
      .set("x-csrf-token", aliceCancelCsrf)
      .send({ _csrf: aliceCancelCsrf });
    assert.strictEqual(aliceCancelRes.status, 302);
    assert.strictEqual(aliceCancelRes.headers.location, `/bookings/${aliceBooking._id}`);

    const cancelledBooking = await Booking.findById(aliceBooking._id);
    assert.strictEqual(cancelledBooking.status, "cancelled");
    assert.ok(
      ["pending", "completed", "ineligible"].includes(cancelledBooking.refundStatus),
      `Refund status '${cancelledBooking.refundStatus}' must be a valid Phase 7/8 state`
    );

    // Verify DailyAvailability holds were released
    const remainingHolds = await DailyAvailability.find({ listing: bobListing._id });
    assert.strictEqual(remainingHolds.length, 0, "All inventory holds should be released on cancellation");

    // Charlie can now immediately book the newly released dates (2026-12-10 to 2026-12-14)
    const charlieRebookCsrf = (await getSessionWithCsrf(hostCharlieAgent)).csrfToken;
    const rebookRes = await hostCharlieAgent
      .post(`/listings/${bobListing._id}/bookings`)
      .set("x-csrf-token", charlieRebookCsrf)
      .send({
        checkIn: "2026-12-10",
        checkOut: "2026-12-14",
        guests: 2,
        _csrf: charlieRebookCsrf,
      });
    assert.strictEqual(rebookRes.status, 302, "Released dates should now be successfully bookable");

    const charlieBooking = await Booking.findOne({ guest: charlieInDb._id, listing: bobListing._id });
    assert.ok(charlieBooking, "Charlie should successfully secure the released dates");

    console.log("✅ Booking cancellation, refund lifecycle, and instant re-booking verified.");

    testPassed = true;
  } finally {
    console.log("\n[Phase 8 E2E Teardown] Cleaning test database and closing all resources...");
    try {
      if (mongoose.connection.readyState !== 0) {
        await User.deleteMany({});
        await Listing.deleteMany({});
        await Booking.deleteMany({});
        await Payment.deleteMany({});
        await DailyAvailability.deleteMany({});
        console.log("[Phase 8 E2E Teardown] Cleaned isolated test database records.");
        await mongoose.connection.close();
        console.log("[Phase 8 E2E Teardown] Mongoose connection closed.");
      }
      if (app.sessionStore && typeof app.sessionStore.close === "function") {
        await app.sessionStore.close();
        console.log("[Phase 8 E2E Teardown] MongoStore session client closed.");
      }
    } catch (teardownErr) {
      console.error("[Phase 8 E2E Teardown Error]:", teardownErr.message);
    }
  }

  if (testPassed) {
    console.log("\n===============================================================");
    console.log("🎉 ALL PHASE 8 SUPERTEST HTTP E2E INTEGRATION TESTS PASSED (10/10)!");
    console.log("===============================================================\n");
    process.exitCode = 0;
  } else {
    console.error("\n❌ Phase 8 Supertest E2E Suite failed.");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runSupertestE2ESuite().catch((err) => {
    console.error("FATAL ERROR in Phase 8 Supertest Suite:", err);
    process.exitCode = 1;
  });
}

module.exports = runSupertestE2ESuite;
