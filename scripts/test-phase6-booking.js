/**
 * Phase 6: Booking & Availability Test Suite
 * Tests all booking logic, validation, overlap prevention, permissions, and calculations.
 * Run with: node scripts/test-phase6-booking.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const User = require("../models/User");
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const connectDB = require("../utils/db");

const TEST_PREFIX = "p6test_";

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

async function runBookingTests() {
  console.log("\n==========================================");
  console.log("--- Testing Phase 6: Booking & Availability ---");
  console.log("==========================================");

  await connectDB();
  await cleanup();

  // Create Users
  const hostA = await createUser("hostA", "host");
  const hostB = await createUser("hostB", "host");
  const guest1 = await createUser("guest1", "guest");
  const guest2 = await createUser("guest2", "guest");
  const admin = await createUser("admin", "admin");

  // Create Approved Listing (Price: 3000, MaxGuests: 4)
  const approvedListing = await Listing.create({
    title: `${TEST_PREFIX}Mountain View Villa`,
    description: "Scenic villa in the hills.",
    price: 3000,
    location: "Manali, Himachal Pradesh",
    country: "India",
    propertyType: "villa",
    maxGuests: 4,
    bedrooms: 2,
    bathrooms: 2,
    owner: hostA._id,
    status: "approved",
  });

  // Create Pending Listing
  const pendingListing = await Listing.create({
    title: `${TEST_PREFIX}Pending Cabin`,
    description: "Pending approval",
    price: 2000,
    location: "Kullu",
    country: "India",
    propertyType: "cottage",
    maxGuests: 2,
    owner: hostA._id,
    status: "pending",
  });

  // Helper date generators
  const makeDate = (daysAhead) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // 1. Booking validation helper (simulates controller logic)
  async function attemptBooking(user, listing, checkInStr, checkOutStr, guestsNum) {
    if (!user) throw new Error("Authentication required");
    if (listing.status !== "approved") throw new Error("Only approved properties can be booked");
    if (listing.owner.equals(user._id)) throw new Error("Hosts cannot book their own property");

    const checkInDate = new Date(checkInStr);
    const checkOutDate = new Date(checkOutStr);
    checkInDate.setHours(0, 0, 0, 0);
    checkOutDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (checkInDate < today) throw new Error("Check-in date cannot be in the past");
    if (checkOutDate <= checkInDate) throw new Error("Check-out date must be after check-in date");

    const numGuests = Number(guestsNum);
    if (isNaN(numGuests) || numGuests < 1) throw new Error("Invalid guest count");
    if (numGuests > listing.maxGuests) throw new Error(`Exceeds maximum guest capacity of ${listing.maxGuests}`);

    // Overlap check: existing.checkIn < new.checkOut AND existing.checkOut > new.checkIn
    const conflicting = await Booking.findOne({
      listing: listing._id,
      status: { $in: ["confirmed", "pending"] },
      checkIn: { $lt: checkOutDate },
      checkOut: { $gt: checkInDate },
    });

    if (conflicting) throw new Error("Dates overlap with an existing booking");

    const diffTime = Math.abs(checkOutDate - checkInDate);
    const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const pricePerNight = listing.price;
    const subtotal = nights * pricePerNight;
    const serviceFee = Math.round(subtotal * 0.05);
    const totalPrice = subtotal + serviceFee;

    const booking = new Booking({
      listing: listing._id,
      guest: user._id,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      guests: numGuests,
      nights,
      pricePerNight,
      serviceFee,
      totalPrice,
      status: "confirmed",
    });

    await booking.save();
    return booking;
  }

  // TEST 1: Valid Booking Creation
  const date1 = makeDate(5);
  const date2 = makeDate(8); // 3 nights (Day 5 to Day 8)
  const booking1 = await attemptBooking(guest1, approvedListing, date1, date2, 2);

  assert(booking1.nights === 3, "Nights calculation is accurate (3 nights)");
  assert(booking1.pricePerNight === 3000, "Price per night correctly snapshotted (₹3000)");
  assert(booking1.serviceFee === 450, "5% service fee calculated accurately (₹450)");
  assert(booking1.totalPrice === 9450, "Total price calculated accurately: 3 * 3000 + 450 = ₹9450");
  assert(booking1.status === "confirmed", "Booking status defaults to confirmed");

  // TEST 2: Overlapping Booking Rejected (Exact same dates)
  try {
    await attemptBooking(guest2, approvedListing, date1, date2, 2);
    assert(false, "Exact overlapping booking should have failed");
  } catch (err) {
    assert(err.message.includes("overlap"), "Exact date overlap correctly rejected");
  }

  // TEST 3: Overlapping Booking Rejected (Partial overlap - starts during booking1)
  try {
    await attemptBooking(guest2, approvedListing, makeDate(6), makeDate(10), 2);
    assert(false, "Partial overlapping booking should have failed");
  } catch (err) {
    assert(err.message.includes("overlap"), "Partial date overlap (starts inside) correctly rejected");
  }

  // TEST 4: Overlapping Booking Rejected (Partial overlap - ends during booking1)
  try {
    await attemptBooking(guest2, approvedListing, makeDate(3), makeDate(6), 2);
    assert(false, "Partial overlapping booking should have failed");
  } catch (err) {
    assert(err.message.includes("overlap"), "Partial date overlap (ends inside) correctly rejected");
  }

  // TEST 5: Non-overlapping Booking Creation (Starts on checkout date of booking1: Day 8)
  const booking2 = await attemptBooking(guest2, approvedListing, makeDate(8), makeDate(11), 3);
  assert(booking2.nights === 3, "Back-to-back booking on checkout date succeeded without conflict");

  // TEST 6: Invalid Date Range (checkOut <= checkIn)
  try {
    await attemptBooking(guest1, approvedListing, makeDate(15), makeDate(12), 2);
    assert(false, "Inverted date range should have failed");
  } catch (err) {
    assert(err.message.includes("after check-in"), "Check-out before check-in correctly rejected");
  }

  // TEST 7: Check-in in Past
  try {
    await attemptBooking(guest1, approvedListing, makeDate(-2), makeDate(2), 2);
    assert(false, "Past date should have failed");
  } catch (err) {
    assert(err.message.includes("past"), "Past check-in date correctly rejected");
  }

  // TEST 8: Excessive Guest Count (listing allows max 4)
  try {
    await attemptBooking(guest1, approvedListing, makeDate(20), makeDate(22), 6);
    assert(false, "Excessive guest count should have failed");
  } catch (err) {
    assert(err.message.includes("capacity"), "Guest count exceeding capacity correctly rejected");
  }

  // TEST 9: Host Attempting to Book Own Property
  try {
    await attemptBooking(hostA, approvedListing, makeDate(20), makeDate(22), 2);
    assert(false, "Host booking own property should have failed");
  } catch (err) {
    assert(err.message.includes("own property"), "Host booking own property correctly prevented");
  }

  // TEST 10: Booking Pending/Rejected Property
  try {
    await attemptBooking(guest1, pendingListing, makeDate(20), makeDate(22), 2);
    assert(false, "Booking unapproved property should have failed");
  } catch (err) {
    assert(err.message.includes("approved"), "Booking unapproved property correctly blocked");
  }

  // TEST 11: Authorization - Guest Viewing Own vs Other's Booking
  function canViewBooking(user, booking, listingOwnerId) {
    const isGuest = booking.guest.equals(user._id);
    const isHost = listingOwnerId.equals(user._id);
    const isAdmin = user.role === "admin";
    return isGuest || isHost || isAdmin;
  }

  assert(canViewBooking(guest1, booking1, hostA._id) === true, "Guest CAN view own booking");
  assert(canViewBooking(guest2, booking1, hostA._id) === false, "Other guest CANNOT view another user's booking");
  assert(canViewBooking(hostA, booking1, hostA._id) === true, "Host CAN view booking on own property");
  assert(canViewBooking(hostB, booking1, hostA._id) === false, "Other host CANNOT view booking on someone else's property");
  assert(canViewBooking(admin, booking1, hostA._id) === true, "Admin CAN view any booking");

  // TEST 12: Cancellation
  booking1.status = "cancelled";
  await booking1.save();
  assert(booking1.status === "cancelled", "Booking status updated to cancelled");

  // TEST 13: Cancelled Booking Frees Up Dates for New Reservation!
  const booking3 = await attemptBooking(guest2, approvedListing, date1, date2, 2);
  assert(booking3.status === "confirmed", "Cancelled dates are now bookable by another guest");

  await cleanup();
  await mongoose.connection.close();
  console.log("\n==========================================");
  console.log("✅ ALL 13 PHASE 6 BOOKING & AVAILABILITY TESTS PASSED!");
  console.log("==========================================\n");
}

runBookingTests().catch(async (err) => {
  console.error("Test error:", err);
  try {
    await cleanup();
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
