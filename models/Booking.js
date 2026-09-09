// Nestora Booking model — Phase 6: Booking & Availability.
// Tracks reservations made by guests for property listings.
// Prices and nights are strictly calculated and stored on the backend.

const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      required: [true, "A booking must belong to a listing."],
    },
    guest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "A booking must have a guest."],
    },
    checkIn: {
      type: Date,
      required: [true, "Check-in date is required."],
    },
    checkOut: {
      type: Date,
      required: [true, "Check-out date is required."],
    },
    guests: {
      type: Number,
      required: [true, "Number of guests is required."],
      min: [1, "Number of guests must be at least 1."],
    },
    nights: {
      type: Number,
      required: [true, "Number of nights is required."],
      min: [1, "Number of nights must be at least 1."],
    },
    pricePerNight: {
      type: Number,
      required: [true, "Price per night is required."],
      min: [0, "Price cannot be negative."],
    },
    serviceFee: {
      type: Number,
      default: 0,
      min: [0, "Service fee cannot be negative."],
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
    totalPrice: {
      type: Number,
      required: [true, "Total price is required."],
      min: [0, "Total price cannot be negative."],
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "completed", "expired"],
      default: "pending",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
      index: true,
    },
    paymentMethod: {
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
    paidAt: {
      type: Date,
    },
    cancellationPolicy: {
      type: String,
      enum: ["flexible", "moderate", "strict"],
      default: "flexible",
    },
    refundStatus: {
      type: String,
      enum: ["none", "pending", "completed", "failed", "ineligible"],
      default: "none",
      index: true,
    },
    refundAmount: {
      type: Number,
      default: 0,
      min: [0, "Refund amount cannot be negative."],
    },
    refundReason: {
      type: String,
      default: "",
    },
    razorpayRefundId: {
      type: String,
    },
    refundedAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 15 * 60 * 1000), // 15-minute booking hold
      index: true,
    },
  },
  { timestamps: true }
);

// Optimized compound indexes for fast availability checks and overlap prevention
bookingSchema.index({ listing: 1, status: 1, checkIn: 1, checkOut: 1 });
bookingSchema.index({ listing: 1, paymentStatus: 1, expiresAt: 1 });
bookingSchema.index({ guest: 1, createdAt: -1 });

bookingSchema.methods.isExpired = function () {
  if (this.status === "expired") return true;
  if (this.status === "pending" && this.expiresAt && this.expiresAt <= new Date()) {
    return true;
  }
  return false;
};

module.exports = mongoose.model("Booking", bookingSchema);
