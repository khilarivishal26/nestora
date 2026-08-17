// Nestora Payment model — Phase 9: Payments & Gateway Integration.
// Stores immutable transaction records and audit logs for reservations.

const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: [true, "A payment must be linked to a booking."],
    },
    guest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "A payment must have a guest."],
    },
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      required: [true, "A payment must be linked to a listing."],
    },
    amount: {
      type: Number,
      required: [true, "Payment amount is required."],
      min: [0, "Payment amount cannot be negative."],
    },
    platformCommission: {
      type: Number,
      default: 0,
      min: [0, "Commission cannot be negative."],
    },
    hostEarnings: {
      type: Number,
      default: 0,
      min: [0, "Host earnings cannot be negative."],
    },
    currency: {
      type: String,
      default: "inr",
      uppercase: true,
    },
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "cancelled", "refunded"],
      default: "pending",
    },
    provider: {
      type: String,
      default: "razorpay",
    },
    razorpayOrderId: {
      type: String,
    },
    razorpayPaymentId: {
      type: String,
    },
    razorpaySignature: {
      type: String,
    },
    receiptUrl: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", paymentSchema);
