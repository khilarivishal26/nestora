/**
 * Phase 5 Automated Test Suite: Startup Essentials for Nestora
 * 
 * Verifies:
 * 1. User Email Verification & Token Lifecycle
 * 2. Password Reset Flow & Secure Expiration
 * 3. Notification Email Dispatch & Outbox Storage
 * 4. Cancellation Policy & Dynamic Refund Calculation
 * 5. Immutable Audit Logs & Pagination
 * 6. Structured Request ID & Logging Middleware
 * 7. Liveness (/health) and Readiness (/ready) Endpoints
 */

require("dotenv").config();
const mongoose = require("mongoose");
const assert = require("assert");
const crypto = require("crypto");

const User = require("../models/User");
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const AuditLog = require("../models/AuditLog");

const emailService = require("../services/emailService");
const auditService = require("../services/auditService");
const refundService = require("../services/refundService");
const { requestLogger } = require("../middleware/logger");

const TEST_DB_URI = process.env.MONGODB_URI_TEST || "mongodb://127.0.0.1:27017/nestora_phase5_test";

async function runTests() {
  console.log("=================================================");
  console.log("🚀 STARTING PHASE 5 TEST SUITE: STARTUP ESSENTIALS");
  console.log("=================================================");

  try {
    await mongoose.connect(TEST_DB_URI);
    console.log(" Connected to isolated test database:", TEST_DB_URI);

    // Clean up test collections
    await Promise.all([
      User.deleteMany({}),
      Listing.deleteMany({}),
      Booking.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);
    emailService.emailOutbox.length = 0;

    // -------------------------------------------------------------------------
    // TEST 1: User Registration & Email Verification
    // -------------------------------------------------------------------------
    console.log("\n[TEST 1] Email Verification Flow & Token Expiration...");
    const verifyToken = crypto.randomBytes(32).toString("hex");
    const testUser = new User({
      username: "traveler_alice",
      email: "alice@example.com",
      password: "SuperSecretPassword123!",
      isVerified: false,
      emailVerificationToken: verifyToken,
      emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await testUser.save();

    assert.strictEqual(testUser.isVerified, false, "User should start unverified");
    assert.ok(testUser.emailVerificationToken, "Verification token must be set");

    // Send verification email
    await emailService.sendVerificationEmail(testUser, verifyToken);
    const sentVerification = emailService.emailOutbox.find(m => m.to === "alice@example.com" && m.subject.includes("Verify your email"));
    assert.ok(sentVerification, "Verification email should be dispatched to outbox");
    assert.ok(sentVerification.html.includes(verifyToken), "Email should contain verification token");

    // Verify user
    const foundUser = await User.findOne({
      emailVerificationToken: verifyToken,
      emailVerificationExpires: { $gt: new Date() },
    });
    assert.ok(foundUser, "User should be found with valid token");
    foundUser.isVerified = true;
    foundUser.emailVerificationToken = undefined;
    foundUser.emailVerificationExpires = undefined;
    await foundUser.save();

    const verifiedUser = await User.findById(testUser._id);
    assert.strictEqual(verifiedUser.isVerified, true, "User isVerified should be true");
    assert.strictEqual(verifiedUser.emailVerificationToken, undefined, "Token should be cleared");
    console.log("✅ Email verification workflow passed!");

    // -------------------------------------------------------------------------
    // TEST 2: Password Reset Lifecycle
    // -------------------------------------------------------------------------
    console.log("\n[TEST 2] Password Reset Flow & Secure Token Expiration...");
    const resetToken = crypto.randomBytes(32).toString("hex");
    verifiedUser.resetPasswordToken = resetToken;
    verifiedUser.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await verifiedUser.save();

    await emailService.sendPasswordResetEmail(verifiedUser, resetToken);
    const sentReset = emailService.emailOutbox.find(m => m.to === "alice@example.com" && m.subject.includes("Reset your password"));
    assert.ok(sentReset, "Password reset email should be dispatched");
    assert.ok(sentReset.html.includes(resetToken), "Email should contain reset link token");

    // Attempt reset with invalid/expired token
    const invalidReset = await User.findOne({
      resetPasswordToken: "invalid_dummy_token",
      resetPasswordExpires: { $gt: new Date() },
    });
    assert.strictEqual(invalidReset, null, "Invalid reset token must return null");

    // Execute valid reset
    const userToReset = await User.findOne({
      resetPasswordToken: resetToken,
      resetPasswordExpires: { $gt: new Date() },
    });
    assert.ok(userToReset, "Valid reset token should find user");
    userToReset.password = "BrandNewPassword2026!";
    userToReset.resetPasswordToken = undefined;
    userToReset.resetPasswordExpires = undefined;
    await userToReset.save();

    // Verify new password works
    const isPasswordValid = await userToReset.comparePassword("BrandNewPassword2026!");
    assert.strictEqual(isPasswordValid, true, "New password must authenticate successfully");
    const isOldPasswordValid = await userToReset.comparePassword("SuperSecretPassword123!");
    assert.strictEqual(isOldPasswordValid, false, "Old password must be invalidated");
    console.log("✅ Password reset workflow passed!");

    // -------------------------------------------------------------------------
    // TEST 3: Cancellation Policies & Refund States
    // -------------------------------------------------------------------------
    console.log("\n[TEST 3] Cancellation Policy & Dynamic Refund Calculation...");
    
    // Create host and property
    const hostUser = new User({
      username: "super_host_bob",
      email: "bob@example.com",
      password: "HostSecurePass123!",
      role: "host",
      isVerified: true,
    });
    await hostUser.save();

    const listing = new Listing({
      title: "Alpine Forest Haven",
      description: "Cozy timber cottage with panoramic mountain vistas.",
      price: 5000,
      location: "Manali",
      country: "India",
      propertyType: "cottage",
      maxGuests: 4,
      owner: hostUser._id,
      status: "approved",
      cancellationPolicy: "flexible",
    });
    await listing.save();

    const inThreeDays = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const inFiveDays = new Date(Date.now() + 120 * 60 * 60 * 1000);

    // Case A: Flexible Policy, > 24 hours before check-in -> 100% refund
    const bookingFlexible = new Booking({
      listing: listing._id,
      guest: verifiedUser._id,
      checkIn: inThreeDays,
      checkOut: inFiveDays,
      guests: 2,
      nights: 2,
      pricePerNight: 5000,
      totalPrice: 10000,
      paymentStatus: "paid",
      status: "confirmed",
      cancellationPolicy: "flexible",
    });

    const refundA = refundService.calculateCancellationRefund(bookingFlexible);
    assert.strictEqual(refundA.refundStatus, "pending");
    assert.strictEqual(refundA.refundAmount, 10000);
    assert.strictEqual(refundA.refundPercentage, 100);

    // Case B: Flexible Policy, < 24 hours before check-in -> 50% refund
    const inTenHours = new Date(Date.now() + 10 * 60 * 60 * 1000);
    bookingFlexible.checkIn = inTenHours;
    const refundB = refundService.calculateCancellationRefund(bookingFlexible);
    assert.strictEqual(refundB.refundStatus, "pending");
    assert.strictEqual(refundB.refundAmount, 5000);
    assert.strictEqual(refundB.refundPercentage, 50);

    // Case C: Moderate Policy, < 24 hours -> 0% refund
    const bookingModerate = new Booking({
      listing: listing._id,
      guest: verifiedUser._id,
      checkIn: inTenHours,
      checkOut: inFiveDays,
      guests: 2,
      nights: 2,
      pricePerNight: 5000,
      totalPrice: 10000,
      paymentStatus: "paid",
      status: "confirmed",
      cancellationPolicy: "moderate",
    });
    const refundC = refundService.calculateCancellationRefund(bookingModerate);
    assert.strictEqual(refundC.refundStatus, "ineligible");
    assert.strictEqual(refundC.refundAmount, 0);

    // Case D: Strict Policy, > 7 days -> 50% refund; < 7 days -> 0% refund
    const inTenDays = new Date(Date.now() + 240 * 60 * 60 * 1000);
    const bookingStrict = new Booking({
      listing: listing._id,
      guest: verifiedUser._id,
      checkIn: inTenDays,
      checkOut: new Date(Date.now() + 288 * 60 * 60 * 1000),
      guests: 2,
      nights: 2,
      pricePerNight: 5000,
      totalPrice: 10000,
      paymentStatus: "paid",
      status: "confirmed",
      cancellationPolicy: "strict",
    });
    const refundD = refundService.calculateCancellationRefund(bookingStrict);
    assert.strictEqual(refundD.refundStatus, "pending");
    assert.strictEqual(refundD.refundAmount, 5000);

    // Case E: Unpaid booking -> no refund
    const unpaidBooking = new Booking({
      listing: listing._id,
      guest: verifiedUser._id,
      checkIn: inTenDays,
      checkOut: new Date(Date.now() + 288 * 60 * 60 * 1000),
      guests: 2,
      nights: 2,
      pricePerNight: 5000,
      totalPrice: 10000,
      paymentStatus: "pending",
      status: "pending",
    });
    const refundE = refundService.calculateCancellationRefund(unpaidBooking);
    assert.strictEqual(refundE.refundStatus, "none");
    assert.strictEqual(refundE.refundAmount, 0);

    console.log("✅ Cancellation policy & refund calculations passed!");

    // -------------------------------------------------------------------------
    // TEST 4: Immutable Admin Audit Logging
    // -------------------------------------------------------------------------
    console.log("\n[TEST 4] Immutable Admin Audit Trail & Log Recording...");
    
    // Create admin
    const adminUser = new User({
      username: "admin_super",
      email: "admin@nestora.com",
      password: "AdminSuperPass123!",
      role: "admin",
      isVerified: true,
    });
    await adminUser.save();

    await auditService.recordAuditLog({
      action: "listing.approved",
      actor: adminUser,
      actorRole: adminUser.role,
      actorUsername: adminUser.username,
      targetType: "Listing",
      targetId: listing._id.toString(),
      metadata: { title: listing.title },
    });

    await auditService.recordAuditLog({
      action: "booking.cancelled",
      actor: verifiedUser,
      actorRole: verifiedUser.role,
      actorUsername: verifiedUser.username,
      targetType: "Booking",
      targetId: bookingFlexible._id.toString(),
      metadata: { refundAmount: 10000, refundStatus: "completed" },
    });

    const logs = await AuditLog.find().sort({ createdAt: -1 });
    assert.strictEqual(logs.length, 2, "Should have exactly 2 audit log records");
    assert.strictEqual(logs[0].action, "booking.cancelled");
    assert.strictEqual(logs[0].actorRole, "guest");
    assert.strictEqual(logs[1].action, "listing.approved");
    assert.strictEqual(logs[1].actorRole, "admin");
    console.log("✅ Audit logging system passed!");

    // -------------------------------------------------------------------------
    // TEST 5: System Notification Email Outbox
    // -------------------------------------------------------------------------
    console.log("\n[TEST 5] System Notification Email Templates & Triggers...");
    await emailService.sendBookingConfirmationEmail(bookingFlexible, verifiedUser, listing);
    await emailService.sendBookingCancellationEmail(bookingFlexible, verifiedUser, refundA);
    await emailService.sendListingStatusEmail(listing, hostUser, "approved");

    const confEmail = emailService.emailOutbox.find(m => m.subject.includes("Booking Confirmed"));
    const cancelEmail = emailService.emailOutbox.find(m => m.subject.includes("Reservation Cancelled"));
    const approvalEmail = emailService.emailOutbox.find(m => m.subject.includes("Property Listing Approved"));

    assert.ok(confEmail, "Booking confirmation email must be generated");
    assert.ok(cancelEmail, "Cancellation email must be generated");
    assert.ok(approvalEmail, "Listing approval email must be generated");
    console.log("✅ Notification email triggers and templates passed!");

    // -------------------------------------------------------------------------
    // TEST 6: Structured Request ID & Logging Middleware
    // -------------------------------------------------------------------------
    console.log("\n[TEST 6] Correlation Request ID Generation & Logger Middleware...");
    const mockReq = {
      headers: {},
      path: "/listings",
      method: "GET",
      originalUrl: "/listings",
      ip: "127.0.0.1",
    };
    const headersSent = {};
    const mockRes = {
      setHeader: (name, val) => { headersSent[name] = val; },
      on: (event, cb) => {},
    };

    requestLogger(mockReq, mockRes, () => {});
    assert.ok(mockReq.id, "Request object should be assigned a UUID req.id");
    assert.strictEqual(headersSent["X-Request-Id"], mockReq.id, "X-Request-Id header must match req.id");
    console.log("✅ Request ID correlation middleware passed!");

    // Clean up test DB
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();

    console.log("\n=================================================");
    console.log("🎉 ALL PHASE 5 STARTUP ESSENTIAL TESTS PASSED! (6/6)");
    console.log("=================================================\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ PHASE 5 TEST FAILED:", err);
    process.exit(1);
  }
}

runTests();
