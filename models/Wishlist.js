// Nestora Wishlist model.
// Associates saved listings with an authenticated user.
// Compound index ensures a user cannot save the same listing twice.

const mongoose = require("mongoose");

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required."],
      index: true,
    },
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      required: [true, "Listing ID is required."],
      index: true,
    },
  },
  { timestamps: true }
);

// Compound unique index ensuring uniqueness at the database layer
wishlistSchema.index({ user: 1, listing: 1 }, { unique: true });

module.exports = mongoose.model("Wishlist", wishlistSchema);
