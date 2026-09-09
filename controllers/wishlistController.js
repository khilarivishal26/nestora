// Nestora Wishlist Controller.
// Handles viewing saved wishlist properties, toggling wishlist items,
// and removing properties with full authorization and validation.

const mongoose = require("mongoose");
const Wishlist = require("../models/Wishlist");
const Listing = require("../models/Listing");

// ---------------------------------------------------------------------------
// GET /wishlist — View user's saved wishlist properties
// ---------------------------------------------------------------------------
module.exports.index = async (req, res, next) => {
  try {
    const rawWishlist = await Wishlist.find({ user: req.user._id })
      .populate({
        path: "listing",
        populate: {
          path: "reviews",
          select: "rating",
        },
      })
      .sort({ createdAt: -1 });

    // Filter out items where listing was deleted or is not approved
    const validItems = rawWishlist
      .filter((item) => item.listing && item.listing.status === "approved" && !item.listing.isDeleted)
      .map((item) => {
        const listing = item.listing;
        let avgRating = 0;
        const reviewCount = listing.reviews ? listing.reviews.length : 0;
        if (reviewCount > 0) {
          const total = listing.reviews.reduce((sum, r) => sum + r.rating, 0);
          avgRating = (total / reviewCount).toFixed(1);
        }
        return {
          _id: item._id,
          createdAt: item.createdAt,
          listing: {
            ...listing.toObject(),
            avgRating: Number(avgRating),
            reviewCount,
          },
        };
      });

    res.render("wishlist/index", {
      title: "My Wishlist",
      wishlistItems: validItems,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /wishlist/toggle/:id — Toggle listing in user's wishlist
// ---------------------------------------------------------------------------
module.exports.toggle = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.status(400).json({ success: false, message: "Invalid property ID." });
      }
      req.flash("error", "Invalid property ID.");
      return res.redirect("back");
    }

    const listing = await Listing.findById(id);
    if (!listing || listing.status !== "approved") {
      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.status(404).json({ success: false, message: "Property not found or unavailable." });
      }
      req.flash("error", "Property not found or unavailable.");
      return res.redirect("back");
    }

    const existing = await Wishlist.findOne({ user: req.user._id, listing: id });

    let isWishlisted = false;
    let message = "";

    if (existing) {
      await Wishlist.findByIdAndDelete(existing._id);
      isWishlisted = false;
      message = "Removed from your wishlist.";
    } else {
      await Wishlist.create({ user: req.user._id, listing: id });
      isWishlisted = true;
      message = "Saved to your wishlist!";
    }

    if (req.xhr || req.headers.accept?.includes("json") || req.body?.format === "json") {
      return res.json({
        success: true,
        isWishlisted,
        message,
        listingId: id,
      });
    }

    req.flash("success", message);
    return res.redirect(req.get("Referrer") || "/wishlist");
  } catch (err) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(500).json({ success: false, message: "Failed to update wishlist." });
    }
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /wishlist/:id/remove or DELETE /wishlist/:id — Explicit removal
// ---------------------------------------------------------------------------
module.exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.status(400).json({ success: false, message: "Invalid property ID." });
      }
      req.flash("error", "Invalid property ID.");
      return res.redirect("/wishlist");
    }

    await Wishlist.findOneAndDelete({ user: req.user._id, listing: id });

    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({ success: true, isWishlisted: false, message: "Removed from wishlist." });
    }

    req.flash("success", "Property removed from your wishlist.");
    res.redirect("/wishlist");
  } catch (err) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(500).json({ success: false, message: "Failed to remove from wishlist." });
    }
    next(err);
  }
};
