// Nestora review controller — Phase 5.
// Handles creating and deleting reviews for a listing.
// Only authenticated users can review. A user cannot review their own listing.

const Review = require("../models/Review");
const Listing = require("../models/Listing");

// ---------------------------------------------------------------------------
// POST /listings/:id/reviews — Create a review
// ---------------------------------------------------------------------------
module.exports.create = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      req.flash("error", "Listing not found.");
      return res.redirect("/listings");
    }

    // Only approved listings can receive reviews.
    if (listing.status !== "approved") {
      req.flash("error", "You cannot review this listing.");
      return res.redirect("/listings");
    }

    // Hosts should not review their own property.
    if (listing.owner.equals(req.user._id)) {
      req.flash("error", "You cannot review your own property.");
      return res.redirect(`/listings/${listing._id}`);
    }

    const { rating, body } = req.body;

    // Backend validation.
    if (!rating || Number(rating) < 1 || Number(rating) > 5) {
      req.flash("error", "Rating must be between 1 and 5.");
      return res.redirect(`/listings/${listing._id}`);
    }
    if (!body || !body.trim()) {
      req.flash("error", "Review text is required.");
      return res.redirect(`/listings/${listing._id}`);
    }

    const review = new Review({
      body: body.trim(),
      rating: Number(rating),
      author: req.user._id,
      listing: listing._id,
    });

    await review.save();

    // Push the review ObjectId into the listing's reviews array.
    listing.reviews.push(review._id);
    await listing.save();

    req.flash("success", "Review submitted!");
    res.redirect(`/listings/${listing._id}`);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /listings/:id/reviews/:reviewId — Delete a review
// ---------------------------------------------------------------------------
module.exports.destroy = async (req, res, next) => {
  try {
    const { id, reviewId } = req.params;

    const review = await Review.findById(reviewId);
    if (!review) {
      req.flash("error", "Review not found.");
      return res.redirect(`/listings/${id}`);
    }

    // Only the review author or an admin may delete.
    if (!review.author.equals(req.user._id) && req.user.role !== "admin") {
      req.flash("error", "You do not have permission to delete this review.");
      return res.redirect(`/listings/${id}`);
    }

    // Remove the review reference from the listing.
    await Listing.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });

    // Delete the review document.
    await Review.findByIdAndDelete(reviewId);

    req.flash("success", "Review deleted.");
    res.redirect(`/listings/${id}`);
  } catch (err) {
    next(err);
  }
};
