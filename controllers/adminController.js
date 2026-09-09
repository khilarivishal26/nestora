// Nestora admin controller — Phase 7: Role-Based Dashboards & Analytics.
// Provides platform-wide analytics (users, properties, revenue, bookings)
// and pending property approvals.

const Listing = require("../models/Listing");
const User = require("../models/User");
const Booking = require("../models/Booking");
const AuditLog = require("../models/AuditLog");
const auditService = require("../services/auditService");
const emailService = require("../services/emailService");

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
      Booking.find({ paymentStatus: "paid", status: { $ne: "cancelled" } }),
    ]);

    const totalProperties = pendingCount + approvedCount + rejectedCount;

    // Platform Financial Metrics: Count only paid bookings in gross volume & commissions
    const grossBookingVolume = activeBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
    const platformRevenue = activeBookings.reduce(
      (sum, b) => sum + (b.platformCommission || b.serviceFee || Math.round((b.totalPrice || 0) * 0.05)),
      0
    );

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
    const listing = await Listing.findById(req.params.id).populate("owner", "username email");

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

    await auditService.recordAuditLog({
      action: "listing.approved",
      actor: req.user,
      actorRole: req.user.role,
      actorUsername: req.user.username,
      targetType: "Listing",
      targetId: listing._id,
      metadata: {
        title: listing.title,
        ownerId: listing.owner ? (listing.owner._id || listing.owner) : null,
      },
      req,
    });

    if (listing.owner && listing.owner.email) {
      emailService.sendListingStatusEmail(listing, listing.owner, "approved").catch((e) => {
        console.error("Listing approval email error:", e.message);
      });
    }

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
    const listing = await Listing.findById(req.params.id).populate("owner", "username email");

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

    await auditService.recordAuditLog({
      action: "listing.rejected",
      actor: req.user,
      actorRole: req.user.role,
      actorUsername: req.user.username,
      targetType: "Listing",
      targetId: listing._id,
      metadata: {
        title: listing.title,
        ownerId: listing.owner ? (listing.owner._id || listing.owner) : null,
      },
      req,
    });

    if (listing.owner && listing.owner.email) {
      emailService.sendListingStatusEmail(listing, listing.owner, "rejected").catch((e) => {
        console.error("Listing rejection email error:", e.message);
      });
    }

    req.flash("success", `"${listing.title}" has been rejected.`);
    res.redirect("/admin");
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /admin/audit-logs — View system audit logs
// ---------------------------------------------------------------------------
module.exports.viewAuditLogs = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    const [logs, totalCount] = await Promise.all([
      AuditLog.find()
        .populate("actor", "username email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      AuditLog.countDocuments(),
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 1;

    res.render("admin/audit", {
      title: "System Audit Trail",
      logs,
      currentPage: page,
      totalPages,
      totalCount,
    });
  } catch (err) {
    next(err);
  }
};
