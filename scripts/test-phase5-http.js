/**
 * Phase 5 HTTP Route & Render Verification
 * Tests the live Express server endpoints and HTML renders.
 */

require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");
const Listing = require("../models/Listing");
const User = require("../models/User");
const Review = require("../models/Review");
const connectDB = require("../utils/db");

const BASE = "http://localhost:8080";
const TEST_PREFIX = "p5http_";

async function runHttpTests() {
  await connectDB();

  // Create temporary test host & listing
  await Review.deleteMany({ body: { $regex: `^${TEST_PREFIX}` } });
  await Listing.deleteMany({ title: { $regex: `^${TEST_PREFIX}` } });
  await User.deleteMany({ username: { $regex: `^${TEST_PREFIX}` } });

  const host = await User.create({
    username: `${TEST_PREFIX}host`,
    email: `${TEST_PREFIX}host@example.com`,
    password: "hashedpassword123",
    role: "host",
  });

  const guest = await User.create({
    username: `${TEST_PREFIX}guest`,
    email: `${TEST_PREFIX}guest@example.com`,
    password: "hashedpassword123",
    role: "guest",
  });

  const approvedListing = await Listing.create({
    title: `${TEST_PREFIX}Seaside Villa Retreat`,
    description: "Stunning coastal views with private beach access and garden.",
    price: 4500,
    location: "Anjuna, Goa",
    country: "India",
    propertyType: "villa",
    category: "Beachfront",
    maxGuests: 4,
    bedrooms: 2,
    bathrooms: 2,
    amenities: ["WiFi", "Pool", "Air Conditioning", "Kitchen", "Free Parking"],
    images: [
      "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80"
    ],
    coordinates: { lat: 15.5833, lng: 73.7417 },
    owner: host._id,
    status: "approved",
  });

  const review = await Review.create({
    body: `${TEST_PREFIX}Incredible stay by the sea! Everything was clean and serene.`,
    rating: 5,
    author: guest._id,
    listing: approvedListing._id,
  });
  approvedListing.reviews.push(review._id);
  await approvedListing.save();

  const pendingListing = await Listing.create({
    title: `${TEST_PREFIX}Hidden Cabin`,
    description: "Pending verification",
    price: 3000,
    location: "Shimla",
    country: "India",
    propertyType: "cottage",
    maxGuests: 2,
    owner: host._id,
    status: "pending",
  });

  console.log("\n==========================================");
  console.log("--- 2. Testing HTTP Endpoints & Rendering ---");
  console.log("==========================================");

  function fetchUrl(path, method = "GET", postData = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, BASE);
      const req = http.request(url, { method, timeout: 5000 }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
      });
      req.on("error", reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  // Test 1: Approved listing details page
  const resApproved = await fetchUrl(`/listings/${approvedListing._id}`);
  console.log(`HTTP GET /listings/${approvedListing._id} -> Status: ${resApproved.statusCode}`);
  if (resApproved.statusCode !== 200) throw new Error("Expected 200 for approved listing");

  // Check required HTML elements
  const html = resApproved.body;
  const checks = [
    { label: "Title rendered", pass: html.includes("Seaside Villa Retreat") },
    { label: "Location rendered", pass: html.includes("Anjuna, Goa") && html.includes("India") },
    { label: "Price rendered", pass: html.includes("4,500") || html.includes("4500") },
    { label: "Property type rendered", pass: html.includes("villa") },
    { label: "Guest, bed, bath count rendered", pass: html.includes("4 guest") && html.includes("2 bedroom") && html.includes("2 bathroom") },
    { label: "Amenities rendered", pass: html.includes("WiFi") && html.includes("Pool") },
    { label: "Description rendered", pass: html.includes("Stunning coastal views") },
    { label: "Host info rendered", pass: html.includes(`Hosted by ${TEST_PREFIX}host`) },
    { label: "Gallery main image rendered", pass: html.includes("gallery-main-img") },
    { label: "Gallery thumbnails rendered", pass: html.includes("gallery-thumb") },
    { label: "Map container rendered", pass: html.includes('id="map"') },
    { label: "Booking Check-in date input", pass: html.includes('id="checkIn"') },
    { label: "Booking Checkout date input", pass: html.includes('id="checkOut"') },
    { label: "Booking Guests selector", pass: html.includes('id="bookingGuests"') },
    { label: "Booking Breakdown container", pass: html.includes('id="booking-breakdown"') },
    { label: "Reserve CTA button", pass: html.includes("Reserve") },
    { label: "Review text rendered", pass: html.includes("Incredible stay by the sea!") },
    { label: "Review author username rendered", pass: html.includes(`${TEST_PREFIX}guest`) },
    { label: "Average rating display", pass: html.includes("5.0") || html.includes("⭐ 5") },
  ];

  let allChecksPassed = true;
  checks.forEach((c) => {
    if (c.pass) {
      console.log(`  ✅ ${c.label}`);
    } else {
      console.error(`  ❌ FAILED: ${c.label}`);
      allChecksPassed = false;
    }
  });

  if (!allChecksPassed) throw new Error("Some HTML elements failed verification");

  // Test 2: Pending listing as unauth guest -> redirects to /listings (302)
  const resPending = await fetchUrl(`/listings/${pendingListing._id}`);
  console.log(`\nHTTP GET /listings/${pendingListing._id} (Pending) -> Status: ${resPending.statusCode} (Expected: 302)`);
  if (resPending.statusCode !== 302) throw new Error("Pending listing must redirect unauthorized guests with 302");
  console.log("  ✅ Pending listing correctly protected from public guests");

  // Test 3: Unauthenticated review POST -> redirects to login (302)
  const resReviewUnauth = await fetchUrl(`/listings/${approvedListing._id}/reviews`, "POST", "rating=5&body=Hello");
  console.log(`\nHTTP POST /listings/${approvedListing._id}/reviews (Unauth) -> Status: ${resReviewUnauth.statusCode} (Expected: 302)`);
  if (resReviewUnauth.statusCode !== 302) throw new Error("Review creation without login must redirect with 302");
  console.log("  ✅ Review submission correctly requires authentication");

  // Cleanup
  await Review.deleteMany({ body: { $regex: `^${TEST_PREFIX}` } });
  await Listing.deleteMany({ title: { $regex: `^${TEST_PREFIX}` } });
  await User.deleteMany({ username: { $regex: `^${TEST_PREFIX}` } });

  await mongoose.connection.close();
  console.log("\n==========================================");
  console.log("✅ ALL HTTP INTEGRATION & RENDER TESTS PASSED!");
  console.log("==========================================\n");
}

runHttpTests().catch(async (err) => {
  console.error("HTTP verification error:", err.message);
  try {
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
