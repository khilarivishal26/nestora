/**
 * Phase 3 access-control smoke tests.
 *
 * Run with: node scripts/test-phase3-access.js
 * Requires MONGODB_URI in .env (same as the main app).
 *
 * Creates temporary users/listings, verifies public vs owner vs admin visibility,
 * then cleans up test data.
 */

require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Listing = require("../models/Listing");
const User = require("../models/User");
const connectDB = require("../utils/db");

const TEST_PREFIX = "phase3test_";

async function cleanup() {
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  await connectDB();
  await cleanup();

  const guest = await createUser("guest", "guest");
  const host = await createUser("host", "host");
  const admin = await createUser("admin", "admin");

  const pendingListing = await Listing.create({
    title: `${TEST_PREFIX}pending_villa`,
    description: "Test pending listing",
    price: 2500,
    location: "Goa",
    country: "India",
    propertyType: "villa",
    maxGuests: 4,
    owner: host._id,
    status: "pending",
  });

  const approvedListing = await Listing.create({
    title: `${TEST_PREFIX}approved_cottage`,
    description: "Test approved listing",
    price: 1800,
    location: "Manali",
    country: "India",
    propertyType: "cottage",
    maxGuests: 2,
    owner: host._id,
    status: "approved",
  });

  const rejectedListing = await Listing.create({
    title: `${TEST_PREFIX}rejected_apartment`,
    description: "Test rejected listing",
    price: 1200,
    location: "Mumbai",
    country: "India",
    propertyType: "apartment",
    maxGuests: 2,
    owner: host._id,
    status: "rejected",
  });

  // Public browse: approved only
  const publicListings = await Listing.find({ status: "approved" });
  assert(
    publicListings.some((l) => l._id.equals(approvedListing._id)),
    "Approved listing should appear in public query"
  );
  assert(
    !publicListings.some((l) => l._id.equals(pendingListing._id)),
    "Pending listing must not appear in public query"
  );
  assert(
    !publicListings.some((l) => l._id.equals(rejectedListing._id)),
    "Rejected listing must not appear in public query"
  );

  // Host sees all own listings regardless of status
  const hostListings = await Listing.find({ owner: host._id });
  assert(hostListings.length >= 3, "Host should see all own listings");

  // Simulated visibility rules from listingController.show
  function canViewListing(user, listing) {
    const isOwner = user && listing.owner.equals(user._id);
    const isAdmin = user && user.role === "admin";
    if (listing.status === "approved") return true;
    return isOwner || isAdmin;
  }

  assert(!canViewListing(null, pendingListing), "Guest cannot view pending listing");
  assert(!canViewListing(guest, pendingListing), "Guest user cannot view pending listing");
  assert(canViewListing(host, pendingListing), "Host can view own pending listing");
  assert(canViewListing(admin, pendingListing), "Admin can view pending listing");
  assert(canViewListing(null, approvedListing), "Anyone can view approved listing");
  assert(!canViewListing(null, rejectedListing), "Guest cannot view rejected listing");
  assert(canViewListing(host, rejectedListing), "Host can view own rejected listing");

  // Admin approval workflow
  pendingListing.status = "approved";
  await pendingListing.save();

  const afterApprove = await Listing.findById(pendingListing._id);
  assert(afterApprove.status === "approved", "Admin approve should set status to approved");

  approvedListing.status = "rejected";
  await approvedListing.save();

  const afterReject = await Listing.findById(approvedListing._id);
  assert(afterReject.status === "rejected", "Admin reject should set status to rejected");

  console.log("Phase 3 access tests passed.");
  await cleanup();
  await mongoose.connection.close();
}

runTests().catch(async (err) => {
  console.error("Phase 3 access tests failed:", err.message);
  try {
    await cleanup();
    await mongoose.connection.close();
  } catch (e) {
    /* ignore cleanup errors */
  }
  process.exit(1);
});
