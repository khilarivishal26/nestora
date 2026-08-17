// Nestora booking routes — Phase 6: Booking & Availability.
// Protected routes for managing reservations, viewing bookings, and cancelling.

const express = require("express");
const router = express.Router();

const bookingController = require("../controllers/bookingController");
const { isLoggedIn, isHost } = require("../middleware/auth");

// Guest view of their own reservations
router.get("/my", isLoggedIn, bookingController.myBookings);

// Host view of incoming reservations for their properties
router.get("/host", isLoggedIn, isHost, bookingController.hostBookings);

// Show single booking confirmation details
router.get("/:id", isLoggedIn, bookingController.show);

// Cancel a booking
router.post("/:id/cancel", isLoggedIn, bookingController.cancel);
router.put("/:id/cancel", isLoggedIn, bookingController.cancel);

module.exports = router;
