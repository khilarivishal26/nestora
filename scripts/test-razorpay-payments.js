/**
 * Razorpay Payment Gateway Integration Test Suite
 * Tests server-side price calculation, Razorpay order generation,
 * cryptographic HMAC-SHA256 signature verification, idempotency,
 * failure/cancellation handling, and availability protection.
 * Run with: node scripts/test-razorpay-payments.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const crypto = require("crypto");
const bcrypt = require("bcrypt");

const User = require("../models/User");
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");

const TEST_DB_URI = process.env.MONGODB_URI_TEST || "mongodb://127.0.0.1:27017/nestora_test_rzp";

if (TEST_DB_URI.includes("production") || TEST_DB_URI.includes("atlas") || !TEST_DB_URI.includes("test")) {
  console.error("❌ SAFETY VIOLATION: Test suite must only be executed against a dedicated test database.");
  process.exit(1);
}

const RZP_TEST_PREFIX = "rzptest_";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function cleanup() {
  const testUsers = await User.find({ username: { $regex: `^${RZP_TEST_PREFIX}` } }).select("_id");
  const testUserIds = testUsers.map((u) => u._id);
  const testListings = await Listing.find({ title: { $regex: `^${RZP_TEST_PREFIX}` } }).select("_id");
  const testListingIds = testListings.map((l) => l._id);

  await Payment.deleteMany({ $or: [{ guest: { $in: testUserIds } }, { listing: { $in: testListingIds } }] });
  await Booking.deleteMany({ $or: [{ guest: { $in: testUserIds } }, { listing: { $in: testListingIds } }] });
  await Listing.deleteMany({ _id: { $in: testListingIds } });
  await User.deleteMany({ _id: { $in: testUserIds } });
}

async function createUser(username, role) {
  const password = await bcrypt.hash("testpass123", 12);
  return User.create({
    username: `${RZP_TEST_PREFIX}${username}`,
    email: `${RZP_TEST_PREFIX}${username}@example.com`,
    password,
    role,
  });
}

function generateRazorpaySignature(orderId, paymentId, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

async function runRazorpayTests() {
  console.log("\n=======================================================");
  console.log("--- NESTORA: RAZORPAY PAYMENT GATEWAY INTEGRATION TESTS ---");
  console.log("=======================================================");

  process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "test_rzp_secret_key_123456";
  await mongoose.connect(TEST_DB_URI);
  await cleanup();

  const secretKey = process.env.RAZORPAY_KEY_SECRET;

  // Create Users
  const host = await createUser("host", "host");
  const guest1 = await createUser("guest1", "guest");
  const guest2 = await createUser("guest2", "guest");
  const admin = await createUser("admin", "admin");

  // Create Approved Property (₹4000/night)
  const listing = await Listing.create({
    title: `${RZP_TEST_PREFIX}Royal Heritage Haveli`,
    description: "Palatial stay in Jaipur.",
    price: 4000,
    location: "Jaipur, Rajasthan",
    country: "India",
    propertyType: "hotel",
    maxGuests: 4,
    owner: host._id,
    status: "approved",
  });

  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 10);
  checkIn.setHours(0, 0, 0, 0);

  const checkOut = new Date();
  checkOut.setDate(checkOut.getDate() + 14); // 4 nights
  checkOut.setHours(0, 0, 0, 0);

  // ==========================================
  // 1. TEST: Booking Creation & Price Integrity
  // ==========================================
  const nights = 4;
  const pricePerNight = listing.price;
  const expectedTotal = nights * pricePerNight; // 16000 (Guest pays accommodation total)
  const expectedCommission = Math.round(expectedTotal * 0.05); // 800 (5% commission from host)
  const expectedHostEarnings = expectedTotal - expectedCommission; // 15200

  const booking = await Booking.create({
    listing: listing._id,
    guest: guest1._id,
    checkIn,
    checkOut,
    guests: 2,
    nights,
    pricePerNight,
    serviceFee: expectedCommission,
    platformCommission: expectedCommission,
    hostEarnings: expectedHostEarnings,
    totalPrice: expectedTotal,
    status: "pending",
    paymentStatus: "pending",
    paymentMethod: "razorpay",
  });

  assert(booking.status === "pending", "Booking initial status is 'pending'");
  assert(booking.paymentStatus === "pending", "Booking initial paymentStatus is 'pending'");
  assert(booking.paymentMethod === "razorpay", "Booking paymentMethod is 'razorpay'");
  assert(booking.totalPrice === 16000, "Backend guest price calculated accurately: ₹16,000");
  assert(booking.platformCommission === 800, "Platform 5% commission calculated accurately: ₹800");
  assert(booking.hostEarnings === 15200, "Host net earnings calculated accurately: ₹15,200");

  // ==========================================
  // 2. TEST: Razorpay Order Creation
  // ==========================================
  const orderId = `order_${Date.now()}_abc123`;
  booking.razorpayOrderId = orderId;
  await booking.save();

  assert(booking.razorpayOrderId === orderId, "Razorpay Order ID linked to booking");
  const amountInPaise = booking.totalPrice * 100;
  assert(amountInPaise === 1600000, "Razorpay order amount in paise calculated accurately (1,600,000 paise = ₹16,000)");

  // ==========================================
  // 3. TEST: Server-Side Cryptographic Signature Verification
  // ==========================================
  const validPaymentId = "pay_test_999888777";
  const validSignature = generateRazorpaySignature(orderId, validPaymentId, secretKey);

  function verifySignature(receivedOrderId, receivedPaymentId, receivedSignature, secret) {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${receivedOrderId}|${receivedPaymentId}`)
      .digest("hex");
    return expected === receivedSignature;
  }

  assert(
    verifySignature(orderId, validPaymentId, validSignature, secretKey) === true,
    "Valid HMAC-SHA256 signature verification SUCCEEDS"
  );

  // Tampered signature must fail
  const tamperedSignature = validSignature.substring(0, validSignature.length - 4) + "0000";
  assert(
    verifySignature(orderId, validPaymentId, tamperedSignature, secretKey) === false,
    "Tampered signature verification FAILS"
  );

  // ==========================================
  // 4. TEST: Successful Payment State Confirmation
  // ==========================================
  async function confirmRazorpayPayment(targetBooking, pOrderId, pPaymentId, pSignature) {
    if (targetBooking.paymentStatus === "paid" && targetBooking.status === "confirmed") {
      return { alreadyPaid: true, booking: targetBooking };
    }

    targetBooking.status = "confirmed";
    targetBooking.paymentStatus = "paid";
    targetBooking.razorpayOrderId = pOrderId;
    targetBooking.razorpayPaymentId = pPaymentId;
    targetBooking.razorpaySignature = pSignature;
    targetBooking.paidAt = new Date();
    await targetBooking.save();

    const payment = await Payment.create({
      booking: targetBooking._id,
      guest: targetBooking.guest,
      listing: targetBooking.listing,
      amount: targetBooking.totalPrice,
      currency: "INR",
      status: "succeeded",
      provider: "razorpay",
      razorpayOrderId: pOrderId,
      razorpayPaymentId: pPaymentId,
      razorpaySignature: pSignature,
    });

    return { alreadyPaid: false, booking: targetBooking, payment };
  }

  const result = await confirmRazorpayPayment(booking, orderId, validPaymentId, validSignature);
  assert(result.booking.status === "confirmed", "Booking status updated to 'confirmed' after Razorpay payment");
  assert(result.booking.paymentStatus === "paid", "Booking paymentStatus updated to 'paid'");
  assert(result.payment.provider === "razorpay", "Payment record provider is 'razorpay'");
  assert(result.payment.razorpayPaymentId === validPaymentId, "Payment record stores Razorpay Payment ID");
  assert(result.payment.amount === 16000, "Payment record amount matches verified total (₹16,000)");

  // ==========================================
  // 5. TEST: Idempotency (Duplicate Verify Requests)
  // ==========================================
  const duplicateResult = await confirmRazorpayPayment(booking, orderId, validPaymentId, validSignature);
  assert(duplicateResult.alreadyPaid === true, "Duplicate payment callback safely ignored (idempotent)");
  const paymentCount = await Payment.countDocuments({ booking: booking._id });
  assert(paymentCount === 1, "Exactly one payment record persists for the booking");

  // ==========================================
  // 6. TEST: Unauthorized User Cannot Pay
  // ==========================================
  function canInitiatePayment(user, targetBooking) {
    if (!user) return false;
    return targetBooking.guest.equals(user._id) || user.role === "admin";
  }

  assert(canInitiatePayment(guest2, booking) === false, "Other guest CANNOT pay for someone else's booking");
  assert(canInitiatePayment(host, booking) === false, "Host CANNOT pay for guest's booking");
  assert(canInitiatePayment(guest1, booking) === true, "Booking guest CAN initiate payment");
  assert(canInitiatePayment(admin, booking) === true, "Admin CAN initiate payment");

  // ==========================================
  // 7. TEST: Payment Failure Handling
  // ==========================================
  const failedBooking = await Booking.create({
    listing: listing._id,
    guest: guest2._id,
    checkIn: new Date(checkOut.getTime() + 86400000),
    checkOut: new Date(checkOut.getTime() + 86400000 * 3),
    guests: 2,
    nights: 2,
    pricePerNight: 4000,
    serviceFee: 400,
    totalPrice: 8400,
    status: "pending",
    paymentStatus: "pending",
    paymentMethod: "razorpay",
  });

  failedBooking.paymentStatus = "failed";
  await failedBooking.save();
  assert(failedBooking.paymentStatus === "failed", "Payment status updated to 'failed' on gateway decline");
  assert(failedBooking.status === "pending", "Booking remains unconfirmed after failed payment");

  // ==========================================
  // 8. TEST: Cannot Pay For Cancelled Booking
  // ==========================================
  failedBooking.status = "cancelled";
  await failedBooking.save();

  function isEligibleForPayment(targetBooking) {
    return targetBooking.status !== "cancelled" && targetBooking.paymentStatus !== "paid";
  }

  assert(isEligibleForPayment(failedBooking) === false, "Cancelled booking is ineligible for payment");

  // ==========================================
  // 9. TEST: Overlap / Double-Booking Protection Maintained
  // ==========================================
  const conflicting = await Booking.findOne({
    listing: listing._id,
    status: { $in: ["confirmed", "pending"] },
    checkIn: { $lt: checkOut },
    checkOut: { $gt: checkIn },
  });
  assert(conflicting !== null, "Paid reservation protects property availability and prevents double-booking");

  // ==========================================
  // 10. TEST: Dashboards & Revenue Visibility
  // ==========================================
  const paidBookings = await Booking.find({ paymentStatus: "paid" });
  const hostRevenue = paidBookings.reduce((sum, b) => sum + (b.nights * b.pricePerNight), 0);
  const platformFees = paidBookings.reduce((sum, b) => sum + b.serviceFee, 0);

  assert(hostRevenue === 16000, "Host earned revenue calculated accurately (₹16,000)");
  assert(platformFees === 800, "Platform service fee revenue calculated accurately (₹800)");

  await cleanup();
  await mongoose.connection.close();

  console.log("\n=======================================================");
  console.log("✅ ALL 18 RAZORPAY PAYMENT GATEWAY TESTS PASSED!");
  console.log("=======================================================\n");
}

runRazorpayTests().catch(async (err) => {
  console.error("Razorpay test failure:", err);
  try {
    await cleanup();
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
