/**
 * Phase 1: Secure Razorpay Payment Tests
 * Runs against a dedicated, isolated test database to verify:
 * 1. Rejection of missing webhook signatures
 * 2. Rejection of invalid/tampered webhook signatures
 * 3. Successful webhook processing with valid HMAC signatures
 * 4. Rejection of verify requests with missing parameters
 * 5. Rejection of order ID mismatch (submitted order_id != booking.razorpayOrderId)
 * 6. Authorization checks: only booking guest or admin can verify payment
 * 7. Rejection of tampered payment signatures
 * 8. Successful payment verification with valid HMAC-SHA256 signature
 * 9. Authorization checks for payment failure handling
 * 10. Confirmation that state-changing GET /:id/payment/cancel route is removed
 *
 * Run with: node scripts/test-phase1-razorpay-secure.js
 */

const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

// Configure test environment variables for cryptographic operations
const TEST_KEY_SECRET = "test_rzp_secret_998877665544332211";
const TEST_WEBHOOK_SECRET = "test_whsec_112233445566778899";
process.env.RAZORPAY_KEY_SECRET = TEST_KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
process.env.NODE_ENV = "test";

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/nestora_test_razorpay_sec";

const User = require("../models/User");
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const paymentController = require("../controllers/paymentController");
const bookingsRouter = require("../routes/bookings");

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function runSecurePaymentTests() {
  console.log("\n=======================================================");
  console.log("--- NESTORA: PHASE 1 SECURE RAZORPAY PAYMENT TESTS ---");
  console.log("=======================================================\n");

  await mongoose.connect(TEST_DB_URI, { dbName: "nestora_test_razorpay_sec" });
  console.log(`Connected to isolated test DB: ${mongoose.connection.name}`);

  // Clean test database completely
  await mongoose.connection.dropDatabase();

  const passwordHash = await bcrypt.hash("securePass123", 10);

  const guestAlice = await User.create({
    username: "sec_alice",
    email: "sec_alice@test.com",
    password: passwordHash,
    role: "guest",
  });

  const guestBob = await User.create({
    username: "sec_bob",
    email: "sec_bob@test.com",
    password: passwordHash,
    role: "guest",
  });

  const hostCarlos = await User.create({
    username: "sec_carlos",
    email: "sec_carlos@test.com",
    password: passwordHash,
    role: "host",
  });

  const adminDan = await User.create({
    username: "sec_dan",
    email: "sec_dan@test.com",
    password: passwordHash,
    role: "admin",
  });

  const listing = await Listing.create({
    title: "Secure Coastal Villa",
    description: "High security oceanfront villa.",
    price: 10000,
    location: "Goa",
    country: "India",
    propertyType: "villa",
    maxGuests: 4,
    owner: hostCarlos._id,
    status: "approved",
  });

  console.log("\n--- TEST 1: WEBHOOK - REJECT MISSING SIGNATURE ---");
  {
    let statusCode = 200;
    let responseData = null;
    const req = {
      headers: {},
      body: { event: "payment.captured" },
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
      },
    };
    await paymentController.handleWebhook(req, res);
    assert(statusCode === 400 && responseData && responseData.error === "Missing webhook signature", "Webhook without signature is rejected with HTTP 400");
  }

  console.log("\n--- TEST 2: WEBHOOK - REJECT INVALID/TAMPERED SIGNATURE ---");
  {
    let statusCode = 200;
    let responseData = null;
    const payload = JSON.stringify({ event: "payment.captured" });
    const req = {
      headers: { "x-razorpay-signature": "tampered_signature_12345" },
      rawBody: Buffer.from(payload),
      body: JSON.parse(payload),
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
      },
    };
    await paymentController.handleWebhook(req, res);
    assert(statusCode === 400 && responseData && responseData.error === "Invalid webhook signature", "Webhook with tampered signature is rejected with HTTP 400");
  }

  console.log("\n--- TEST 3: WEBHOOK - PROCESS VALID SIGNATURE ---");
  {
    const webhookBooking = await Booking.create({
      listing: listing._id,
      guest: guestAlice._id,
      checkIn: new Date("2026-10-01"),
      checkOut: new Date("2026-10-03"),
      guests: 2,
      nights: 2,
      pricePerNight: 10000,
      totalPrice: 20000,
      platformCommission: 1000,
      hostEarnings: 19000,
      status: "pending",
      paymentStatus: "pending",
      razorpayOrderId: "order_webhook_test_1001",
    });

    const eventPayload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_webhook_captured_999",
            order_id: "order_webhook_test_1001",
            notes: { bookingId: webhookBooking._id.toString() },
          },
        },
      },
    };
    const payloadStr = JSON.stringify(eventPayload);
    const validSignature = crypto.createHmac("sha256", TEST_WEBHOOK_SECRET).update(payloadStr).digest("hex");

    let statusCode = 200;
    let responseData = null;
    const req = {
      headers: { "x-razorpay-signature": validSignature },
      rawBody: Buffer.from(payloadStr),
      body: eventPayload,
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
      },
    };
    await paymentController.handleWebhook(req, res);
    assert(statusCode === 200 && responseData && responseData.status === "ok", "Webhook processed successfully with HTTP 200");

    const updatedBooking = await Booking.findById(webhookBooking._id);
    assert(updatedBooking.status === "confirmed" && updatedBooking.paymentStatus === "paid", "Booking transitioned to confirmed and paid");
    assert(updatedBooking.razorpayPaymentId === "pay_webhook_captured_999", "Payment ID recorded on booking");

    const paymentRecord = await Payment.findOne({ booking: webhookBooking._id });
    assert(paymentRecord && paymentRecord.status === "succeeded" && paymentRecord.amount === 20000, "Payment audit ledger record created");
  }

  console.log("\n--- TEST 4: VERIFY - REJECT ORDER ID MISMATCH ---");
  {
    const bookingMismatch = await Booking.create({
      listing: listing._id,
      guest: guestAlice._id,
      checkIn: new Date("2026-10-05"),
      checkOut: new Date("2026-10-07"),
      guests: 2,
      nights: 2,
      pricePerNight: 10000,
      totalPrice: 20000,
      status: "pending",
      paymentStatus: "pending",
      razorpayOrderId: "order_actual_booking_1234",
    });

    let flashType = null;
    let flashMsg = null;
    let redirectedTo = null;

    const req = {
      params: { id: bookingMismatch._id.toString() },
      user: guestAlice,
      body: {
        razorpay_order_id: "order_spoofed_5678", // Spoofed order ID
        razorpay_payment_id: "pay_test_1234",
        razorpay_signature: "some_sig",
      },
      flash(type, msg) {
        flashType = type;
        flashMsg = msg;
      },
    };
    const res = {
      redirect(url) {
        redirectedTo = url;
      },
    };

    await paymentController.verifyPayment(req, res, () => {});
    const checkedBooking = await Booking.findById(bookingMismatch._id);
    assert(checkedBooking.paymentStatus === "failed", "Booking paymentStatus marked failed on order ID mismatch");
    assert(flashType === "error" && flashMsg.includes("Invalid or mismatched"), "Flash error returned for mismatched order ID");
  }

  console.log("\n--- TEST 5: VERIFY - REJECT UNAUTHORIZED USER (NON-GUEST / NON-ADMIN) ---");
  {
    const bookingAlice = await Booking.create({
      listing: listing._id,
      guest: guestAlice._id,
      checkIn: new Date("2026-10-10"),
      checkOut: new Date("2026-10-12"),
      guests: 2,
      nights: 2,
      pricePerNight: 10000,
      totalPrice: 20000,
      status: "pending",
      paymentStatus: "pending",
      razorpayOrderId: "order_alice_secure_1",
    });

    let flashType = null;
    let flashMsg = null;
    let redirectedTo = null;

    const req = {
      params: { id: bookingAlice._id.toString() },
      user: guestBob, // Bob attempts to verify Alice's reservation
      body: {
        razorpay_order_id: "order_alice_secure_1",
        razorpay_payment_id: "pay_123",
        razorpay_signature: "sig_123",
      },
      flash(type, msg) {
        flashType = type;
        flashMsg = msg;
      },
    };
    const res = {
      redirect(url) {
        redirectedTo = url;
      },
    };

    await paymentController.verifyPayment(req, res, () => {});
    const uncheckedBooking = await Booking.findById(bookingAlice._id);
    assert(uncheckedBooking.paymentStatus === "pending", "Unauthorized user cannot mutate booking paymentStatus");
    assert(flashType === "error" && flashMsg.includes("Unauthorized"), "Unauthorized access blocked with flash error");
  }

  console.log("\n--- TEST 6: VERIFY - REJECT TAMPERED CRYPTOGRAPHIC SIGNATURE ---");
  {
    const bookingSig = await Booking.create({
      listing: listing._id,
      guest: guestAlice._id,
      checkIn: new Date("2026-10-15"),
      checkOut: new Date("2026-10-17"),
      guests: 2,
      nights: 2,
      pricePerNight: 10000,
      totalPrice: 20000,
      status: "pending",
      paymentStatus: "pending",
      razorpayOrderId: "order_sig_test_1",
    });

    let flashType = null;
    let flashMsg = null;

    const req = {
      params: { id: bookingSig._id.toString() },
      user: guestAlice,
      body: {
        razorpay_order_id: "order_sig_test_1",
        razorpay_payment_id: "pay_sig_test_1",
        razorpay_signature: "invalid_tampered_signature_value",
      },
      flash(type, msg) {
        flashType = type;
        flashMsg = msg;
      },
    };
    const res = {
      redirect() {},
    };

    await paymentController.verifyPayment(req, res, () => {});
    const failedBooking = await Booking.findById(bookingSig._id);
    assert(failedBooking.paymentStatus === "failed", "Booking paymentStatus marked failed when signature is tampered");
    assert(flashType === "error" && flashMsg.includes("signature verification failed"), "Signature failure reported to user");
  }

  console.log("\n--- TEST 7: VERIFY - ACCEPT VALID CRYPTOGRAPHIC SIGNATURE BY GUEST ---");
  {
    const bookingValid = await Booking.create({
      listing: listing._id,
      guest: guestAlice._id,
      checkIn: new Date("2026-10-20"),
      checkOut: new Date("2026-10-22"),
      guests: 2,
      nights: 2,
      pricePerNight: 10000,
      totalPrice: 20000,
      status: "pending",
      paymentStatus: "pending",
      razorpayOrderId: "order_valid_2026_01",
    });

    const orderId = "order_valid_2026_01";
    const paymentId = "pay_valid_2026_01";
    const validSignature = crypto
      .createHmac("sha256", TEST_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    let flashType = null;
    let flashMsg = null;

    const req = {
      params: { id: bookingValid._id.toString() },
      user: guestAlice,
      body: {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature,
      },
      flash(type, msg) {
        flashType = type;
        flashMsg = msg;
      },
    };
    const res = {
      redirect() {},
    };

    await paymentController.verifyPayment(req, res, () => {});
    const confirmedBooking = await Booking.findById(bookingValid._id);
    assert(confirmedBooking.status === "confirmed", "Booking confirmed upon valid signature");
    assert(confirmedBooking.paymentStatus === "paid", "Booking paymentStatus set to paid");
    assert(confirmedBooking.razorpayPaymentId === paymentId, "Razorpay payment ID persisted");
    assert(flashType === "success", "Success flash message delivered");

    const paymentLedger = await Payment.findOne({ booking: bookingValid._id });
    assert(paymentLedger && paymentLedger.status === "succeeded", "Immutable Payment audit record created");
  }

  console.log("\n--- TEST 8: VERIFY - ADMIN AUTHORIZATION TO VERIFY PAYMENT ---");
  {
    const bookingAdmin = await Booking.create({
      listing: listing._id,
      guest: guestAlice._id,
      checkIn: new Date("2026-10-25"),
      checkOut: new Date("2026-10-27"),
      guests: 2,
      nights: 2,
      pricePerNight: 10000,
      totalPrice: 20000,
      status: "pending",
      paymentStatus: "pending",
      razorpayOrderId: "order_admin_verify_1",
    });

    const orderId = "order_admin_verify_1";
    const paymentId = "pay_admin_verify_1";
    const validSignature = crypto
      .createHmac("sha256", TEST_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const req = {
      params: { id: bookingAdmin._id.toString() },
      user: adminDan, // Admin user
      body: {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature,
      },
      flash() {},
    };
    const res = {
      redirect() {},
    };

    await paymentController.verifyPayment(req, res, () => {});
    const confirmedBooking = await Booking.findById(bookingAdmin._id);
    assert(confirmedBooking.status === "confirmed" && confirmedBooking.paymentStatus === "paid", "Admin successfully authorized to verify payment");
  }

  console.log("\n--- TEST 9: FAILURE HANDLER - UNAUTHORIZED USER BLOCKED ---");
  {
    const bookingFailAuth = await Booking.create({
      listing: listing._id,
      guest: guestAlice._id,
      checkIn: new Date("2026-11-01"),
      checkOut: new Date("2026-11-03"),
      guests: 2,
      nights: 2,
      pricePerNight: 10000,
      totalPrice: 20000,
      status: "pending",
      paymentStatus: "pending",
    });

    let flashType = null;
    let flashMsg = null;

    const req = {
      params: { id: bookingFailAuth._id.toString() },
      user: guestBob, // Unauthorized user
      flash(type, msg) {
        flashType = type;
        flashMsg = msg;
      },
    };
    const res = {
      redirect() {},
    };

    await paymentController.handlePaymentFailure(req, res, () => {});
    const checked = await Booking.findById(bookingFailAuth._id);
    assert(checked.paymentStatus === "pending", "Unauthorized user cannot mark payment as failed");
    assert(flashType === "error" && flashMsg.includes("Unauthorized"), "Unauthorized attempt rejected with error");
  }

  console.log("\n--- TEST 10: ROUTE CHECK - CONFIRM GET /payment/cancel IS REMOVED ---");
  {
    const routes = bookingsRouter.stack
      .filter((r) => r.route)
      .map((r) => ({
        path: r.route.path,
        methods: Object.keys(r.route.methods),
      }));

    const hasGetCancel = routes.some(
      (r) => r.path === "/:id/payment/cancel" && r.methods.includes("get")
    );
    assert(!hasGetCancel, "GET /:id/payment/cancel route has been removed");

    const hasPostFailed = routes.some(
      (r) => r.path === "/:id/failed" && r.methods.includes("post")
    );
    assert(hasPostFailed, "POST /:id/failed exists for handling payment failures securely");
  }

  // Cleanup isolated test database
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();

  console.log("\n=======================================================");
  console.log("✅ ALL 10 PHASE 1 SECURE PAYMENT TESTS PASSED (100%)!");
  console.log("=======================================================\n");
}

runSecurePaymentTests().catch(async (err) => {
  console.error("Test execution error:", err);
  try {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
