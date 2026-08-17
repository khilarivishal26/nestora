// Nestora review routes — Phase 5.
// Nested under /listings/:id/reviews.
// mergeParams: true lets us access req.params.id from the parent router.

const express = require("express");
const router = express.Router({ mergeParams: true });

const reviewController = require("../controllers/reviewController");
const { isLoggedIn } = require("../middleware/auth");

// Create a review for a listing.
router.post("/", isLoggedIn, reviewController.create);

// Delete a review (author or admin only — checked in controller).
router.delete("/:reviewId", isLoggedIn, reviewController.destroy);

module.exports = router;
