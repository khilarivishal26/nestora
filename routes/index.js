// Nestora index routes — Phase 7: Guest Dashboard & Profile.

const express = require("express");
const router = express.Router();
const Listing = require("../models/Listing");
const Booking = require("../models/Booking");
const { isLoggedIn } = require("../middleware/auth");

// Home page — fetches featured approved properties with populated ratings
router.get("/", async (req, res, next) => {
  try {
    const featuredListings = await Listing.find({ status: "approved" })
      .populate({
        path: "reviews",
        select: "rating",
      })
      .sort({ createdAt: -1 })
      .limit(6);

    const listingsWithRatings = featuredListings.map((listing) => {
      let avgRating = 0;
      const reviewCount = listing.reviews ? listing.reviews.length : 0;
      if (reviewCount > 0) {
        const total = listing.reviews.reduce((sum, r) => sum + r.rating, 0);
        avgRating = (total / reviewCount).toFixed(1);
      }
      return {
        ...listing.toObject(),
        avgRating: Number(avgRating),
        reviewCount,
      };
    });

    res.render("home", {
      title: "Find your place. Feel at home.",
      featuredListings: listingsWithRatings,
    });
  } catch (err) {
    next(err);
  }
});

// Guest Profile & Dashboard
router.get("/profile", isLoggedIn, async (req, res, next) => {
  try {
    const bookings = await Booking.find({ guest: req.user._id })
      .populate({
        path: "listing",
        populate: { path: "owner", select: "username email" },
      })
      .sort({ createdAt: -1 });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcomingBookings = bookings.filter(
      (b) => b.status === "confirmed" && new Date(b.checkIn) >= today
    );
    const pastBookings = bookings.filter(
      (b) => b.status === "completed" || (b.status === "confirmed" && new Date(b.checkOut) < today)
    );
    const cancelledBookings = bookings.filter((b) => b.status === "cancelled");

    const totalSpent = bookings
      .filter((b) => b.status !== "cancelled")
      .reduce((sum, b) => sum + (b.totalPrice || 0), 0);

    res.render("profile", {
      title: "My Dashboard",
      bookings,
      upcomingBookings,
      pastBookings,
      cancelledBookings,
      totalSpent,
      totalTrips: bookings.filter((b) => b.status !== "cancelled").length,
    });
  } catch (err) {
    next(err);
  }
});

// Upgrade user to host
router.post("/become-host", isLoggedIn, async (req, res, next) => {
  try {
    if (req.user.role === "host" || req.user.role === "admin") {
      req.flash("error", "You are already a host.");
      return res.redirect("/profile");
    }

    req.user.role = "host";
    await req.user.save();

    req.flash("success", "Congratulations! You are now a host. You can start listing properties.");
    res.redirect("/host/dashboard");
  } catch (err) {
    next(err);
  }
});

module.exports = router;