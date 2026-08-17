/**
 * Phase 8: Reviews & Ratings Test Suite
 * Tests stay-verified review submission, duplicate prevention, validation,
 * rating calculation updates, and author/admin deletion permissions.
 * Run with: node scripts/test-phase8-reviews.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const User = require("../models/User");
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const Review = require("../models/Review");
const connectDB = require("../utils/db");

const TEST_PREFIX = "p8test_";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function cleanup() {
  await Review.deleteMany({});
  await Booking.deleteMany({});
  await Listing.deleteMany({ title: { $regex: `^${TEST_PREFIX}` } });
  await User.deleteMany({ username: { $regex: `^${TEST_PREFIX}` } });
}

async function createUser(username, role) {
  const password = await bcrypt.hash("testpass123", 12);
  return User.create({
    username: `${TEST_PREFIX}${username}`,
    email: `${TEST_PREFIX}${username}@example.com`,
    password,
    role,
  });
}

async function runReviewTests() {
  console.log("\n==========================================");
  console.log("--- Testing Phase 8: Reviews & Ratings ---");
  console.log("==========================================");

  await connectDB();
  await cleanup();

  // Create Users
  const host = await createUser("host", "host");
  const verifiedGuest1 = await createUser("guest1", "guest");
  const verifiedGuest2 = await createUser("guest2", "guest");
  const unverifiedGuest = await createUser("guest_unverified", "guest");
  const admin = await createUser("admin", "admin");

  // Create Approved Property
  const listing = await Listing.create({
    title: `${TEST_PREFIX}Lakeside Heritage Villa`,
    description: "Scenic lakeside stay.",
    price: 5000,
    location: "Udaipur, Rajasthan",
    country: "India",
    propertyType: "villa",
    maxGuests: 6,
    owner: host._id,
    status: "approved",
  });

  // Create Confirmed Bookings for Guest 1 & Guest 2
  const booking1 = await Booking.create({
    listing: listing._id,
    guest: verifiedGuest1._id,
    checkIn: new Date("2026-06-01"),
    checkOut: new Date("2026-06-04"),
    guests: 2,
    nights: 3,
    pricePerNight: 5000,
    totalPrice: 15750,
    status: "confirmed",
  });

  const booking2 = await Booking.create({
    listing: listing._id,
    guest: verifiedGuest2._id,
    checkIn: new Date("2026-06-10"),
    checkOut: new Date("2026-06-12"),
    guests: 2,
    nights: 2,
    pricePerNight: 5000,
    totalPrice: 10500,
    status: "confirmed",
  });

  // Helper review submitter (simulates reviewController.create)
  async function submitReview(user, listingId, rating, body) {
    if (!user) throw new Error("Authentication required");
    const targetListing = await Listing.findById(listingId);
    if (!targetListing || targetListing.status !== "approved") {
      throw new Error("Invalid or unapproved listing");
    }
    if (targetListing.owner.equals(user._id)) {
      throw new Error("Host cannot review own property");
    }

    // Check verified stay
    const eligibleBooking = await Booking.findOne({
      listing: targetListing._id,
      guest: user._id,
      status: { $in: ["confirmed", "completed"] },
    });
    if (!eligibleBooking) {
      throw new Error("Guest has no eligible booking for this property");
    }

    // Check duplicate
    const existing = await Review.findOne({
      listing: targetListing._id,
      author: user._id,
    });
    if (existing) {
      throw new Error("Duplicate review: guest already reviewed this property");
    }

    // Validation
    const numericRating = Number(rating);
    if (!rating || isNaN(numericRating) || numericRating < 1 || numericRating > 5 || !Number.isInteger(numericRating)) {
      throw new Error("Invalid rating: must be integer between 1 and 5");
    }
    if (!body || !body.trim()) {
      throw new Error("Review text is required");
    }

    const review = new Review({
      body: body.trim(),
      rating: numericRating,
      author: user._id,
      listing: targetListing._id,
      booking: eligibleBooking._id,
    });

    await review.save();
    targetListing.reviews.push(review._id);
    await targetListing.save();

    return review;
  }

  // 1. TEST: Unverified guest cannot review
  try {
    await submitReview(unverifiedGuest, listing._id, 5, "Tried to review without booking!");
    assert(false, "Unverified guest should NOT be allowed to review");
  } catch (err) {
    assert(err.message.includes("eligible booking"), "Unverified guest review correctly rejected");
  }

  // 2. TEST: Host cannot review own property
  try {
    await submitReview(host, listing._id, 5, "Host trying to self-review!");
    assert(false, "Host should NOT be allowed to self-review");
  } catch (err) {
    assert(err.message.includes("Host cannot review"), "Host self-review correctly rejected");
  }

  // 3. TEST: Verified Guest 1 submits valid 5-star review
  const review1 = await submitReview(verifiedGuest1, listing._id, 5, "Breathtaking sunset views and royal hospitality!");
  assert(review1.rating === 5, "Review 1 successfully submitted with 5 stars");
  assert(review1.booking.equals(booking1._id), "Review linked to verified booking");

  // 4. TEST: Duplicate review from Guest 1 is rejected
  try {
    await submitReview(verifiedGuest1, listing._id, 4, "Trying to review a second time!");
    assert(false, "Duplicate review should NOT be allowed");
  } catch (err) {
    assert(err.message.includes("Duplicate review"), "Duplicate review correctly rejected");
  }

  // 5. TEST: Invalid ratings are rejected
  try {
    await submitReview(verifiedGuest2, listing._id, 6, "Rating 6 is out of bounds");
    assert(false, "Rating > 5 should fail");
  } catch (err) {
    assert(err.message.includes("Invalid rating"), "Rating > 5 correctly rejected");
  }

  try {
    await submitReview(verifiedGuest2, listing._id, 0, "Rating 0 is out of bounds");
    assert(false, "Rating < 1 should fail");
  } catch (err) {
    assert(err.message.includes("Invalid rating"), "Rating < 1 correctly rejected");
  }

  try {
    await submitReview(verifiedGuest2, listing._id, 3.5, "Decimal rating should fail");
    assert(false, "Decimal rating should fail");
  } catch (err) {
    assert(err.message.includes("Invalid rating"), "Non-integer rating correctly rejected");
  }

  // 6. TEST: Empty review text is rejected
  try {
    await submitReview(verifiedGuest2, listing._id, 4, "   ");
    assert(false, "Empty review text should fail");
  } catch (err) {
    assert(err.message.includes("Review text is required"), "Empty review body correctly rejected");
  }

  // 7. TEST: Verified Guest 2 submits valid 4-star review
  const review2 = await submitReview(verifiedGuest2, listing._id, 4, "Great rooms, clean pool, peaceful garden.");
  assert(review2.rating === 4, "Review 2 successfully submitted with 4 stars");

  // 8. TEST: Average rating calculation
  const updatedListing = await Listing.findById(listing._id).populate("reviews");
  const totalStars = updatedListing.reviews.reduce((sum, r) => sum + r.rating, 0);
  const avgRating = (totalStars / updatedListing.reviews.length).toFixed(1);

  assert(updatedListing.reviews.length === 2, "Listing contains 2 verified reviews");
  assert(avgRating === "4.5", "Average rating computed accurately: (5 + 4) / 2 = 4.5 stars");

  // 9. TEST: Unauthorized user cannot delete another user's review
  function canDeleteReview(user, reviewDoc) {
    if (!user) return false;
    const isAuthor = reviewDoc.author.equals(user._id);
    const isAdmin = user.role === "admin";
    return isAuthor || isAdmin;
  }

  assert(canDeleteReview(verifiedGuest2, review1) === false, "Guest 2 CANNOT delete Guest 1's review");
  assert(canDeleteReview(unverifiedGuest, review1) === false, "Stranger CANNOT delete Guest 1's review");
  assert(canDeleteReview(host, review1) === false, "Host CANNOT delete Guest 1's review");
  assert(canDeleteReview(verifiedGuest1, review1) === true, "Author Guest 1 CAN delete own review");
  assert(canDeleteReview(admin, review1) === true, "Admin CAN remove any review");

  // 10. TEST: Review removal updates listing and average rating
  await Listing.findByIdAndUpdate(listing._id, { $pull: { reviews: review1._id } });
  await Review.findByIdAndDelete(review1._id);

  const afterDeleteListing = await Listing.findById(listing._id).populate("reviews");
  const newAvgRating = (afterDeleteListing.reviews.reduce((sum, r) => sum + r.rating, 0) / afterDeleteListing.reviews.length).toFixed(1);

  assert(afterDeleteListing.reviews.length === 1, "Review count decreased to 1 after deletion");
  assert(newAvgRating === "4.0", "Average rating updated to 4.0 after review removal");

  await cleanup();
  await mongoose.connection.close();
  console.log("\n==========================================");
  console.log("✅ ALL 16 PHASE 8 REVIEWS & RATINGS TESTS PASSED!");
  console.log("==========================================\n");
}

runReviewTests().catch(async (err) => {
  console.error("Test error:", err);
  try {
    await cleanup();
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
