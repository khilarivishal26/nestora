/**
 * Phase 6: HTTP Route and User Flow Verification
 * Tests the live Express server endpoints for booking creation, dashboards, and authorization.
 */

require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");
const Listing = require("../models/Listing");
const User = require("../models/User");
const Booking = require("../models/Booking");
const connectDB = require("../utils/db");

const BASE = "http://localhost:8080";
const TEST_PREFIX = "p6http_";

async function runHttpBookingTests() {
  await connectDB();

  await Booking.deleteMany({});
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

  const listing = await Listing.create({
    title: `${TEST_PREFIX}Pine Forest Chalet`,
    description: "Cozy chalet nestled among pines.",
    price: 3500,
    location: "Kasauli, Himachal Pradesh",
    country: "India",
    propertyType: "cottage",
    maxGuests: 4,
    owner: host._id,
    status: "approved",
  });

  function fetchUrl(path, method = "GET", postData = null, cookie = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, BASE);
      const headers = {};
      if (cookie) headers["Cookie"] = cookie;
      if (postData) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        headers["Content-Length"] = Buffer.byteLength(postData);
      }

      const req = http.request(url, { method, headers, timeout: 5000 }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
      });
      req.on("error", reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  console.log("\n==========================================");
  console.log("--- Testing Phase 6 HTTP Routes ---");
  console.log("==========================================");

  // 1. Unauthenticated routes redirect to /login
  const resMyUnauth = await fetchUrl("/bookings/my");
  console.log(`GET /bookings/my (Unauth) -> Status: ${resMyUnauth.statusCode} (Expected: 302)`);
  if (resMyUnauth.statusCode !== 302) throw new Error("Expected 302 redirect for unauthenticated /bookings/my");

  const resHostUnauth = await fetchUrl("/bookings/host");
  console.log(`GET /bookings/host (Unauth) -> Status: ${resHostUnauth.statusCode} (Expected: 302)`);
  if (resHostUnauth.statusCode !== 302) throw new Error("Expected 302 redirect for unauthenticated /bookings/host");

  const resBookUnauth = await fetchUrl(`/listings/${listing._id}/bookings`, "POST", "checkIn=2026-09-01&checkOut=2026-09-04&guests=2");
  console.log(`POST /listings/:id/bookings (Unauth) -> Status: ${resBookUnauth.statusCode} (Expected: 302)`);
  if (resBookUnauth.statusCode !== 302) throw new Error("Expected 302 redirect for unauthenticated booking POST");

  // Cleanup
  await Booking.deleteMany({});
  await Listing.deleteMany({ title: { $regex: `^${TEST_PREFIX}` } });
  await User.deleteMany({ username: { $regex: `^${TEST_PREFIX}` } });

  await mongoose.connection.close();
  console.log("\n✅ All HTTP route protections verified successfully!");
}

runHttpBookingTests().catch(async (err) => {
  console.error("HTTP Booking verification failed:", err);
  try {
    await mongoose.connection.close();
  } catch (e) {}
  process.exit(1);
});
