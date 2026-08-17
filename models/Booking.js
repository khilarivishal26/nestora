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
    totalPrice: {
      type: Number,
      required: [true, "Total price is required."],
      min: [0, "Total price cannot be negative."],
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "completed"],
      default: "confirmed",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Booking", bookingSchema);
