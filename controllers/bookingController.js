const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Listing = require("../models/Listing");
const User = require("../models/User");
const Payment = require("../models/Payment");
const DailyAvailability = require("../models/DailyAvailability");
const { validateBookingInput } = require("../middleware/validators");
const auditService = require("../services/auditService");
const refundService = require("../services/refundService");
const emailService = require("../services/emailService");

// ---------------------------------------------------------------------------
// Helper: Extract contiguous YYYY-MM-DD date strings between checkIn and checkOut
// ---------------------------------------------------------------------------
function getBookingDateStrings(checkInDate, checkOutDate) {
  const dates = [];
  const cur = new Date(checkInDate);
  const end = new Date(checkOutDate);
  while (cur < end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// POST /listings/:id/bookings — Create a new reservation with atomic inventory locking
// ---------------------------------------------------------------------------
module.exports.create = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      req.flash("error", "Listing not found.");
      return res.redirect("/listings");
    }

    // 1. Only approved listings can be booked.
    if (listing.status !== "approved") {
      req.flash("error", "This property is not currently available for booking.");
      return res.redirect("/listings");
    }

    // 2. Hosts cannot book their own property.
    if (listing.owner.equals(req.user._id)) {
      req.flash("error", "You cannot book your own property.");
      return res.redirect(`/listings/${listing._id}`);
    }

    // 3. Centralized validation for dates and guests
    const validation = validateBookingInput(req.body);
    if (!validation.valid) {
      req.flash("error", validation.error);
      return res.redirect(`/listings/${listing._id}`);
    }

    const { checkInDate, checkOutDate, guests: numGuests, nights } = validation.data;

    // 4. Capacity limit validation against specific property
    if (numGuests > listing.maxGuests) {
      req.flash(
        "error",
        `This property allows a maximum of ${listing.maxGuests} guest${listing.maxGuests !== 1 ? 's' : ''}.`
      );
      return res.redirect(`/listings/${listing._id}`);
    }

    const now = new Date();

    // 5. Expire stale pending bookings (15 minutes) and purge non-active inventory holds
    const staleBookings = await Booking.find({
      listing: listing._id,
      status: "pending",
      paymentStatus: "pending",
      expiresAt: { $lte: now },
    }).select("_id");

    if (staleBookings.length > 0) {
      const staleIds = staleBookings.map((b) => b._id);
      await Booking.updateMany({ _id: { $in: staleIds } }, { $set: { status: "expired" } });
      await DailyAvailability.deleteMany({ booking: { $in: staleIds } });
    }

    const inactiveBookings = await Booking.find({
      listing: listing._id,
      status: { $in: ["cancelled", "expired"] },
    }).select("_id");
    if (inactiveBookings.length > 0) {
      await DailyAvailability.deleteMany({ booking: { $in: inactiveBookings.map((b) => b._id) } });
    }
    await DailyAvailability.deleteMany({ listing: listing._id, status: "hold", expiresAt: { $lte: now } });

    // 6. Overlap Check (Zero Double-Booking Guarantee)
    const conflictingBooking = await Booking.findOne({
      listing: listing._id,
      $or: [
        { status: "confirmed" },
        {
          status: "pending",
          paymentStatus: "pending",
          expiresAt: { $gt: now },
        },
      ],
      checkIn: { $lt: checkOutDate },
      checkOut: { $gt: checkInDate },
    });

    if (conflictingBooking) {
      req.flash(
        "error",
        "The selected dates are already booked or currently on hold for payment. Please choose different dates."
      );
      return res.redirect(`/listings/${listing._id}`);
    }

    // 7. Generate date night strings
    const datesToReserve = getBookingDateStrings(checkInDate, checkOutDate);

    // 8. Calculate total price strictly on the backend
    const pricePerNight = listing.price;
    const totalPrice = nights * pricePerNight; // Guest pays accommodation total
    const platformCommission = Math.round(totalPrice * 0.05); // 5% Nestora commission
    const hostEarnings = totalPrice - platformCommission; // Net host payout
    const holdExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute hold

    // 8. Instantiate Booking document
    const booking = new Booking({
      listing: listing._id,
      guest: req.user._id,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      guests: numGuests,
      nights,
      pricePerNight,
      serviceFee: platformCommission,
      platformCommission,
      hostEarnings,
      totalPrice,
      cancellationPolicy: listing.cancellationPolicy || "flexible",
      status: "pending",
      paymentStatus: "pending",
      expiresAt: holdExpiresAt,
    });

    // 9. Atomic Inventory Locking: Insert daily records with compound unique index
    const inventoryDocs = datesToReserve.map((d) => ({
      listing: listing._id,
      date: d,
      booking: booking._id,
      status: "hold",
      expiresAt: holdExpiresAt,
    }));

    try {
      await DailyAvailability.insertMany(inventoryDocs, { ordered: true });
    } catch (err) {
      // Duplicate key collision (E11000) or race condition cleanly caught at DB level
      req.flash(
        "error",
        "The selected dates are already booked or currently on hold for payment. Please choose different dates."
      );
      return res.redirect(`/listings/${listing._id}`);
    }

    // Inventory successfully secured atomically!
    await booking.save();
    listing.bookings.push(booking._id);
    await listing.save();

    req.flash("success", "Reservation initiated! Please complete payment within 15 minutes to confirm your stay.");
    res.redirect(`/bookings/${booking._id}/payment`);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /bookings/my — Guest bookings dashboard
// ---------------------------------------------------------------------------
module.exports.myBookings = async (req, res, next) => {
  try {
    const bookings = await Booking.find({ guest: req.user._id })
      .populate({
        path: "listing",
        populate: { path: "owner", select: "username email" },
      })
      .sort({ createdAt: -1 });

    res.render("bookings/my", {
      title: "My Reservations",
      bookings,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /bookings/host — Host reservations dashboard
// ---------------------------------------------------------------------------
module.exports.hostBookings = async (req, res, next) => {
  try {
    const myListings = await Listing.find({ owner: req.user._id }).select("_id");
    const listingIds = myListings.map((l) => l._id);

    const bookings = await Booking.find({ listing: { $in: listingIds } })
      .populate("listing")
      .populate("guest", "username email")
      .sort({ createdAt: -1 });

    res.render("bookings/host", {
      title: "Host Reservations",
      bookings,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /bookings/:id — Booking confirmation & details
// ---------------------------------------------------------------------------
module.exports.show = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate({
        path: "listing",
        populate: { path: "owner", select: "username email" },
      })
      .populate("guest", "username email");

    if (!booking) {
      req.flash("error", "Booking not found.");
      return res.redirect("/bookings/my");
    }

    const isGuest = booking.guest._id.equals(req.user._id);
    const isHost =
      booking.listing &&
      booking.listing.owner &&
      booking.listing.owner._id.equals(req.user._id);
    const isAdmin = req.user.role === "admin";

    if (!isGuest && !isHost && !isAdmin) {
      req.flash("error", "You do not have permission to view that booking.");
      return res.redirect("/bookings/my");
    }

    // Auto-update expired pending booking state if viewed after 15m hold
    if (booking.status === "pending" && booking.paymentStatus === "pending" && booking.isExpired()) {
      booking.status = "expired";
      await booking.save();
      await DailyAvailability.deleteMany({ booking: booking._id });
    }

    res.render("bookings/show", {
      title: `Reservation #${booking._id.toString().slice(-6).toUpperCase()}`,
      booking,
      isGuest,
      isHost,
      isAdmin,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST/PUT /bookings/:id/cancel — Cancel a reservation & process verified refund
// ---------------------------------------------------------------------------
module.exports.cancel = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id).populate("listing");

    if (!booking) {
      req.flash("error", "Booking not found.");
      return res.redirect("/bookings/my");
    }

    // Authorization: Only the guest who booked, the host of the property, or an admin
    const isGuest = booking.guest.equals(req.user._id);
    const isHost =
      booking.listing && booking.listing.owner.equals(req.user._id);
    const isAdmin = req.user.role === "admin";

    if (!isGuest && !isHost && !isAdmin) {
      req.flash("error", "You do not have permission to cancel that booking.");
      return res.redirect("/bookings/my");
    }

    // Idempotency: Avoid double cancellations or re-triggering refunds
    if (booking.status === "cancelled") {
      req.flash("info", "This reservation has already been cancelled.");
      return res.redirect(`/bookings/${booking._id}`);
    }

    if (booking.status === "expired") {
      req.flash("error", "This reservation has already expired.");
      return res.redirect(`/bookings/${booking._id}`);
    }

    // Calculate refund details according to listing policy
    const refundDetails = refundService.calculateCancellationRefund(booking);
    let finalRefundStatus = refundDetails.refundStatus;
    let razorpayRefundId = undefined;

    // Dispatch Razorpay refund if booking was paid and eligible for refund
    if (refundDetails.refundAmount > 0 && booking.paymentStatus === "paid") {
      const refundResult = await refundService.processRazorpayRefund({
        paymentId: booking.razorpayPaymentId,
        amountInRupees: refundDetails.refundAmount,
        bookingId: booking._id,
        notes: { reason: refundDetails.refundReason },
      });

      if (refundResult.success) {
        finalRefundStatus = refundResult.status || "completed";
        razorpayRefundId = refundResult.refundId;
      } else {
        finalRefundStatus = "failed";
      }
    }

    booking.status = "cancelled";
    booking.cancelledAt = new Date();
    booking.cancelledBy = req.user._id;
    booking.refundStatus = finalRefundStatus;
    booking.refundAmount = refundDetails.refundAmount;
    booking.refundReason = refundDetails.refundReason;
    booking.razorpayRefundId = razorpayRefundId;
    if (finalRefundStatus === "completed") {
      booking.refundedAt = new Date();
    }
    await booking.save();

    // Idempotently update payment ledger
    if (booking.paymentStatus === "paid") {
      await Payment.findOneAndUpdate(
        { booking: booking._id },
        {
          $set: {
            status: finalRefundStatus === "completed" ? "refunded" : "cancelled",
            razorpayRefundId,
            refundAmount: refundDetails.refundAmount,
          },
        }
      );
    }

    // Release daily inventory dates immediately so they become bookable
    await DailyAvailability.deleteMany({ booking: booking._id });

    // Immutable audit record
    await auditService.recordAuditLog({
      action: "booking.cancelled",
      actor: req.user,
      actorRole: req.user.role,
      actorUsername: req.user.username,
      targetType: "Booking",
      targetId: booking._id,
      metadata: {
        refundStatus: booking.refundStatus,
        refundAmount: booking.refundAmount,
        razorpayRefundId: booking.razorpayRefundId,
        policy: booking.cancellationPolicy,
        guestId: booking.guest._id || booking.guest,
      },
      req,
    });

    // Send cancellation notification to guest
    const guestUser = await User.findById(booking.guest);
    if (guestUser) {
      emailService.sendBookingCancellationEmail(booking, guestUser, {
        ...refundDetails,
        refundStatus: finalRefundStatus,
      }).catch((e) => {
        console.error("Booking cancellation email error:", e.message);
      });
    }

    // Provide honest, truthful communication regarding refund confirmation
    let flashMessage = "Your reservation has been cancelled.";
    if (finalRefundStatus === "completed") {
      flashMessage = `Your reservation has been cancelled and a refund of ₹${refundDetails.refundAmount.toLocaleString()} has been confirmed and processed.`;
    } else if (finalRefundStatus === "pending") {
      flashMessage = `Your reservation has been cancelled. A refund of ₹${refundDetails.refundAmount.toLocaleString()} is currently pending confirmation from Razorpay.`;
    } else if (finalRefundStatus === "failed") {
      flashMessage = `Your reservation has been cancelled. However, the automated refund failed to process and our support team has been notified.`;
    }

    req.flash("success", flashMessage);
    res.redirect(`/bookings/${booking._id}`);
  } catch (err) {
    next(err);
  }
};
