// Nestora Review model — Phase 5.
// A review belongs to a single listing and a single user (author).
// Rating is 1–5 stars.  The Listing schema holds an array of review
// ObjectIds so we can populate them in the show controller.

const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    body: {
      type: String,
      required: [true, "Review text is required."],
      trim: true,
    },
    rating: {
      type: Number,
      required: [true, "Rating is required."],
      min: [1, "Rating must be at least 1."],
      max: [5, "Rating cannot exceed 5."],
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "A review must have an author."],
    },
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      required: [true, "A review must belong to a listing."],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Review", reviewSchema);
