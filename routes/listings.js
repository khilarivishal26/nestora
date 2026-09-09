// Nestora listing routes.
// Provides full RESTful CRUD for property listings.
//
// Route order matters: /listings/new and /listings/my must be declared
// BEFORE /listings/:id, otherwise Express treats "new" / "my" as an id.

const express = require("express");
const router = express.Router();

const listingController = require("../controllers/listingController");
const bookingController = require("../controllers/bookingController");
const { isLoggedIn, isHost } = require("../middleware/auth");
const { isListingOwner } = require("../middleware/listing");
const { handleImageUpload } = require("../middleware/upload");
const { bookingLimiter } = require("../middleware/rateLimiter");

// --- Public routes ---

// Browse all approved listings.
router.get("/", listingController.index);

// --- Host-only routes (must come before /:id) ---

// Form to create a new listing.
router.get("/new", isLoggedIn, isHost, listingController.renderNewForm);

// View all listings owned by the logged-in host.
router.get("/my", isLoggedIn, listingController.myListings);

// Create a new listing (up to 5 images).
router.post(
  "/",
  isLoggedIn,
  isHost,
  handleImageUpload,
  listingController.create
);

// --- Single-listing routes ---

// Show a single listing (public for approved; owner/admin for others).
router.get("/:id", listingController.show);

// Create a booking for a listing (logged-in guests only).
router.post("/:id/bookings", isLoggedIn, bookingLimiter, bookingController.create);

// Render the edit form (owner or admin only).
router.get(
  "/:id/edit",
  isLoggedIn,
  isListingOwner,
  listingController.renderEditForm
);

// Update a listing (owner or admin only, up to 5 new images).
router.put(
  "/:id",
  isLoggedIn,
  isListingOwner,
  handleImageUpload,
  listingController.update
);

// Delete a listing (owner or admin only).
router.delete("/:id", isLoggedIn, isListingOwner, listingController.destroy);

module.exports = router;
