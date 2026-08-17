// Nestora booking controller — Phase 6: Booking & Availability.
// Handles reservation creation, overlap checking, price calculation,
// booking dashboards (guest & host), booking confirmation, and cancellations.

const Booking = require("../models/Booking");
const Listing = require("../models/Listing");

// ---------------------------------------------------------------------------
// POST /listings/:id/bookings — Create a new reservation
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

    const { checkIn, checkOut, guests } = req.body;

    if (!checkIn || !checkOut) {
      req.flash("error", "Please provide both check-in and check-out dates.");
      return res.redirect(`/listings/${listing._id}`);
    }

    // 3. Date parsing & normalization
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
      req.flash("error", "Invalid date format provided.");
      return res.redirect(`/listings/${listing._id}`);
    }

    // Set time to 00:00:00.000 for fair day comparisons
    checkInDate.setHours(0, 0, 0, 0);
    checkOutDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (checkInDate < today) {
      req.flash("error", "Check-in date cannot be in the past.");
      return res.redirect(`/listings/${listing._id}`);
    }

    if (checkOutDate <= checkInDate) {
      req.flash("error", "Check-out date must be after check-in date.");
      return res.redirect(`/listings/${listing._id}`);
    }

    // 4. Guest count validation
    const numGuests = Number(guests);
    if (!guests || isNaN(numGuests) || numGuests < 1) {
      req.flash("error", "Number of guests must be at least 1.");
      return res.redirect(`/listings/${listing._id}`);
    }

    if (numGuests > listing.maxGuests) {
      req.flash(
        "error",
        `This property allows a maximum of ${listing.maxGuests} guest${listing.maxGuests !== 1 ? 's' : ''}.`
      );
      return res.redirect(`/listings/${listing._id}`);
    }

    // 5. Overlap Check (Zero Double-Booking Guarantee)
    // Overlap exists if: existing.checkIn < new.checkOut AND existing.checkOut > new.checkIn
    const conflictingBooking = await Booking.findOne({
      listing: listing._id,
      status: { $in: ["confirmed", "pending"] },
      checkIn: { $lt: checkOutDate },
      checkOut: { $gt: checkInDate },
    });

    if (conflictingBooking) {
      req.flash(
        "error",
        "The selected dates are already booked for this property. Please choose different dates."
      );
      return res.redirect(`/listings/${listing._id}`);
    }

    // 6. Calculate nights and total price strictly on the backend
    const diffTime = Math.abs(checkOutDate - checkInDate);
    const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (nights < 1) {
      req.flash("error", "Reservation must be for at least 1 night.");
      return res.redirect(`/listings/${listing._id}`);
    }

    const pricePerNight = listing.price;
    const subtotal = nights * pricePerNight;
    const serviceFee = Math.round(subtotal * 0.05); // 5% Nestora service fee
    const totalPrice = subtotal + serviceFee;

    // 7. Create and persist booking
    const booking = new Booking({
      listing: listing._id,
      guest: req.user._id,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      guests: numGuests,
      nights,
      pricePerNight,
      serviceFee,
      totalPrice,
      status: "pending",
      paymentStatus: "pending",
    });

    await booking.save();

    listing.bookings.push(booking._id);
    await listing.save();

    req.flash("success", "Reservation initiated! Please complete payment to confirm your stay.");
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
    // Find all listings owned by the host
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

    // Access control: Guest, Host of property, or Admin
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
// POST/PUT /bookings/:id/cancel — Cancel a reservation
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

    if (booking.status === "cancelled") {
      req.flash("error", "This reservation has already been cancelled.");
      return res.redirect(`/bookings/${booking._id}`);
    }

    booking.status = "cancelled";
    await booking.save();

    req.flash("success", "Your reservation has been cancelled successfully.");
    res.redirect(`/bookings/${booking._id}`);
  } catch (err) {
    next(err);
  }
};
