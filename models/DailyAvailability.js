// Nestora DailyAvailability Model — Phase 7: Atomic Booking Inventory.
// Guarantees zero double-booking at the database level with a compound unique index (listing + date).

const mongoose = require("mongoose");

const dailyAvailabilitySchema = new mongoose.Schema(
  {
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      required: true,
      index: true,
    },
    date: {
      type: String, // Stored as ISO YYYY-MM-DD for deterministic unique indexing
      required: true,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["hold", "confirmed"],
      default: "hold",
    },
    expiresAt: {
      type: Date,
      index: true,
    },
  },
  { timestamps: true }
);

// Compound unique index strictly prevents two bookings for the same property on the same night
dailyAvailabilitySchema.index({ listing: 1, date: 1 }, { unique: true });
dailyAvailabilitySchema.index({ listing: 1, expiresAt: 1 });

module.exports = mongoose.model("DailyAvailability", dailyAvailabilitySchema);
