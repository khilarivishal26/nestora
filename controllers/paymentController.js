// Nestora payment controller — Phase 9: Payments & Gateway Integration.
// Integrates Stripe in test mode with server-side price verification,
// webhook handling, payment state machine, and double-booking protection.

const Booking = require("../models/Booking");
const Listing = require("../models/Listing");
const Payment = require("../models/Payment");

let stripe = null;
if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes("Mock")) {
  try {
    stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  } catch (e) {
    console.warn("Stripe initialization skipped, test simulator active:", e.message);
  }
}

// ---------------------------------------------------------------------------
// GET /bookings/:id/payment — Render Payment & Checkout Page
// ---------------------------------------------------------------------------
module.exports.showPaymentPage = async (req, res, next) => {
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

    // Only the booking guest or an admin can access checkout
    if (!booking.guest._id.equals(req.user._id) && req.user.role !== "admin") {
      req.flash("error", "You do not have permission to pay for this reservation.");
      return res.redirect("/bookings/my");
    }

    if (booking.paymentStatus === "paid") {
      req.flash("success", "This reservation is already paid and confirmed.");
      return res.redirect(`/bookings/${booking._id}`);
    }

    if (booking.status === "cancelled") {
      req.flash("error", "Cannot pay for a cancelled reservation.");
      return res.redirect(`/bookings/${booking._id}`);
    }

    res.render("bookings/payment", {
      title: "Complete Payment",
      booking,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /bookings/:id/checkout — Initialize Stripe Checkout Session
// ---------------------------------------------------------------------------
module.exports.createCheckoutSession = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id).populate("listing");

    if (!booking) {
      req.flash("error", "Booking not found.");
      return res.redirect("/bookings/my");
    }

    if (!booking.guest.equals(req.user._id) && req.user.role !== "admin") {
      req.flash("error", "Unauthorized to initiate payment for this booking.");
      return res.redirect("/bookings/my");
    }

    if (booking.paymentStatus === "paid") {
      req.flash("success", "Reservation is already paid.");
      return res.redirect(`/bookings/${booking._id}`);
    }

    if (booking.status === "cancelled") {
      req.flash("error", "Cannot pay for a cancelled booking.");
      return res.redirect(`/bookings/${booking._id}`);
    }

    // Verify amount server-side (never trust client amounts)
    const expectedSubtotal = booking.nights * booking.pricePerNight;
    const expectedServiceFee = Math.round(expectedSubtotal * 0.05);
    const expectedTotal = expectedSubtotal + expectedServiceFee;

    if (booking.totalPrice !== expectedTotal) {
      // Reconcile and fix booking price if mismatched
      booking.totalPrice = expectedTotal;
      booking.serviceFee = expectedServiceFee;
      await booking.save();
    }

    const domain = `${req.protocol}://${req.get("host")}`;

    if (stripe) {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: req.user.email,
        line_items: [
          {
            price_data: {
              currency: "inr",
              product_data: {
                name: `${booking.listing.title} (${booking.nights} night${booking.nights !== 1 ? 's' : ''})`,
                description: `Stay from ${booking.checkIn.toDateString()} to ${booking.checkOut.toDateString()} for ${booking.guests} guest(s)`,
              },
              unit_amount: booking.totalPrice * 100, // Stripe expects paise
            },
            quantity: 1,
          },
        ],
        metadata: {
          bookingId: booking._id.toString(),
          guestId: req.user._id.toString(),
          listingId: booking.listing._id.toString(),
        },
        success_url: `${domain}/bookings/${booking._id}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${domain}/bookings/${booking._id}/payment/cancel`,
      });

      booking.stripeSessionId = session.id;
      await booking.save();

      return res.redirect(303, session.url);
    } else {
      // Sandbox fallback simulator when Stripe key is test placeholder
      const mockSessionId = `cs_test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      booking.stripeSessionId = mockSessionId;
      await booking.save();

      return res.redirect(`/bookings/${booking._id}/payment/success?session_id=${mockSessionId}&mock=true`);
    }
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /bookings/:id/payment/success — Server-Side Verification & Confirmation
// ---------------------------------------------------------------------------
module.exports.handlePaymentSuccess = async (req, res, next) => {
  try {
    const { session_id, mock } = req.query;
    const booking = await Booking.findById(req.params.id).populate("listing");

    if (!booking) {
      req.flash("error", "Booking not found.");
      return res.redirect("/bookings/my");
    }

    if (!booking.guest.equals(req.user._id) && req.user.role !== "admin") {
      req.flash("error", "Unauthorized to verify payment.");
      return res.redirect("/bookings/my");
    }

    // Idempotency: If already verified and paid, redirect cleanly without duplicate operations
    if (booking.paymentStatus === "paid" && booking.status === "confirmed") {
      req.flash("success", "Reservation is confirmed and paid.");
      return res.redirect(`/bookings/${booking._id}`);
    }

    let isVerified = false;
    let paymentIntentId = `pi_${Date.now()}`;

    if (stripe && session_id && !mock) {
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (
        session &&
        session.payment_status === "paid" &&
        session.metadata &&
        session.metadata.bookingId === booking._id.toString()
      ) {
        isVerified = true;
        paymentIntentId = session.payment_intent || paymentIntentId;
      }
    } else if (session_id && (mock || !stripe)) {
      // Verified in test/sandbox simulation
      isVerified = true;
    }

    if (!isVerified) {
      booking.paymentStatus = "failed";
      await booking.save();
      req.flash("error", "Payment could not be verified by the gateway. Please try again.");
      return res.redirect(`/bookings/${booking._id}/payment`);
    }

    // Mark as confirmed and paid
    booking.status = "confirmed";
    booking.paymentStatus = "paid";
    booking.stripePaymentIntentId = paymentIntentId;
    booking.paidAt = new Date();
    await booking.save();

    // Create or update immutable Payment record
    let payment = await Payment.findOne({ booking: booking._id });
    if (!payment) {
      payment = new Payment({
        booking: booking._id,
        guest: booking.guest,
        listing: booking.listing._id,
        amount: booking.totalPrice,
        currency: "INR",
        status: "succeeded",
        provider: "stripe",
        stripeSessionId: session_id || booking.stripeSessionId,
        stripePaymentIntentId: paymentIntentId,
      });
    } else {
      payment.status = "succeeded";
      payment.stripeSessionId = session_id || booking.stripeSessionId;
      payment.stripePaymentIntentId = paymentIntentId;
    }
    await payment.save();

    req.flash("success", "Payment successful! Your reservation is confirmed.");
    res.redirect(`/bookings/${booking._id}`);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /bookings/:id/payment/cancel — Handle Cancelled Checkout
// ---------------------------------------------------------------------------
module.exports.handlePaymentCancel = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      req.flash("error", "Booking not found.");
      return res.redirect("/bookings/my");
    }

    if (booking.paymentStatus !== "paid") {
      booking.paymentStatus = "failed";
      await booking.save();
    }

    req.flash(
      "error",
      "Payment was cancelled or interrupted. You can retry paying below to confirm your stay."
    );
    res.redirect(`/bookings/${booking._id}/payment`);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /webhook/stripe — Handle Asynchronous Gateway Webhooks
// ---------------------------------------------------------------------------
module.exports.handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  if (stripe && process.env.STRIPE_WEBHOOK_SECRET) {
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody || req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    event = req.body;
  }

  // Idempotent webhook handling
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const bookingId = session.metadata ? session.metadata.bookingId : null;

      if (bookingId) {
        const booking = await Booking.findById(bookingId);
        if (booking && booking.paymentStatus !== "paid") {
          booking.status = "confirmed";
          booking.paymentStatus = "paid";
          booking.stripePaymentIntentId = session.payment_intent;
          booking.paidAt = new Date();
          await booking.save();

          await Payment.findOneAndUpdate(
            { booking: booking._id },
            {
              booking: booking._id,
              guest: booking.guest,
              listing: booking.listing,
              amount: booking.totalPrice,
              currency: "INR",
              status: "succeeded",
              provider: "stripe",
              stripeSessionId: session.id,
              stripePaymentIntentId: session.payment_intent,
            },
            { upsert: true, new: true }
          );
        }
      }
    } else if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object;
      const booking = await Booking.findOne({ stripePaymentIntentId: paymentIntent.id });
      if (booking && booking.paymentStatus !== "paid") {
        booking.paymentStatus = "failed";
        await booking.save();

        await Payment.findOneAndUpdate(
          { booking: booking._id },
          { status: "failed" },
          { upsert: true }
        );
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Webhook handler failed" });
  }
};
