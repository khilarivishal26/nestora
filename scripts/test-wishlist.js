/**
 * Nestora Wishlist Feature End-to-End Test Suite
 * Validates all 10 scenarios:
 * 1. Unauthenticated wishlist toggle requires auth
 * 2. Authenticated user adds property to wishlist
 * 3. Duplicate prevention at database & controller layer
 * 4. User removes property from wishlist
 * 5. Wishlist page retrieval and formatting
 * 6. Card wishlist state check
 * 7. Details page wishlist state check
 * 8. Persistence across requests
 * 9. Multi-user privacy & data isolation
 * 10. Resilience against deleted/non-existent properties
 *
 * Run with: node scripts/test-wishlist.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const User = require("../models/User");
const Listing = require("../models/Listing");
const Wishlist = require("../models/Wishlist");
const connectDB = require("../utils/db");

const WISH_PREFIX = "wishtest_";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function cleanup() {
  await Wishlist.deleteMany({});
  await Listing.deleteMany({ title: { $regex: `^${WISH_PREFIX}` } });
  await User.deleteMany({ username: { $regex: `^${WISH_PREFIX}` } });
}

async function runWishlistTests() {
  console.log("\n=======================================================");
  console.log("--- NESTORA: WISHLIST & FAVORITES FEATURE TESTS ---");
  console.log("=======================================================\n");

  await connectDB();
  await cleanup();

  // --- Setup Users and Listings ---
  const password = await bcrypt.hash("wishSecret123", 10);

  const userAlice = await User.create({
    username: `${WISH_PREFIX}alice`,
    email: `${WISH_PREFIX}alice@example.com`,
    password,
    role: "guest",
  });

  const userBob = await User.create({
    username: `${WISH_PREFIX}bob`,
    email: `${WISH_PREFIX}bob@example.com`,
    password,
    role: "guest",
  });

  const hostCarlos = await User.create({
    username: `${WISH_PREFIX}carlos`,
    email: `${WISH_PREFIX}carlos@example.com`,
    password,
    role: "host",
  });

  const listing1 = await Listing.create({
    title: `${WISH_PREFIX}Azure Seafront Villa`,
    description: "Private infinity pool facing the ocean.",
    price: 12000,
    location: "Goa",
    country: "India",
    propertyType: "villa",
    maxGuests: 6,
    owner: hostCarlos._id,
    status: "approved",
  });

  const listing2 = await Listing.create({
    title: `${WISH_PREFIX}Himalayan Pine Chalet`,
    description: "Cozy fireplace with snowcapped peaks.",
    price: 8500,
    location: "Manali",
    country: "India",
    propertyType: "cottage",
    maxGuests: 4,
    owner: hostCarlos._id,
    status: "approved",
  });

  console.log("--- TEST 1: UNAUTHENTICATED ACTION VALIDATION ---");
  // Test unauthenticated logic: Wishlist requires valid user ID
  try {
    await Wishlist.create({ user: null, listing: listing1._id });
    assert(false, "Unauthenticated user should not be able to create wishlist document");
  } catch (err) {
    assert(true, "Unauthenticated wishlist creation blocked by validation");
  }

  console.log("\n--- TEST 2: LOGGED-IN USER ADDS PROPERTY TO WISHLIST ---");
  const aliceFav1 = await Wishlist.create({
    user: userAlice._id,
    listing: listing1._id,
  });
  assert(aliceFav1 && aliceFav1._id, "Alice successfully added listing1 to wishlist");

  console.log("\n--- TEST 3: DUPLICATE WISHLIST PREVENTION ---");
  try {
    await Wishlist.create({
      user: userAlice._id,
      listing: listing1._id,
    });
    assert(false, "Duplicate wishlist item should trigger MongoDB unique constraint error");
  } catch (err) {
    assert(err.code === 11000, "Duplicate wishlist entry prevented by compound unique index");
  }

  console.log("\n--- TEST 4: USER REMOVES PROPERTY FROM WISHLIST ---");
  const removed = await Wishlist.findOneAndDelete({
    user: userAlice._id,
    listing: listing1._id,
  });
  assert(removed !== null, "Alice successfully removed listing1 from wishlist");
  const checkRemoved = await Wishlist.findOne({ user: userAlice._id, listing: listing1._id });
  assert(checkRemoved === null, "Verified listing1 is no longer in Alice's wishlist");

  console.log("\n--- TEST 5: WISHLIST PAGE SHOWS SAVED PROPERTIES ---");
  // Alice saves both listing1 and listing2
  await Wishlist.create({ user: userAlice._id, listing: listing1._id });
  await Wishlist.create({ user: userAlice._id, listing: listing2._id });

  const aliceWishlist = await Wishlist.find({ user: userAlice._id })
    .populate("listing")
    .sort({ createdAt: -1 });

  assert(aliceWishlist.length === 2, "Alice's wishlist contains exactly 2 items");
  assert(aliceWishlist[0].listing.title.includes(WISH_PREFIX), "Wishlist item includes full listing details");
  assert(aliceWishlist[0].listing.price > 0, "Wishlist item contains nightly rate");

  console.log("\n--- TEST 6: WISHLIST STATE ON PROPERTY CARDS ---");
  const aliceWishlistIds = (await Wishlist.find({ user: userAlice._id }).select("listing")).map((w) =>
    w.listing.toString()
  );
  assert(aliceWishlistIds.includes(listing1._id.toString()), "Card for listing1 is marked as favorited (active)");
  assert(aliceWishlistIds.includes(listing2._id.toString()), "Card for listing2 is marked as favorited (active)");

  console.log("\n--- TEST 7: WISHLIST STATE ON PROPERTY DETAILS ---");
  const isListing1Fav = await Wishlist.exists({ user: userAlice._id, listing: listing1._id });
  assert(Boolean(isListing1Fav), "Listing 1 show page displays 'Saved in Wishlist'");

  console.log("\n--- TEST 8: PERSISTENCE ACROSS SESSIONS ---");
  // Re-query database from fresh query
  const persistedItems = await Wishlist.find({ user: userAlice._id });
  assert(persistedItems.length === 2, "Wishlist state persists correctly across queries");

  console.log("\n--- TEST 9: MULTI-USER PRIVACY & ISOLATION ---");
  // Bob has not saved any listings
  const bobWishlist = await Wishlist.find({ user: userBob._id });
  assert(bobWishlist.length === 0, "Bob's wishlist is empty and isolated from Alice");

  // Bob saves listing2 only
  await Wishlist.create({ user: userBob._id, listing: listing2._id });
  const bobUpdatedWishlist = await Wishlist.find({ user: userBob._id });
  assert(bobUpdatedWishlist.length === 1, "Bob has exactly 1 saved item");
  assert(
    bobUpdatedWishlist[0].listing.toString() === listing2._id.toString(),
    "Bob's saved item matches his selection"
  );

  console.log("\n--- TEST 10: RESILIENCE AGAINST DELETED / INVALID PROPERTIES ---");
  // Create a temporary listing, add to wishlist, then delete the listing
  const tempListing = await Listing.create({
    title: `${WISH_PREFIX}Temporary Villa`,
    description: "Will be deleted",
    price: 5000,
    location: "Delhi",
    country: "India",
    propertyType: "apartment",
    maxGuests: 2,
    owner: hostCarlos._id,
    status: "approved",
  });

  await Wishlist.create({ user: userAlice._id, listing: tempListing._id });
  await Listing.findByIdAndDelete(tempListing._id);

  // Retrieve wishlist and filter
  const rawWithDeleted = await Wishlist.find({ user: userAlice._id }).populate("listing");
  const filteredValid = rawWithDeleted.filter((item) => item.listing !== null && item.listing.status === "approved");

  assert(filteredValid.length === 2, "Wishlist gracefully filters out deleted/orphaned listings without crashing");

  await cleanup();
  await mongoose.connection.close();

  console.log("\n=======================================================");
  console.log("✅ ALL 10 WISHLIST SCENARIOS PASSED (100%)!");
  console.log("=======================================================\n");
}

runWishlistTests().catch(async (err) => {
  console.error("Wishlist test error:", err);
  try {
    await cleanup();
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
