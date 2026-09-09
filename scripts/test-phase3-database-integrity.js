/**
 * Phase 3: Database Integrity, Performance & Soft-Deletion Test Suite
 * Runs against an isolated test database to verify:
 * 1. Indexes for listings, bookings, reviews, and payments
 * 2. Strict enforcement of 1 review per eligible guest/stay
 * 3. Unique payment and order constraints
 * 4. Safe soft deletion of listings preserving full booking & payment history
 * 5. Host & Admin financial dashboards counting ONLY paid bookings
 * 6. Query pagination and limit controls
 *
 * Run with: node scripts/test-phase3-database-integrity.js
 */

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

process.env.NODE_ENV = "test";
const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/nestora_test_integrity_sec";

const User = require("../models/User");
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const Review = require("../models/Review");
const Payment = require("../models/Payment");
const listingController = require("../controllers/listingController");
const reviewController = require("../controllers/reviewController");
const hostController = require("../controllers/hostController");
const adminController = require("../controllers/adminController");

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function runIntegrityTests() {
  console.log("\n=======================================================");
  console.log("--- NESTORA: PHASE 3 DATABASE INTEGRITY & PERFORMANCE ---");
  console.log("=======================================================\n");

  await mongoose.connect(TEST_DB_URI, { dbName: "nestora_test_integrity_sec" });
  console.log(`Connected to isolated test DB: ${mongoose.connection.name}`);

  await mongoose.connection.dropDatabase();

  // Initialize schema indexes
  await Promise.all([
    Listing.init(),
    Booking.init(),
    Review.init(),
    Payment.init(),
    User.init(),
  ]);

  const passwordHash = await bcrypt.hash("pass123", 10);

  const host = await User.create({
    username: "integ_host",
    email: "integ_host@test.com",
    password: passwordHash,
    role: "host",
  });

  const guest = await User.create({
    username: "integ_guest",
    email: "integ_guest@test.com",
    password: passwordHash,
    role: "guest",
  });

  const admin = await User.create({
    username: "integ_admin",
    email: "integ_admin@test.com",
    password: passwordHash,
    role: "admin",
  });

  const listing = await Listing.create({
    title: "Tranquil Oasis Villa",
    description: "Private oasis with heated pool.",
    price: 8000,
    location: "Udaipur",
    country: "India",
    propertyType: "villa",
    maxGuests: 6,
    owner: host._id,
    status: "approved",
  });

  console.log("--- TEST 1: SCHEMA INDEXES VALIDATION ---");
  {
    const listingIndexes = await Listing.collection.indexes();
    const hasListingStatusIdx = listingIndexes.some(
      (idx) => idx.key.status === 1 && idx.key.isDeleted === 1
    );
    assert(hasListingStatusIdx, "Listing compound index (status, isDeleted) active");

    const reviewIndexes = await Review.collection.indexes();
    const hasReviewUniqueIdx = reviewIndexes.some(
      (idx) => idx.key.listing === 1 && idx.key.author === 1 && idx.unique === true
    );
    assert(hasReviewUniqueIdx, "Review compound unique index (listing, author) active");

    const paymentIndexes = await Payment.collection.indexes();
    const hasPaymentBookingUnique = paymentIndexes.some(
      (idx) => idx.key.booking === 1 && idx.unique === true
    );
    const hasPaymentIdUnique = paymentIndexes.some(
      (idx) => idx.key.razorpayPaymentId === 1 && idx.unique === true
    );
    assert(hasPaymentBookingUnique, "Payment unique index (booking) active");
    assert(hasPaymentIdUnique, "Payment sparse unique index (razorpayPaymentId) active");
  }

  console.log("\n--- TEST 2: ENFORCE 1 REVIEW PER GUEST PER STAY ---");
  {
    // Create confirmed/completed booking for guest
    const completedBooking = await Booking.create({
      listing: listing._id,
      guest: guest._id,
      checkIn: new Date("2026-08-01"),
      checkOut: new Date("2026-08-05"),
      guests: 2,
      nights: 4,
      pricePerNight: 8000,
      totalPrice: 32000,
      status: "completed",
      paymentStatus: "paid",
    });

    // First review attempt -> should succeed
    let flashType1 = null;
    const req1 = {
      params: { id: listing._id.toString() },
      user: guest,
      body: { rating: "5", body: "Incredible stay, pristine views!" },
      flash(type) {
        flashType1 = type;
      },
    };
    const res1 = { redirect() {} };
    await reviewController.create(req1, res1, () => {});
    assert(flashType1 === "success", "First review by eligible verified guest succeeded");

    // Second review attempt -> must be blocked
    let flashType2 = null;
    let flashMsg2 = null;
    const req2 = {
      params: { id: listing._id.toString() },
      user: guest,
      body: { rating: "4", body: "Second attempt review." },
      flash(type, msg) {
        flashType2 = type;
        flashMsg2 = msg;
      },
    };
    const res2 = { redirect() {} };
    await reviewController.create(req2, res2, () => {});
    assert(flashType2 === "error" && flashMsg2.includes("Duplicate reviews are not allowed"), "Second review by same guest blocked by duplicate check");

    // Test database unique constraint directly
    try {
      await Review.create({
        listing: listing._id,
        author: guest._id,
        rating: 5,
        body: "Direct DB duplicate insert",
      });
      assert(false, "Direct duplicate review insert should fail with unique index error");
    } catch (err) {
      assert(err.code === 11000, "Database unique compound index strictly prevented duplicate review");
    }
  }

  console.log("\n--- TEST 3: PAYMENT RECORD UNIQUE CONSTRAINT ---");
  {
    const testBooking = await Booking.create({
      listing: listing._id,
      guest: guest._id,
      checkIn: new Date("2026-09-01"),
      checkOut: new Date("2026-09-03"),
      guests: 2,
      nights: 2,
      pricePerNight: 8000,
      totalPrice: 16000,
      status: "confirmed",
      paymentStatus: "paid",
    });

    const payment1 = await Payment.create({
      booking: testBooking._id,
      guest: guest._id,
      listing: listing._id,
      amount: 16000,
      status: "succeeded",
      razorpayPaymentId: "pay_uniq_001",
    });
    assert(payment1 && payment1._id, "First payment record saved successfully");

    try {
      await Payment.create({
        booking: testBooking._id,
        guest: guest._id,
        listing: listing._id,
        amount: 16000,
        status: "succeeded",
        razorpayPaymentId: "pay_uniq_002",
      });
      assert(false, "Duplicate payment for same booking should fail unique constraint");
    } catch (err) {
      assert(err.code === 11000, "Duplicate payment for same booking prevented by unique index");
    }
  }

  console.log("\n--- TEST 4: SOFT DELETION PRESERVES BOOKINGS & REVIEWS ---");
  {
    // Host deactivates/deletes listing
    const req = {
      listing,
      flash() {},
    };
    const res = { redirect() {} };
    await listingController.destroy(req, res, () => {});

    const deactivated = await Listing.findById(listing._id);
    assert(deactivated.isDeleted === true, "Listing marked isDeleted = true");
    assert(deactivated.status === "archived", "Listing status set to archived");

    // Verify bookings, reviews, and payments still exist in DB
    const existingBookings = await Booking.find({ listing: listing._id });
    const existingReviews = await Review.find({ listing: listing._id });
    const existingPayments = await Payment.find({ listing: listing._id });

    assert(existingBookings.length >= 2, "All historical bookings remain preserved in database");
    assert(existingReviews.length >= 1, "All historical reviews remain preserved in database");
    assert(existingPayments.length >= 1, "All financial payment records remain preserved in database");
  }

  console.log("\n--- TEST 5: FINANCIAL DASHBOARDS COUNT ONLY PAID BOOKINGS ---");
  {
    const activeHostListing = await Listing.create({
      title: "Active Mountain Villa",
      description: "Active stay.",
      price: 5000,
      location: "Shimla",
      country: "India",
      propertyType: "villa",
      maxGuests: 4,
      owner: host._id,
      status: "approved",
    });

    // 1. Paid booking (₹10,000)
    await Booking.create({
      listing: activeHostListing._id,
      guest: guest._id,
      checkIn: new Date("2026-10-01"),
      checkOut: new Date("2026-10-03"),
      guests: 2,
      nights: 2,
      pricePerNight: 5000,
      totalPrice: 10000,
      serviceFee: 500,
      platformCommission: 500,
      hostEarnings: 9500,
      status: "confirmed",
      paymentStatus: "paid",
    });

    // 2. Unpaid pending booking (₹15,000) -> should NOT be counted in revenue
    await Booking.create({
      listing: activeHostListing._id,
      guest: guest._id,
      checkIn: new Date("2026-10-10"),
      checkOut: new Date("2026-10-13"),
      guests: 2,
      nights: 3,
      pricePerNight: 5000,
      totalPrice: 15000,
      serviceFee: 750,
      platformCommission: 750,
      hostEarnings: 14250,
      status: "pending",
      paymentStatus: "pending",
    });

    // 3. Cancelled booking (₹20,000) -> should NOT be counted in revenue
    await Booking.create({
      listing: activeHostListing._id,
      guest: guest._id,
      checkIn: new Date("2026-10-20"),
      checkOut: new Date("2026-10-24"),
      guests: 2,
      nights: 4,
      pricePerNight: 5000,
      totalPrice: 20000,
      serviceFee: 1000,
      platformCommission: 1000,
      hostEarnings: 19000,
      status: "cancelled",
      paymentStatus: "pending",
    });

    let renderedData = null;
    const req = {
      user: host,
    };
    const res = {
      render(view, data) {
        renderedData = data;
      },
    };

    await hostController.dashboard(req, res, () => {});
    assert(
      renderedData.grossBookings === 10000,
      `Host gross revenue counts ONLY paid bookings: expected ₹10,000, got ₹${renderedData.grossBookings}`
    );
    assert(
      renderedData.netHostEarnings === 9500,
      `Host net earnings accurate: expected ₹9,500, got ₹${renderedData.netHostEarnings}`
    );
  }

  console.log("\n--- TEST 6: PAGINATION ON EXPLORE STAYS ---");
  {
    // Create 15 listings for pagination
    const bulkListings = [];
    for (let i = 1; i <= 15; i++) {
      bulkListings.push({
        title: `Pagination Stay ${i}`,
        description: `Luxury property #${i}`,
        price: 3000 + i * 200,
        location: "Kerala",
        country: "India",
        propertyType: "resort",
        maxGuests: 4,
        owner: host._id,
        status: "approved",
      });
    }
    await Listing.insertMany(bulkListings);

    let page1Data = null;
    const reqPage1 = {
      query: { limit: "5", page: "1" },
    };
    const resPage1 = {
      render(view, data) {
        page1Data = data;
      },
    };
    await listingController.index(reqPage1, resPage1, () => {});

    assert(page1Data.listings.length === 5, "Page 1 returns exactly 5 listings");
    assert(page1Data.currentPage === 1, "Current page is 1");
    assert(page1Data.totalPages >= 3, `Total pages calculated accurately (got ${page1Data.totalPages})`);
    assert(page1Data.hasNext === true, "hasNext is true on page 1");
    assert(page1Data.hasPrev === false, "hasPrev is false on page 1");
  }

  // Cleanup isolated test database
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();

  console.log("\n=======================================================");
  console.log("✅ ALL 6 PHASE 3 INTEGRITY & PERFORMANCE TESTS PASSED (100%)!");
  console.log("=======================================================\n");
}

runIntegrityTests().catch(async (err) => {
  console.error("Integrity test execution error:", err);
  try {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
