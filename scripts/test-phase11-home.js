/**
 * Phase 11: Homepage UI Upgrade & Polish Test Suite
 * Validates hero visual hierarchy, multi-field search card, category pills,
 * real database featured listings rendering, trending destinations, value pillars,
 * host CTA banner, and 4-column footer.
 * Run with: node scripts/test-phase11-home.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const http = require("http");
const bcrypt = require("bcrypt");

const User = require("../models/User");
const Listing = require("../models/Listing");
const Review = require("../models/Review");
const connectDB = require("../utils/db");

const HOME_TEST_PREFIX = "p11home_";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

function fetchHTML(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:8080${path}`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on("error", reject);
  });
}

async function cleanup() {
  await Review.deleteMany({});
  await Listing.deleteMany({ title: { $regex: `^${HOME_TEST_PREFIX}` } });
  await User.deleteMany({ username: { $regex: `^${HOME_TEST_PREFIX}` } });
}

async function runHomeTests() {
  console.log("\n=======================================================");
  console.log("--- NESTORA PHASE 11: HOMEPAGE UI UPGRADE & POLISH ---");
  console.log("=======================================================");

  await connectDB();
  await cleanup();

  // Create Host & Approved Property with Review
  const password = await bcrypt.hash("password123", 12);
  const host = await User.create({
    username: `${HOME_TEST_PREFIX}host`,
    email: `${HOME_TEST_PREFIX}host@example.com`,
    password,
    role: "host",
  });

  const guest = await User.create({
    username: `${HOME_TEST_PREFIX}guest`,
    email: `${HOME_TEST_PREFIX}guest@example.com`,
    password,
    role: "guest",
  });

  const property = await Listing.create({
    title: `${HOME_TEST_PREFIX}Secluded Himalayan Pine Chalet`,
    description: "Panoramic vistas of snow peaks in Manali.",
    price: 6500,
    location: "Manali",
    country: "India",
    propertyType: "cottage",
    maxGuests: 4,
    bedrooms: 2,
    bathrooms: 2,
    amenities: ["WiFi", "Fireplace", "Kitchen"],
    images: ["https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=600&q=80"],
    owner: host._id,
    status: "approved",
  });

  const review = await Review.create({
    body: "Exceptional mountain retreat! Warm fireplace and stunning sunrise views.",
    rating: 5,
    author: guest._id,
    listing: property._id,
  });

  property.reviews.push(review._id);
  await property.save();

  // Test GET /
  const res = await fetchHTML("/");
  assert(res.statusCode === 200, "GET / returns HTTP 200 OK");

  const html = res.body;

  // 1. Hero visual hierarchy & typography
  assert(html.includes("hero-v2"), "Hero v2 container rendered");
  assert(html.includes("Find your place."), "Hero main heading rendered");
  assert(html.includes("DISCOVER HANDPICKED STAYS"), "Hero badge rendered");

  // 2. Multi-field search box
  assert(html.includes('name="q"'), "Hero search destination input rendered");
  assert(html.includes('name="checkIn"'), "Hero search check-in date input rendered");
  assert(html.includes('name="checkOut"'), "Hero search check-out date input rendered");
  assert(html.includes('name="guests"'), "Hero search guests selector rendered");
  assert(html.includes("hero-submit-btn"), "Hero search submit CTA button rendered");

  // 3. Category navigation pills
  assert(html.includes("category-scroll-nav"), "Category navigation bar rendered");
  assert(html.includes("/listings?propertyType=villa"), "Villa category pill rendered");
  assert(html.includes("/listings?propertyType=cottage"), "Cottage category pill rendered");
  assert(html.includes("/listings?propertyType=hotel"), "Hotel category pill rendered");
  assert(html.includes("/listings?propertyType=resort"), "Resort category pill rendered");
  assert(html.includes("/listings?propertyType=homestay"), "Homestay category pill rendered");

  // 4. Featured stays section with real database property
  assert(html.includes("Popular Stays &amp; Getaways") || html.includes("Popular Stays & Getaways"), "Featured section header rendered");
  assert(html.includes(property.title), "Real database approved property title rendered on homepage");
  assert(html.includes("₹6,500"), "Property price per night rendered formatted: ₹6,500");
  assert(html.includes("Manali, India"), "Property location rendered: Manali, India");
  assert(html.includes("⭐ 5"), "Property 5-star rating rendered");
  assert(html.includes("property-card-favorite-btn"), "Property favorite heart button rendered");

  // 5. Trending destinations section
  assert(html.includes("Trending Destinations"), "Trending destinations section rendered");
  assert(html.includes("Manali &amp; Himachal") || html.includes("Manali & Himachal"), "Manali destination card rendered");
  assert(html.includes("Goa &amp; Coastal") || html.includes("Goa & Coastal"), "Goa destination card rendered");
  assert(html.includes("Jaipur &amp; Rajasthan") || html.includes("Jaipur & Rajasthan"), "Jaipur destination card rendered");
  assert(html.includes("Kerala Backwaters"), "Kerala destination card rendered");

  // 6. Value pillars
  assert(html.includes("Why Travelers Love Nestora"), "Value pillars section rendered");
  assert(html.includes("Verified Stays &amp; Hosts") || html.includes("Verified Stays & Hosts"), "Verified stays pillar rendered");
  assert(html.includes("100% Secure Checkout"), "Secure checkout pillar rendered");
  assert(html.includes("Instant Confirmation"), "Instant confirmation pillar rendered");

  // 7. Host CTA banner
  assert(html.includes("host-cta-banner"), "Host CTA banner rendered");
  assert(html.includes("Earn by sharing your space"), "Host CTA headline rendered");
  assert(html.includes("/become-host"), "Host CTA button linking to /become-host rendered");

  // 8. Professional 4-column footer
  assert(html.includes("footer-v2"), "Footer v2 container rendered");
  assert(html.includes("footer-logo"), "Footer logo rendered");
  assert(html.includes("Explore Stays"), "Footer explore column rendered");
  assert(html.includes("Host With Us"), "Footer hosting column rendered");
  assert(html.includes("Account &amp; Trust") || html.includes("Account & Trust"), "Footer account column rendered");

  await cleanup();
  await mongoose.connection.close();

  console.log("\n=======================================================");
  console.log("✅ ALL PHASE 11 HOMEPAGE UI TESTS PASSED!");
  console.log("=======================================================\n");
}

runHomeTests().catch(async (err) => {
  console.error("Test failure:", err);
  try {
    await cleanup();
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
