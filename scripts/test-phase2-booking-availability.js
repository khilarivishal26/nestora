/**
 * Phase 2: Booking Availability & Concurrency Test Suite
 * Runs against a dedicated, isolated test database to verify:
 * 1. Booking schema compound indexes for availability queries
 * 2. 15-minute default expiry timestamp initialization
 * 3. Overlap blocking by confirmed bookings
 * 4. Overlap blocking by active pending bookings
 * 5. Automatic release of dates by expired pending bookings
 * 6. Immediate release of dates by cancelled bookings
 * 7. Concurrent overlapping booking requests race condition safety
 * 8. Rejection of payment on cancelled reservations
 * 9. Rejection of payment on expired reservations
 * 10. Safe lifecycle state transitions
 *
 * Run with: node scripts/test-phase2-booking-availability.js
 */

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

process.env.NODE_ENV = "test";
process.env.RAZORPAY_KEY_SECRET = "test_rzp_sec_phase2_123456";
const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/nestora_test_avail_sec";

const User = require("../models/User");
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const bookingController = require("../controllers/bookingController");
const paymentController = require("../controllers/paymentController");

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function runAvailabilityTests() {
  console.log("\n=======================================================");
  console.log("--- NESTORA: PHASE 2 BOOKING AVAILABILITY & CONCURRENCY ---");
  console.log("=======================================================\n");

  await mongoose.connect(TEST_DB_URI, { dbName: "nestora_test_avail_sec" });
  console.log(`Connected to isolated test DB: ${mongoose.connection.name}`);

  await mongoose.connection.dropDatabase();
  await Booking.init(); // Ensure indexes are built

  const passwordHash = await bcrypt.hash("pass123", 10);

  const host = await User.create({
    username: "avail_host",
    email: "avail_host@test.com",
    password: passwordHash,
    role: "host",
  });

  const guest1 = await User.create({
    username: "avail_guest1",
    email: "avail_guest1@test.com",
    password: passwordHash,
    role: "guest",
  });

  const guest2 = await User.create({
    username: "avail_guest2",
    email: "avail_guest2@test.com",
    password: passwordHash,
    role: "guest",
  });

  const guest3 = await User.create({
    username: "avail_guest3",
    email: "avail_guest3@test.com",
    password: passwordHash,
    role: "guest",
  });

  const listing = await Listing.create({
    title: "Alpine Ridge Lodge",
    description: "Serene mountain views.",
    price: 6000,
    location: "Manali",
    country: "India",
    propertyType: "cottage",
    maxGuests: 4,
    owner: host._id,
    status: "approved",
  });

  console.log("--- TEST 1: INDEXES FOR AVAILABILITY QUERIES ---");
  {
    const indexes = await Booking.collection.indexes();
    const hasCompositeIndex = indexes.some(
      (idx) => idx.key.listing === 1 && idx.key.status === 1 && idx.key.checkIn === 1 && idx.key.checkOut === 1
    );
    const hasExpiryIndex = indexes.some(
      (idx) => idx.key.listing === 1 && idx.key.paymentStatus === 1 && idx.key.expiresAt === 1
    );
    assert(hasCompositeIndex, "Compound index (listing, status, checkIn, checkOut) is defined and active");
    assert(hasExpiryIndex, "Compound index (listing, paymentStatus, expiresAt) is defined and active");
  }

  console.log("\n--- TEST 2: PENDING BOOKING DEFAULT 15-MINUTE EXPIRY ---");
  {
    const newBooking = new Booking({
      listing: listing._id,
      guest: guest1._id,
      checkIn: new Date("2026-11-10"),
      checkOut: new Date("2026-11-12"),
      guests: 2,
      nights: 2,
      pricePerNight: 6000,
      totalPrice: 12000,
    });
    await newBooking.save();

    const expectedExpiryMin = Date.now() + 14 * 60 * 1000;
    const expectedExpiryMax = Date.now() + 16 * 60 * 1000;
    const actualExpiry = newBooking.expiresAt.getTime();

    assert(
      actualExpiry >= expectedExpiryMin && actualExpiry <= expectedExpiryMax,
      "Pending booking initialized with 15-minute default hold (expiresAt)"
    );
    assert(!newBooking.isExpired(), "Newly created booking is not expired");
  }

  console.log("\n--- TEST 3: ACTIVE PENDING BOOKING BLOCKS OVERLAPPING DATES ---");
  {
    let flashType = null;
    let flashMsg = null;
    const req = {
      params: { id: listing._id.toString() },
      user: guest2,
      body: {
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        guests: "2",
      },
      flash(type, msg) {
        flashType = type;
        flashMsg = msg;
      },
    };
    const res = { redirect() {} };

    await bookingController.create(req, res, () => {});
    assert(flashType === "error" && flashMsg.includes("already booked or currently on hold"), "Active pending hold blocks conflicting reservation request");
  }

  console.log("\n--- TEST 4: EXPIRED PENDING BOOKING RELEASES DATES ---");
  {
    // Expire the previous booking
    await Booking.updateMany(
      { listing: listing._id },
      { $set: { expiresAt: new Date(Date.now() - 60000), status: "pending" } }
    );

    let flashType = null;
    let flashMsg = null;
    let redirectUrl = null;
    const req = {
      params: { id: listing._id.toString() },
      user: guest2,
      body: {
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        guests: "2",
      },
      flash(type, msg) {
        flashType = type;
        flashMsg = msg;
      },
    };
    const res = {
      redirect(url) {
        redirectUrl = url;
      },
    };

    await bookingController.create(req, res, () => {});
    assert(flashType === "success" && redirectUrl.includes("/payment"), "Dates successfully released when previous booking expired");

    const createdBooking = await Booking.findOne({ guest: guest2._id, status: "pending" });
    assert(createdBooking !== null, "Guest 2 successfully secured released dates");
  }

  console.log("\n--- TEST 5: CANCELLED BOOKING IMMEDIATELY RELEASES DATES ---");
  {
    // Guest 2 cancels their reservation
    const guest2Booking = await Booking.findOne({ guest: guest2._id, status: "pending" });
    guest2Booking.status = "cancelled";
    await guest2Booking.save();

    let flashType = null;
    let redirectUrl = null;
    const req = {
      params: { id: listing._id.toString() },
      user: guest3,
      body: {
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        guests: "2",
      },
      flash(type, msg) {
        flashType = type;
      },
    };
    const res = {
      redirect(url) {
        redirectUrl = url;
      },
    };

    await bookingController.create(req, res, () => {});
    assert(redirectUrl.includes("/payment"), "Cancelled reservation immediately released dates for Guest 3");

    // Mark guest 3 booking as confirmed
    const guest3Booking = await Booking.findOne({ guest: guest3._id, status: "pending" });
    guest3Booking.status = "confirmed";
    guest3Booking.paymentStatus = "paid";
    await guest3Booking.save();
  }

  console.log("\n--- TEST 6: CONFIRMED BOOKING BLOCKS PARTIAL & FULL OVERLAPS ---");
  {
    // Existing confirmed: Nov 10 to Nov 12
    const overlapDates = [
      { in: "2026-11-09", out: "2026-11-11", label: "Early overlap" },
      { in: "2026-11-11", out: "2026-11-13", label: "Late overlap" },
      { in: "2026-11-08", out: "2026-11-15", label: "Encompassing overlap" },
      { in: "2026-11-10", out: "2026-11-12", label: "Exact overlap" },
    ];

    for (const d of overlapDates) {
      let flashType = null;
      const req = {
        params: { id: listing._id.toString() },
        user: guest1,
        body: { checkIn: d.in, checkOut: d.out, guests: "2" },
        flash(type) {
          flashType = type;
        },
      };
      const res = { redirect() {} };
      await bookingController.create(req, res, () => {});
      assert(flashType === "error", `${d.label} (${d.in} to ${d.out}) is strictly blocked by confirmed booking`);
    }
  }

  console.log("\n--- TEST 7: CONCURRENT OVERLAPPING BOOKING REQUESTS (RACE CONDITION) ---");
  {
    // Simulate 4 concurrent requests trying to book Dec 1 to Dec 5 simultaneously
    const checkIn = "2026-12-01";
    const checkOut = "2026-12-05";

    const users = [guest1, guest2, guest3, guest1];
    const results = [];

    await Promise.all(
      users.map(async (user) => {
        let isSuccess = false;
        const req = {
          params: { id: listing._id.toString() },
          user,
          body: { checkIn, checkOut, guests: "2" },
          flash(type) {
            if (type === "success") isSuccess = true;
          },
        };
        const res = {
          redirect(url) {
            if (url && url.includes("/payment")) isSuccess = true;
          },
        };

        try {
          await bookingController.create(req, res, () => {});
        } catch (e) {}
        results.push(isSuccess);
      })
    );

    const dIn = new Date(checkIn);
    dIn.setHours(0, 0, 0, 0);
    const dOut = new Date(checkOut);
    dOut.setHours(0, 0, 0, 0);

    const activeConcurrentBookings = await Booking.find({
      listing: listing._id,
      checkIn: dIn,
      checkOut: dOut,
      status: { $in: ["confirmed", "pending"] },
    });

    assert(
      activeConcurrentBookings.length === 1,
      `Exactly 1 booking secured the slot out of 4 concurrent requests (found ${activeConcurrentBookings.length})`
    );
  }

  console.log("\n--- TEST 8: PREVENT PAYMENT ON CANCELLED RESERVATIONS ---");
  {
    const cancelledBooking = await Booking.create({
      listing: listing._id,
      guest: guest1._id,
      checkIn: new Date("2026-12-20"),
      checkOut: new Date("2026-12-22"),
      guests: 2,
      nights: 2,
      pricePerNight: 6000,
      totalPrice: 12000,
      status: "cancelled",
      paymentStatus: "pending",
      razorpayOrderId: "order_cancel_pay_1",
    });

    let flashType = null;
    let flashMsg = null;
    const req = {
      params: { id: cancelledBooking._id.toString() },
      user: guest1,
      flash(type, msg) {
        flashType = type;
        flashMsg = msg;
      },
    };
    const res = { redirect() {} };

    await paymentController.showPaymentPage(req, res, () => {});
    assert(flashType === "error" && flashMsg.includes("cancelled"), "Checkout blocked for cancelled reservation");

    // Also test verify
    const verifyReq = {
      params: { id: cancelledBooking._id.toString() },
      user: guest1,
      body: {
        razorpay_order_id: "order_cancel_pay_1",
        razorpay_payment_id: "pay_123",
        razorpay_signature: "sig_123",
      },
      flash(type, msg) {
        flashType = type;
        flashMsg = msg;
      },
    };
    await paymentController.verifyPayment(verifyReq, res, () => {});
    assert(flashType === "error" && flashMsg.includes("cancelled"), "Verification blocked for cancelled reservation");
  }

  console.log("\n--- TEST 9: PREVENT PAYMENT ON EXPIRED RESERVATIONS ---");
  {
    const expiredBooking = await Booking.create({
      listing: listing._id,
      guest: guest1._id,
      checkIn: new Date("2026-12-25"),
      checkOut: new Date("2026-12-27"),
      guests: 2,
      nights: 2,
      pricePerNight: 6000,
      totalPrice: 12000,
      status: "pending",
      paymentStatus: "pending",
      expiresAt: new Date(Date.now() - 10000), // Expired
      razorpayOrderId: "order_exp_pay_1",
    });

    let flashType = null;
    let flashMsg = null;
    const req = {
      params: { id: expiredBooking._id.toString() },
      user: guest1,
      flash(type, msg) {
        flashType = type;
        flashMsg = msg;
      },
    };
    const res = { redirect() {} };

    await paymentController.showPaymentPage(req, res, () => {});
    assert(flashType === "error" && flashMsg.includes("expired"), "Checkout blocked for expired reservation hold");

    const updatedExpired = await Booking.findById(expiredBooking._id);
    assert(updatedExpired.status === "expired", "Booking auto-transitioned to 'expired' status");
  }

  // Cleanup isolated test database
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();

  console.log("\n=======================================================");
  console.log("✅ ALL 9 PHASE 2 BOOKING AVAILABILITY TESTS PASSED (100%)!");
  console.log("=======================================================\n");
}

runAvailabilityTests().catch(async (err) => {
  console.error("Test execution error:", err);
  try {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
