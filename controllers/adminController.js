// Nestora admin controller — Phase 3: Property Approval.
// Admins review pending listings and approve or reject them before they
// appear in public search/browse.

const Listing = require("../models/Listing");

// ---------------------------------------------------------------------------
// GET /admin — Admin dashboard (pending queue + summary stats)
// ---------------------------------------------------------------------------
module.exports.dashboard = async (req, res, next) => {
  try {
    const [listings, pendingCount, approvedCount, rejectedCount] = await Promise.all([
      Listing.find({ status: "pending" })
        .populate("owner", "username email")
        .sort({ createdAt: -1 }),
      Listing.countDocuments({ status: "pending" }),
      Listing.countDocuments({ status: "approved" }),
      Listing.countDocuments({ status: "rejected" }),
    ]);

    res.render("admin/dashboard", {
      title: "Admin Dashboard",
      listings,
      pendingCount,
      approvedCount,
      rejectedCount,
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
