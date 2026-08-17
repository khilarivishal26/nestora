// Nestora booking routes — Phase 9: Bookings & Payments.
// Protected routes for managing reservations, payments, and cancellations.

const express = require("express");
const router = express.Router();

const bookingController = require("../controllers/bookingController");
const paymentController = require("../controllers/paymentController");
const { isLoggedIn, isHost } = require("../middleware/auth");

// Guest view of their own reservations
router.get("/my", isLoggedIn, bookingController.myBookings);

// Host view of incoming reservations for their properties
router.get("/host", isLoggedIn, isHost, bookingController.hostBookings);

// Payment & Checkout routes
router.get("/:id/payment", isLoggedIn, paymentController.showPaymentPage);
router.post("/:id/checkout", isLoggedIn, paymentController.createCheckoutSession);
router.get("/:id/payment/success", isLoggedIn, paymentController.handlePaymentSuccess);
router.get("/:id/payment/cancel", isLoggedIn, paymentController.handlePaymentCancel);

// Show single booking confirmation details
router.get("/:id", isLoggedIn, bookingController.show);

// Cancel a booking
router.post("/:id/cancel", isLoggedIn, bookingController.cancel);
router.put("/:id/cancel", isLoggedIn, bookingController.cancel);

module.exports = router;
