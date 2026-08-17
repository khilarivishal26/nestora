// Nestora admin controller — Phase 7: Role-Based Dashboards & Analytics.
// Provides platform-wide analytics (users, properties, revenue, bookings)
// and pending property approvals.

const Listing = require("../models/Listing");
const User = require("../models/User");
const Booking = require("../models/Booking");

// ---------------------------------------------------------------------------
// GET /admin — Admin dashboard (platform KPI metrics, pending approvals, recent bookings)
// ---------------------------------------------------------------------------
module.exports.dashboard = async (req, res, next) => {
  try {
    const [
      totalUsers,
      totalHosts,
      totalGuests,
      totalAdmins,
      pendingListings,
      pendingCount,
      approvedCount,
      rejectedCount,
      totalBookingsCount,
      recentBookings,
      recentUsers,
      activeBookings,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "host" }),
      User.countDocuments({ role: "guest" }),
      User.countDocuments({ role: "admin" }),
      Listing.find({ status: "pending" })
        .populate("owner", "username email")
        .sort({ createdAt: -1 }),
      Listing.countDocuments({ status: "pending" }),
      Listing.countDocuments({ status: "approved" }),
      Listing.countDocuments({ status: "rejected" }),
      Booking.countDocuments(),
      Booking.find()
        .populate("listing")
        .populate("guest", "username email")
        .sort({ createdAt: -1 })
        .limit(8),
      User.find().sort({ createdAt: -1 }).limit(8),
      Booking.find({ status: { $ne: "cancelled" } }),
    ]);

    const totalProperties = pendingCount + approvedCount + rejectedCount;

    // Platform Financial Metrics
    const grossBookingVolume = activeBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
    const platformRevenue = activeBookings.reduce((sum, b) => sum + (b.serviceFee || 0), 0);

    res.render("admin/dashboard", {
      title: "Admin Dashboard",
      listings: pendingListings,
      totalUsers,
      totalHosts,
      totalGuests,
      totalAdmins,
      totalProperties,
      pendingCount,
      approvedCount,
      rejectedCount,
      totalBookingsCount,
      grossBookingVolume,
      platformRevenue,
      recentBookings,
      recentUsers,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PUT /admin/listings/:id/approve — Approve a listing
// ---------------------------------------------------------------------------
module.exports.approve = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      req.flash("error", "Property not found.");
      return res.redirect("/admin");
    }

    if (listing.status === "approved") {
      req.flash("error", "This property is already approved.");
      return res.redirect("/admin");
    }

    listing.status = "approved";
    await listing.save();

    req.flash(
      "success",
      `"${listing.title}" has been approved and is now visible to guests.`
    );
    res.redirect("/admin");
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PUT /admin/listings/:id/reject — Reject a listing
// ---------------------------------------------------------------------------
module.exports.reject = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      req.flash("error", "Property not found.");
      return res.redirect("/admin");
    }

    if (listing.status === "rejected") {
      req.flash("error", "This property is already rejected.");
      return res.redirect("/admin");
    }

    listing.status = "rejected";
    await listing.save();

    req.flash("success", `"${listing.title}" has been rejected.`);
    res.redirect("/admin");
  } catch (err) {
    next(err);
  }
};
