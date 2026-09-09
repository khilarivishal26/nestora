// Nestora review controller — Phase 8: Reviews & Ratings.
// Enforces verified guest stays, duplicate review prevention,
// rating validation (1–5), and author/admin deletion authorization.

const Review = require("../models/Review");
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const { validateReviewInput } = require("../middleware/validators");

// ---------------------------------------------------------------------------
// POST /listings/:id/reviews — Create a review (verified guests only)
// ---------------------------------------------------------------------------
module.exports.create = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      req.flash("error", "Listing not found.");
      return res.redirect("/listings");
    }

    // 1. Only approved listings can receive reviews.
    if (listing.status !== "approved") {
      req.flash("error", "You cannot review this property.");
      return res.redirect("/listings");
    }

    // 2. Hosts cannot review their own property.
    if (listing.owner.equals(req.user._id)) {
      req.flash("error", "Hosts cannot review their own property.");
      return res.redirect(`/listings/${listing._id}`);
    }

    // 3. Verified Stay Requirement: Guest must have an eligible booking for this property
    const eligibleBooking = await Booking.findOne({
      listing: listing._id,
      guest: req.user._id,
      status: { $in: ["confirmed", "completed"] },
    });

    if (!eligibleBooking) {
      req.flash(
        "error",
        "Only guests with a confirmed or completed stay can review this property."
      );
      return res.redirect(`/listings/${listing._id}`);
    }

    // 4. Duplicate Prevention: A guest can only review a property once
    const existingReview = await Review.findOne({
      listing: listing._id,
      author: req.user._id,
    });

    if (existingReview) {
      req.flash(
        "error",
        "You have already submitted a review for this stay. Duplicate reviews are not allowed."
      );
      return res.redirect(`/listings/${listing._id}`);
    }

    // 5. Centralized Validation
    const validation = validateReviewInput(req.body);
    if (!validation.valid) {
      req.flash("error", validation.error);
      return res.redirect(`/listings/${listing._id}`);
    }

    const { rating: numericRating, body: cleanBody } = validation.data;

    // 6. Create and link review
    const review = new Review({
      body: cleanBody,
      rating: numericRating,
      author: req.user._id,
      listing: listing._id,
      booking: eligibleBooking._id,
    });

    await review.save();

    // Push review into listing's reviews array
    listing.reviews.push(review._id);
    await listing.save();

    req.flash("success", "Thank you! Your review and rating have been posted.");
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

    // Strict Authorization: Only the original review author or an admin may delete
    const isAuthor = review.author.equals(req.user._id);
    const isAdmin = req.user.role === "admin";

    if (!isAuthor && !isAdmin) {
      req.flash("error", "You do not have permission to delete this review.");
      return res.redirect(`/listings/${id}`);
    }

    // Remove the review reference from the listing
    await Listing.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });

    // Delete the review document
    await Review.findByIdAndDelete(reviewId);

    req.flash("success", "Review removed successfully.");
    res.redirect(`/listings/${id}`);
  } catch (err) {
    next(err);
  }
};
