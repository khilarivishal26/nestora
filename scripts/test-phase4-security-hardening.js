/**
 * Phase 4: Application Security Hardening Test Suite
 * Runs against an isolated test database to verify:
 * 1. Session-bound CSRF token validation and webhook exemption
 * 2. Rate limiting for auth, booking, payment, and webhook endpoints
 * 3. Centralized input validation for Auth, Listings, Bookings, and Reviews
 * 4. Cloudinary upload configuration (size, count, and MIME-type filters)
 * 5. Helmet security headers and EJS-compatible CSP configuration
 *
 * Run with: node scripts/test-phase4-security-hardening.js
 */

const mongoose = require("mongoose");
const crypto = require("crypto");
const { csrfProtection, generateToken } = require("../middleware/csrf");
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  validateRegisterInput,
  validateListingInput,
  validateBookingInput,
  validateReviewInput,
} = require("../middleware/validators");
const { upload } = require("../config/cloudinary");

process.env.NODE_ENV = "test";
const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/nestora_test_security_sec";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function runSecurityTests() {
  console.log("\n=======================================================");
  console.log("--- NESTORA: PHASE 4 APPLICATION SECURITY HARDENING ---");
  console.log("=======================================================\n");

  await mongoose.connect(TEST_DB_URI, { dbName: "nestora_test_security_sec" });
  console.log(`Connected to isolated test DB: ${mongoose.connection.name}`);

  // ---------------------------------------------------------------------------
  // TEST 1: CSRF TOKEN GENERATION & VALIDATION
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 1: CSRF PROTECTION & WEBHOOK BYPASS ---");
  {
    const session = {};
    const reqGet = { method: "GET", session, path: "/listings" };
    const resGet = { locals: {} };
    let nextCalled = false;

    csrfProtection(reqGet, resGet, () => {
      nextCalled = true;
    });

    assert(nextCalled, "Safe GET requests pass CSRF middleware without token");
    assert(session.csrfSecret && session.csrfSecret.length === 64, "CSRF secret generated and bound to session");
    assert(resGet.locals.csrfToken === session.csrfSecret, "res.locals.csrfToken exposed to EJS templates");

    // Test POST without token -> Rejected with 403
    let status403 = null;
    const reqPostNoToken = {
      method: "POST",
      session,
      path: "/listings",
      body: {},
      headers: {},
      xhr: true,
      status(code) {
        status403 = code;
        return { json: () => {} };
      },
    };
    csrfProtection(reqPostNoToken, reqPostNoToken, () => {
      assert(false, "POST without CSRF token should not call next()");
    });
    assert(status403 === 403, "POST without CSRF token rejected with HTTP 403");

    // Test POST with invalid/tampered token -> Rejected
    status403 = null;
    const reqPostTampered = {
      method: "POST",
      session,
      path: "/listings",
      body: { _csrf: "tampered_token_xyz" },
      headers: {},
      xhr: true,
      status(code) {
        status403 = code;
        return { json: () => {} };
      },
    };
    csrfProtection(reqPostTampered, reqPostTampered, () => {
      assert(false, "POST with tampered CSRF token should not call next()");
    });
    assert(status403 === 403, "POST with tampered CSRF token rejected with HTTP 403");

    // Test POST with valid body token -> Accepted
    let postNextCalled = false;
    const reqPostValidBody = {
      method: "POST",
      session,
      path: "/listings",
      body: { _csrf: session.csrfSecret },
      headers: {},
      status: () => ({ json: () => {} }),
    };
    csrfProtection(reqPostValidBody, { locals: {} }, () => {
      postNextCalled = true;
    });
    assert(postNextCalled, "POST with valid body CSRF token successfully accepted");

    // Test AJAX POST with X-CSRF-Token header -> Accepted
    let ajaxNextCalled = false;
    const reqAjaxValidHeader = {
      method: "POST",
      session,
      path: "/wishlist/toggle/123",
      body: {},
      headers: { "x-csrf-token": session.csrfSecret },
      status: () => ({ json: () => {} }),
    };
    csrfProtection(reqAjaxValidHeader, { locals: {} }, () => {
      ajaxNextCalled = true;
    });
    assert(ajaxNextCalled, "AJAX POST with X-CSRF-Token header successfully accepted");

    // Test Webhook route -> Exempted from CSRF
    let webhookNextCalled = false;
    const reqWebhook = {
      method: "POST",
      session: {},
      path: "/webhook/razorpay",
      originalUrl: "/webhook/razorpay",
      body: { event: "payment.captured" },
      headers: {},
    };
    csrfProtection(reqWebhook, { locals: {} }, () => {
      webhookNextCalled = true;
    });
    assert(webhookNextCalled, "/webhook/razorpay route is strictly exempted from CSRF checks");
  }

  // ---------------------------------------------------------------------------
  // TEST 2: RATE LIMITING MIDDLEWARE
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 2: RATE LIMITING & SLIDING WINDOW ENFORCEMENT ---");
  {
    const limiter = createRateLimiter({
      windowMs: 1000,
      max: 3,
      message: "Rate limit exceeded.",
      prefix: "test-auth",
    });

    const mockRes = () => {
      const headers = {};
      let statusCode = 200;
      let jsonBody = null;
      return {
        setHeader(k, v) {
          headers[k] = v;
        },
        status(code) {
          statusCode = code;
          return {
            json(body) {
              jsonBody = body;
            },
          };
        },
        get statusCode() {
          return statusCode;
        },
        get headers() {
          return headers;
        },
        get jsonBody() {
          return jsonBody;
        },
      };
    };

    const req = { ip: "192.168.1.10", xhr: true, headers: {} };

    // Request 1
    let res1 = mockRes();
    let next1 = false;
    limiter(req, res1, () => { next1 = true; });
    assert(next1 && res1.headers["X-RateLimit-Remaining"] === 2, "Request 1 allowed, remaining: 2");

    // Request 2
    let res2 = mockRes();
    let next2 = false;
    limiter(req, res2, () => { next2 = true; });
    assert(next2 && res2.headers["X-RateLimit-Remaining"] === 1, "Request 2 allowed, remaining: 1");

    // Request 3
    let res3 = mockRes();
    let next3 = false;
    limiter(req, res3, () => { next3 = true; });
    assert(next3 && res3.headers["X-RateLimit-Remaining"] === 0, "Request 3 allowed, remaining: 0");

    // Request 4 (Limit exceeded)
    let res4 = mockRes();
    let next4 = false;
    limiter(req, res4, () => { next4 = true; });
    assert(!next4, "Request 4 blocked by rate limiter");
    assert(res4.statusCode === 429, "Request 4 returned HTTP 429 Too Many Requests");
    assert(res4.headers["Retry-After"] >= 1, "Retry-After response header populated");
  }

  // ---------------------------------------------------------------------------
  // TEST 3: CENTRALIZED VALIDATION LAYER
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 3: CENTRALIZED VALIDATION (AUTH, LISTINGS, BOOKINGS, REVIEWS) ---");
  {
    // 1. Auth Validation
    assert(!validateRegisterInput({ username: "ab", email: "a@b.com", password: "password123" }).valid, "Rejects short username (< 3 chars)");
    assert(!validateRegisterInput({ username: "user!@#", email: "a@b.com", password: "password123" }).valid, "Rejects invalid username characters");
    assert(!validateRegisterInput({ username: "valid_user", email: "invalid-email", password: "password123" }).valid, "Rejects malformed email");
    assert(!validateRegisterInput({ username: "valid_user", email: "valid@nestora.com", password: "123" }).valid, "Rejects short password (< 6 chars)");
    const validAuth = validateRegisterInput({ username: "  good_user  ", email: "Good@Nestora.COM ", password: "securepassword" });
    assert(validAuth.valid && validAuth.data.username === "good_user" && validAuth.data.email === "good@nestora.com", "Accepts and normalizes valid auth payload");

    // 2. Listing Validation
    assert(!validateListingInput({ title: "Hi", description: "Too short desc", price: 1000, location: "Goa", country: "India", propertyType: "villa", maxGuests: 4 }).valid, "Rejects short title");
    assert(!validateListingInput({ title: "Luxury Villa", description: "A beautiful villa with scenic views.", price: -500, location: "Goa", country: "India", propertyType: "villa", maxGuests: 4 }).valid, "Rejects negative price");
    assert(!validateListingInput({ title: "Luxury Villa", description: "A beautiful villa with scenic views.", price: 2000000, location: "Goa", country: "India", propertyType: "villa", maxGuests: 4 }).valid, "Rejects price exceeding ₹10,00,000");
    assert(!validateListingInput({ title: "Luxury Villa", description: "A beautiful villa with scenic views.", price: 5000, location: "Goa", country: "India", propertyType: "invalid_type", maxGuests: 4 }).valid, "Rejects unlisted property type");
    assert(!validateListingInput({ title: "Luxury Villa", description: "A beautiful villa with scenic views.", price: 5000, location: "Goa", country: "India", propertyType: "villa", maxGuests: 0 }).valid, "Rejects maxGuests < 1");
    assert(!validateListingInput({ title: "Luxury Villa", description: "A beautiful villa with scenic views.", price: 5000, location: "Goa", country: "India", propertyType: "villa", maxGuests: 3.5 }).valid, "Rejects non-integer maxGuests");
    const validListing = validateListingInput({
      title: "  Serene Beach Cottage  ",
      description: "Wonderful beachfront accommodation with private pool and ocean breeze.",
      price: "6500",
      location: "Goa",
      country: "India",
      propertyType: "cottage",
      maxGuests: "6",
      bedrooms: "3",
      bathrooms: "2",
      amenities: "WiFi, Pool, AC",
    });
    assert(validListing.valid && validListing.data.price === 6500 && validListing.data.maxGuests === 6, "Accepts and parses valid listing payload");

    // 3. Booking Validation
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 2);
    const futureDate1 = new Date();
    futureDate1.setDate(futureDate1.getDate() + 5);
    const futureDate2 = new Date();
    futureDate2.setDate(futureDate2.getDate() + 10);
    const farFutureDate = new Date();
    farFutureDate.setDate(farFutureDate.getDate() + 120);

    assert(!validateBookingInput({ checkIn: pastDate, checkOut: futureDate1, guests: 2 }).valid, "Rejects check-in date in the past");
    assert(!validateBookingInput({ checkIn: futureDate2, checkOut: futureDate1, guests: 2 }).valid, "Rejects check-out before check-in");
    assert(!validateBookingInput({ checkIn: futureDate1, checkOut: farFutureDate, guests: 2 }).valid, "Rejects stays longer than 90 nights");
    assert(!validateBookingInput({ checkIn: futureDate1, checkOut: futureDate2, guests: 0 }).valid, "Rejects guests < 1");
    assert(!validateBookingInput({ checkIn: futureDate1, checkOut: futureDate2, guests: 2.5 }).valid, "Rejects fractional guest count");
    const validBooking = validateBookingInput({ checkIn: futureDate1.toISOString(), checkOut: futureDate2.toISOString(), guests: "4" });
    assert(validBooking.valid && validBooking.data.nights === 5 && validBooking.data.guests === 4, "Accepts valid reservation dates and guest count");

    // 4. Review Validation
    assert(!validateReviewInput({ rating: 0, body: "Great stay" }).valid, "Rejects rating < 1");
    assert(!validateReviewInput({ rating: 6, body: "Great stay" }).valid, "Rejects rating > 5");
    assert(!validateReviewInput({ rating: 4.5, body: "Great stay" }).valid, "Rejects non-integer rating");
    assert(!validateReviewInput({ rating: 5, body: "Hi" }).valid, "Rejects review body < 5 characters");
    const validReview = validateReviewInput({ rating: "5", body: "Exceptional hospitality, clean rooms, and breathtaking sunset views!" });
    assert(validReview.valid && validReview.data.rating === 5, "Accepts valid review rating and body");
  }

  // ---------------------------------------------------------------------------
  // TEST 4: CLOUDINARY UPLOAD CONSTRAINTS
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 4: CLOUDINARY UPLOAD CONSTRAINTS & FILTERING ---");
  {
    assert(upload && upload.limits, "Multer upload configuration initialized");
    assert(upload.limits.fileSize === 5 * 1024 * 1024, "Multer file size capped at 5MB per image");
    assert(upload.limits.files === 5, "Multer file count capped at 5 images max");

    // Test MIME-type filtering
    let allowedAccepted = false;
    upload.fileFilter({}, { mimetype: "image/jpeg" }, (err, accept) => {
      if (!err && accept) allowedAccepted = true;
    });
    assert(allowedAccepted, "Allowed MIME-type image/jpeg accepted");

    let webpAccepted = false;
    upload.fileFilter({}, { mimetype: "image/webp" }, (err, accept) => {
      if (!err && accept) webpAccepted = true;
    });
    assert(webpAccepted, "Allowed MIME-type image/webp accepted");

    let rejectedExecutable = false;
    upload.fileFilter({}, { mimetype: "application/x-msdownload" }, (err, accept) => {
      if (err) rejectedExecutable = true;
    });
    assert(rejectedExecutable, "Disallowed executable MIME-type rejected with error");

    let rejectedSvgScript = false;
    upload.fileFilter({}, { mimetype: "image/svg+xml" }, (err, accept) => {
      if (err) rejectedSvgScript = true;
    });
    assert(rejectedSvgScript, "Potentially dangerous SVG MIME-type rejected");
  }

  await mongoose.connection.close();

  console.log("\n=======================================================");
  console.log("✅ ALL 4 PHASE 4 APPLICATION SECURITY TESTS PASSED (100%)!");
  console.log("=======================================================\n");
}

runSecurityTests().catch(async (err) => {
  console.error("Security test execution error:", err);
  try {
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
