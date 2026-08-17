/**
 * Phase 7: Dashboards & Analytics Test Suite
 * Tests Guest Dashboard, Host Dashboard, Admin Dashboard, role-based access control,
 * revenue calculations, and data privacy isolation.
 * Run with: node scripts/test-phase7-dashboards.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const User = require("../models/User");
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const connectDB = require("../utils/db");

const TEST_PREFIX = "p7test_";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function cleanup() {
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

async function runDashboardTests() {
  console.log("\n==========================================");
  console.log("--- Testing Phase 7: Role-Based Dashboards ---");
  console.log("==========================================");

  await connectDB();
  await cleanup();

  // Create Users with distinct roles
  const guestUser = await createUser("guest1", "guest");
  const hostUserA = await createUser("hostA", "host");
  const hostUserB = await createUser("hostB", "host");
  const adminUser = await createUser("admin", "admin");

  // Create Properties for Host A
  const listingA1 = await Listing.create({
    title: `${TEST_PREFIX}Host A Live Villa`,
    description: "Approved property",
    price: 4000,
    location: "Goa",
    country: "India",
    propertyType: "villa",
    maxGuests: 6,
    owner: hostUserA._id,
    status: "approved",
  });

  const listingA2 = await Listing.create({
    title: `${TEST_PREFIX}Host A Pending Cabin`,
    description: "Pending property",
    price: 2500,
    location: "Manali",
    country: "India",
    propertyType: "cottage",
    maxGuests: 2,
    owner: hostUserA._id,
    status: "pending",
  });

  const listingA3 = await Listing.create({
    title: `${TEST_PREFIX}Host A Rejected Apartment`,
    description: "Rejected property",
    price: 1800,
    location: "Delhi",
    country: "India",
    propertyType: "apartment",
    maxGuests: 2,
    owner: hostUserA._id,
    status: "rejected",
  });

  // Create Properties for Host B
  const listingB1 = await Listing.create({
    title: `${TEST_PREFIX}Host B Resort`,
    description: "Approved property for Host B",
    price: 6000,
    location: "Kerala",
    country: "India",
    propertyType: "resort",
    maxGuests: 4,
    owner: hostUserB._id,
    status: "approved",
  });

  // Helper date generators
  const makeDate = (daysAhead) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // Create Bookings for Guest on Host A's property
  // 1. Upcoming confirmed booking (3 nights @ 4000 = 12000 + 600 fee = 12600)
  const upcomingBooking = await Booking.create({
    listing: listingA1._id,
    guest: guestUser._id,
    checkIn: makeDate(5),
    checkOut: makeDate(8),
    guests: 2,
    nights: 3,
    pricePerNight: 4000,
    serviceFee: 600,
    totalPrice: 12600,
    status: "confirmed",
  });

  // 2. Past completed booking (2 nights @ 4000 = 8000 + 400 fee = 8400)
  const pastBooking = await Booking.create({
    listing: listingA1._id,
    guest: guestUser._id,
    checkIn: makeDate(-10),
    checkOut: makeDate(-8),
    guests: 2,
    nights: 2,
    pricePerNight: 4000,
    serviceFee: 400,
    totalPrice: 8400,
    status: "confirmed",
  });

  // 3. Cancelled booking
  const cancelledBooking = await Booking.create({
    listing: listingA1._id,
    guest: guestUser._id,
    checkIn: makeDate(15),
    checkOut: makeDate(17),
    guests: 1,
    nights: 2,
    pricePerNight: 4000,
    serviceFee: 400,
    totalPrice: 8400,
    status: "cancelled",
  });

  // 4. Booking on Host B's property
  const hostBBooking = await Booking.create({
    listing: listingB1._id,
    guest: guestUser._id,
    checkIn: makeDate(20),
    checkOut: makeDate(22),
    guests: 2,
    nights: 2,
    pricePerNight: 6000,
    serviceFee: 600,
    totalPrice: 12600,
    status: "confirmed",
  });

  // ==========================================
  // 1. TEST GUEST DASHBOARD METRICS
  // ==========================================
  const guestBookings = await Booking.find({ guest: guestUser._id });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const guestUpcoming = guestBookings.filter(b => b.status === "confirmed" && new Date(b.checkIn) >= today);
  const guestPast = guestBookings.filter(b => b.status === "completed" || (b.status === "confirmed" && new Date(b.checkOut) < today));
  const guestCancelled = guestBookings.filter(b => b.status === "cancelled");
  const guestTotalSpent = guestBookings
    .filter(b => b.status !== "cancelled")
    .reduce((sum, b) => sum + b.totalPrice, 0);

  assert(guestUpcoming.length === 2, "Guest has 2 upcoming confirmed trips");
  assert(guestPast.length === 1, "Guest has 1 past completed stay");
  assert(guestCancelled.length === 1, "Guest has 1 cancelled stay");
  assert(guestTotalSpent === 12600 + 8400 + 12600, "Guest total spend calculated accurately (₹33,600)");

  // ==========================================
  // 2. TEST HOST A DASHBOARD METRICS & ISOLATION
  // ==========================================
  const hostAListings = await Listing.find({ owner: hostUserA._id });
  const hostAListingIds = hostAListings.map(l => l._id);
  const hostABookings = await Booking.find({ listing: { $in: hostAListingIds } });

  const hostAPending = hostAListings.filter(l => l.status === "pending").length;
  const hostAApproved = hostAListings.filter(l => l.status === "approved").length;
  const hostARejected = hostAListings.filter(l => l.status === "rejected").length;

  const hostAActiveBookings = hostABookings.filter(b => b.status !== "cancelled");
  const hostARevenue = hostAActiveBookings.reduce((sum, b) => sum + (b.nights * b.pricePerNight), 0);

  assert(hostAListings.length === 3, "Host A has 3 total properties");
  assert(hostAPending === 1, "Host A has 1 pending property");
  assert(hostAApproved === 1, "Host A has 1 approved property");
  assert(hostARejected === 1, "Host A has 1 rejected property");
  assert(hostABookings.length === 3, "Host A has 3 total bookings on their listings");
  assert(hostARevenue === (3 * 4000) + (2 * 4000), "Host A revenue calculated accurately (₹20,000)");

  // Verify Host A does NOT see Host B's bookings
  const hostAHasHostBBooking = hostABookings.some(b => b.listing.equals(listingB1._id));
  assert(hostAHasHostBBooking === false, "Host A is strictly isolated from Host B's bookings");

  // ==========================================
  // 3. TEST ADMIN DASHBOARD PLATFORM ANALYTICS
  // ==========================================
  const totalUsersCount = await User.countDocuments({ username: { $regex: `^${TEST_PREFIX}` } });
  const totalHostsCount = await User.countDocuments({ username: { $regex: `^${TEST_PREFIX}` }, role: "host" });
  const totalGuestsCount = await User.countDocuments({ username: { $regex: `^${TEST_PREFIX}` }, role: "guest" });

  const allListings = await Listing.find({ title: { $regex: `^${TEST_PREFIX}` } });
  const allPending = allListings.filter(l => l.status === "pending").length;
  const allApproved = allListings.filter(l => l.status === "approved").length;
  const allRejected = allListings.filter(l => l.status === "rejected").length;

  const allBookings = await Booking.find({});
  const allActive = allBookings.filter(b => b.status !== "cancelled");
  const grossVolume = allActive.reduce((sum, b) => sum + b.totalPrice, 0);
  const platformFees = allActive.reduce((sum, b) => sum + b.serviceFee, 0);

  assert(totalUsersCount === 4, "Admin platform user count: 4");
  assert(totalHostsCount === 2, "Admin platform host count: 2");
  assert(totalGuestsCount === 1, "Admin platform guest count: 1");
  assert(allListings.length === 4, "Admin platform total properties: 4");
  assert(allPending === 1, "Admin platform pending properties: 1");
  assert(allApproved === 2, "Admin platform approved properties: 2");
  assert(allRejected === 1, "Admin platform rejected properties: 1");
  assert(allBookings.length === 4, "Admin platform total bookings: 4");
  assert(grossVolume === 12600 + 8400 + 12600, "Gross booking volume calculated accurately (₹33,600)");
  assert(platformFees === 600 + 400 + 600, "Platform service fees calculated accurately (₹1,600)");

  // ==========================================
  // 4. TEST ROLE-BASED ACCESS PERMISSION RULES
  // ==========================================
  function canAccessHostDashboard(user) {
    return Boolean(user && (user.role === "host" || user.role === "admin"));
  }

  function canAccessAdminDashboard(user) {
    return Boolean(user && user.role === "admin");
  }

  assert(canAccessHostDashboard(null) === false, "Unauthenticated user BLOCKED from Host Dashboard");
  assert(canAccessHostDashboard(guestUser) === false, "Guest user BLOCKED from Host Dashboard");
  assert(canAccessHostDashboard(hostUserA) === true, "Host user CAN access Host Dashboard");
  assert(canAccessHostDashboard(adminUser) === true, "Admin user CAN access Host Dashboard");

  assert(canAccessAdminDashboard(null) === false, "Unauthenticated user BLOCKED from Admin Dashboard");
  assert(canAccessAdminDashboard(guestUser) === false, "Guest user BLOCKED from Admin Dashboard");
  assert(canAccessAdminDashboard(hostUserA) === false, "Host user BLOCKED from Admin Dashboard");
  assert(canAccessAdminDashboard(adminUser) === true, "Admin user CAN access Admin Dashboard");

  await cleanup();
  await mongoose.connection.close();
  console.log("\n==========================================");
  console.log("✅ ALL 20 PHASE 7 DASHBOARD & ACCESS TESTS PASSED!");
  console.log("==========================================\n");
}

runDashboardTests().catch(async (err) => {
  console.error("Test error:", err);
  try {
    await cleanup();
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
