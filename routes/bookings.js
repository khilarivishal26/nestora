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

// Razorpay Payment & Checkout routes
router.get("/:id/payment", isLoggedIn, paymentController.showPaymentPage);
router.post("/:id/verify", isLoggedIn, paymentController.verifyPayment);
router.post("/:id/payment/verify", isLoggedIn, paymentController.verifyPayment);
router.post("/:id/failed", isLoggedIn, paymentController.handlePaymentFailure);
router.get("/:id/payment/cancel", isLoggedIn, paymentController.handlePaymentFailure);

// Show single booking confirmation details
router.get("/:id", isLoggedIn, bookingController.show);

// Cancel a booking
router.post("/:id/cancel", isLoggedIn, bookingController.cancel);
router.put("/:id/cancel", isLoggedIn, bookingController.cancel);

module.exports = router;
