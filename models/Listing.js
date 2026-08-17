// Nestora Listing model.
// Phase 1 scope: schema only. No CRUD routes/controllers yet - those
// come in a later phase. This just establishes the data shape so other
// parts of the app (and future migrations) can rely on it.
//
// IMPORTANT RULE: any code that queries listings for public display
// (search, home page, listing detail pages) must filter by
// status: "approved". Pending/rejected listings should never be shown
// to the public - only to their owner and to admins.

const mongoose = require("mongoose");

const listingSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required."],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Description is required."],
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
    price: {
      type: Number,
      required: [true, "Price is required."],
      min: [0, "Price cannot be negative."],
    },
    location: {
      type: String,
      required: [true, "Location is required."],
      trim: true,
    },
    country: {
      type: String,
      required: [true, "Country is required."],
      trim: true,
    },
    propertyType: {
      type: String,
      enum: ["hotel", "villa", "resort", "cottage", "apartment", "homestay"],
      required: [true, "Property type is required."],
    },
    category: {
      type: String,
      trim: true,
    },
    maxGuests: {
      type: Number,
      required: [true, "Max guests is required."],
      min: [1, "Max guests must be at least 1."],
    },
    bedrooms: {
      type: Number,
      default: 0,
      min: [0, "Bedrooms cannot be negative."],
    },
    bathrooms: {
      type: Number,
      default: 0,
      min: [0, "Bathrooms cannot be negative."],
    },
    amenities: {
      type: [String],
      default: [],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "A listing must have an owner."],
    },
    // Simple lat/lng object for Phase 1. Mapbox integration (later phase)
    // may expand this into full GeoJSON if needed for geo-queries.
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    reviews: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Review",
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Listing", listingSchema);