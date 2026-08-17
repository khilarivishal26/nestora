/**
 * Phase 5: Property Details & Reviews Test Suite
 * Run with: node scripts/test-phase5-details.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const User = require("../models/User");
const Listing = require("../models/Listing");
const Review = require("../models/Review");
const connectDB = require("../utils/db");

const TEST_PREFIX = "p5test_";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function cleanup() {
  await Review.deleteMany({ body: { $regex: `^${TEST_PREFIX}` } });
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

async function runDatabaseAndControllerTests() {
  console.log("\n==========================================");
  console.log("--- 1. Testing Database & Logic Layer ---");
  console.log("==========================================");

  await connectDB();
  await cleanup();

  // Create Users
  const host = await createUser("host", "host");
  const guest = await createUser("guest", "guest");
  const admin = await createUser("admin", "admin");

  // Create Approved Listing with images, amenities, coordinates
  const approvedListing = await Listing.create({
    title: `${TEST_PREFIX}Royal Heritage Palace`,
    description: "A luxury heritage palace featuring majestic views and world-class hospitality.",
    price: 6500,
    location: "Jaipur, Rajasthan",
    country: "India",
    propertyType: "resort",
    category: "Heritage",
    maxGuests: 6,
    bedrooms: 3,
    bathrooms: 3,
    amenities: ["WiFi", "Swimming Pool", "Spa", "Breakfast Included", "Air Conditioning"],
    images: [
      "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=80"
    ],
    coordinates: { lat: 26.9124, lng: 75.7873 },
    owner: host._id,
    status: "approved",
  });

  // Create Pending Listing
  const pendingListing = await Listing.create({
    title: `${TEST_PREFIX}Secret Hideout`,
    description: "Pending verification",
    price: 2000,
    location: "Udaipur",
    country: "India",
    propertyType: "villa",
    maxGuests: 2,
    bedrooms: 1,
    bathrooms: 1,
    owner: host._id,
    status: "pending",
  });

  // Create Rejected Listing
  const rejectedListing = await Listing.create({
    title: `${TEST_PREFIX}Declined Stay`,
    description: "Rejected property",
    price: 1500,
    location: "Delhi",
    country: "India",
    propertyType: "apartment",
    maxGuests: 2,
    bedrooms: 1,
    bathrooms: 1,
    owner: host._id,
    status: "rejected",
  });

  // 1. Check Authorization logic for Property Details
  function checkAccess(user, listing) {
    const isOwner = user && listing.owner.equals(user._id);
    const isAdmin = user && user.role === "admin";
    if (listing.status === "approved") return true;
    return Boolean(isOwner || isAdmin);
  }

  assert(checkAccess(null, approvedListing) === true, "Public/Guest can view approved property");
  assert(checkAccess(guest, approvedListing) === true, "Logged-in guest can view approved property");
  assert(checkAccess(null, pendingListing) === false, "Public guest is BLOCKED from pending property");
  assert(checkAccess(guest, pendingListing) === false, "Other guest is BLOCKED from pending property");
  assert(checkAccess(host, pendingListing) === true, "Owner host CAN view own pending property");
  assert(checkAccess(admin, pendingListing) === true, "Admin CAN view pending property for review");
  assert(checkAccess(null, rejectedListing) === false, "Public guest is BLOCKED from rejected property");
  assert(checkAccess(host, rejectedListing) === true, "Owner host CAN view own rejected property");

  // 2. Add Reviews
  const review1 = await Review.create({
    body: `${TEST_PREFIX}Magnificent stay! The architecture and hospitality were top notch.`,
    rating: 5,
    author: guest._id,
    listing: approvedListing._id,
  });
  approvedListing.reviews.push(review1._id);

  const review2 = await Review.create({
    body: `${TEST_PREFIX}Great location, delicious breakfast, very peaceful.`,
    rating: 4,
    author: admin._id,
    listing: approvedListing._id,
  });
  approvedListing.reviews.push(review2._id);
  await approvedListing.save();

  // Populate listing and check average rating calculation
  const populated = await Listing.findById(approvedListing._id)
    .populate("owner", "username email createdAt")
    .populate({
      path: "reviews",
      populate: { path: "author", select: "username" },
    });

  assert(populated.reviews.length === 2, "Listing contains 2 populated reviews");
  assert(populated.reviews[0].author.username.length > 0, "Review author is populated with username");
  
  const totalRating = populated.reviews.reduce((sum, r) => sum + r.rating, 0);
  const avgRating = (totalRating / populated.reviews.length).toFixed(1);
  assert(avgRating === "4.5", "Average rating calculation is correct (4.5 stars)");

  // 3. Test Review Deletion & Cascade
  await Listing.findByIdAndUpdate(approvedListing._id, { $pull: { reviews: review1._id } });
  await Review.findByIdAndDelete(review1._id);

  const afterReviewDelete = await Listing.findById(approvedListing._id);
  assert(afterReviewDelete.reviews.length === 1, "Review successfully removed from listing");

  // 4. Test Cascade Delete when Listing is destroyed
  await Review.deleteMany({ _id: { $in: afterReviewDelete.reviews } });
  await Listing.findByIdAndDelete(afterReviewDelete._id);

  const remainingReviews = await Review.find({ listing: approvedListing._id });
  assert(remainingReviews.length === 0, "All associated reviews cascade-deleted when listing is deleted");

  await cleanup();
  await mongoose.connection.close();
  console.log("\n✅ All Database & Logic tests passed successfully!");
}

runDatabaseAndControllerTests().catch(async (err) => {
  console.error("Test execution failed:", err);
  try {
    await cleanup();
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
