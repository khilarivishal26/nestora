// Nestora host controller — Phase 7: Role-Based Dashboards.
// Provides host metrics, property management overview, revenue calculations,
// and incoming guest reservation feeds.

const Listing = require("../models/Listing");
const Booking = require("../models/Booking");

// ---------------------------------------------------------------------------
// GET /host/dashboard — Host Dashboard
// ---------------------------------------------------------------------------
module.exports.dashboard = async (req, res, next) => {
  try {
    const hostId = req.user._id;

    // Fetch all listings owned by this host
    const listings = await Listing.find({ owner: hostId }).sort({ createdAt: -1 });
    const listingIds = listings.map((l) => l._id);

    // Fetch all reservations on this host's properties
    const bookings = await Booking.find({ listing: { $in: listingIds } })
      .populate("listing")
      .populate("guest", "username email")
      .sort({ createdAt: -1 });

    // Property metrics
    const totalProperties = listings.length;
    const pendingProperties = listings.filter((l) => l.status === "pending").length;
    const approvedProperties = listings.filter((l) => l.status === "approved").length;
    const rejectedProperties = listings.filter((l) => l.status === "rejected").length;

    // Financial & Booking metrics
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activeBookings = bookings.filter((b) => b.status !== "cancelled");
    const grossBookings = activeBookings.reduce(
      (sum, b) => sum + (b.totalPrice || (b.nights * b.pricePerNight)),
      0
    );
    const totalCommission = activeBookings.reduce(
      (sum, b) => sum + (b.platformCommission || b.serviceFee || Math.round((b.totalPrice || (b.nights * b.pricePerNight)) * 0.05)),
      0
    );
    const netHostEarnings = grossBookings - totalCommission;

    const upcomingBookings = bookings.filter(
      (b) => b.status === "confirmed" && new Date(b.checkIn) >= today
    );
    const completedBookings = bookings.filter(
      (b) => b.status === "completed" || (b.status === "confirmed" && new Date(b.checkOut) < today)
    );

    res.render("host/dashboard", {
      title: "Host Dashboard",
      listings,
      bookings,
      totalProperties,
      pendingProperties,
      approvedProperties,
      rejectedProperties,
      grossBookings,
      totalCommission,
      netHostEarnings,
      totalRevenue: netHostEarnings,
      totalReservations: bookings.length,
      upcomingCount: upcomingBookings.length,
      completedCount: completedBookings.length,
    });
  } catch (err) {
    next(err);
  }
};
