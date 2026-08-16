// Nestora listing authorization middleware.
// Verifies that the logged-in user owns the listing they are trying to
// edit or delete. Admins are allowed through as well.
//
// This middleware also attaches the fetched listing to req.listing so
// the downstream controller doesn't repeat the same findById query.

const Listing = require("../models/Listing");
const ExpressError = require("../utils/ExpressError");

module.exports.isListingOwner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) {
      return next(new ExpressError(404, "Listing not found."));
    }

    // Allow the listing owner or any admin.
    if (!listing.owner.equals(req.user._id) && req.user.role !== "admin") {
      req.flash("error", "You do not have permission to do that.");
      return res.redirect(`/listings/${id}`);
    }

    // Attach listing so controller can skip the duplicate query.
    req.listing = listing;
    next();
  } catch (err) {
    next(err);
  }
};
