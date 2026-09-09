// Nestora payment controller — Razorpay Gateway Integration.
// Calculates amount on server, creates Razorpay Order, verifies cryptographic
// signature server-side, idempotently updates payment states, manages DailyAvailability locks, and handles refunds.

const crypto = require("crypto");
const Razorpay = require("razorpay");
const Booking = require("../models/Booking");
const Listing = require("../models/Listing");
const Payment = require("../models/Payment");
const User = require("../models/User");
const DailyAvailability = require("../models/DailyAvailability");
const auditService = require("../services/auditService");
const emailService = require("../services/emailService");

let razorpay = null;
function getRazorpayClient() {
  if (!razorpay && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    try {
      razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
    } catch (e) {
      console.error("Razorpay initialization error:", e.message);
    }
  }
  return razorpay;
}

// ---------------------------------------------------------------------------
// GET /bookings/:id/payment — Render Razorpay Checkout Page
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

    if (booking.status === "expired" || booking.isExpired()) {
      booking.status = "expired";
      await booking.save();
      await DailyAvailability.deleteMany({ booking: booking._id });
      req.flash(
        "error",
        "This reservation hold has expired (15-minute limit). Please choose your dates again."
      );
      return res.redirect(`/listings/${booking.listing ? (booking.listing._id || booking.listing) : ""}`);
    }

    // Strictly compute and verify payable amount on the server
    const expectedTotal = booking.nights * booking.pricePerNight; // Accommodation total paid by guest
    const platformCommission = Math.round(expectedTotal * 0.05); // 5% Nestora commission
    const hostEarnings = expectedTotal - platformCommission; // Net host payout

    if (booking.totalPrice !== expectedTotal || booking.platformCommission !== platformCommission) {
      booking.totalPrice = expectedTotal;
      booking.serviceFee = platformCommission;
      booking.platformCommission = platformCommission;
      booking.hostEarnings = hostEarnings;
      await booking.save();
    }

    const amountInPaise = booking.totalPrice * 100;
    let orderId = booking.razorpayOrderId;

    // Create a new Razorpay order if not already generated
    if (!orderId) {
      const client = getRazorpayClient();
      if (!client) {
        req.flash("error", "Payment gateway is currently unavailable. Please check your configuration.");
        return res.redirect(`/bookings/${booking._id}`);
      }

      try {
        const order = await client.orders.create({
          amount: amountInPaise,
          currency: "INR",
          receipt: `rcpt_${booking._id.toString().substring(0, 16)}`,
          notes: {
            bookingId: booking._id.toString(),
            guestId: req.user._id.toString(),
            listingId: booking.listing ? booking.listing._id.toString() : "",
          },
        });
        orderId = order.id;
        booking.razorpayOrderId = orderId;
        await booking.save();
      } catch (err) {
        console.error("Razorpay API order creation error:", err.message);
        req.flash("error", "Unable to create payment order. Please try again later.");
        return res.redirect(`/bookings/${booking._id}`);
      }
    }

    res.render("bookings/payment", {
      title: "Complete Payment",
      booking,
      orderId,
      amount: amountInPaise,
      currency: "INR",
      razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /bookings/:id/verify — Server-Side Cryptographic Signature Verification
// ---------------------------------------------------------------------------
module.exports.verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const booking = await Booking.findById(req.params.id).populate("listing");

    if (!booking) {
      req.flash("error", "Booking not found.");
      return res.redirect("/bookings/my");
    }

    // Ensure only booking guest or admin can change payment state
    if (!booking.guest.equals(req.user._id) && req.user.role !== "admin") {
      req.flash("error", "Unauthorized to verify payment.");
      return res.redirect("/bookings/my");
    }

    // Idempotency: If already confirmed and paid, avoid duplicate state mutations
    if (booking.paymentStatus === "paid" && booking.status === "confirmed") {
      req.flash("success", "Reservation is confirmed and paid.");
      return res.redirect(`/bookings/${booking._id}`);
    }

    if (booking.status === "cancelled") {
      req.flash("error", "Cannot pay for a cancelled reservation.");
      return res.redirect(`/bookings/${booking._id}`);
    }

    if (booking.status === "expired" || booking.isExpired()) {
      booking.status = "expired";
      booking.paymentStatus = "failed";
      await booking.save();
      await DailyAvailability.deleteMany({ booking: booking._id });
      req.flash(
        "error",
        "This reservation hold has expired (15-minute limit). Payment could not be confirmed."
      );
      return res.redirect("/bookings/my");
    }

    // Validate required parameters
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      booking.paymentStatus = "failed";
      await booking.save();
      await DailyAvailability.deleteMany({ booking: booking._id });
      req.flash("error", "Missing payment verification parameters.");
      return res.redirect(`/bookings/${booking._id}/payment`);
    }

    // Verify submitted order ID equals booking.razorpayOrderId
    if (!booking.razorpayOrderId || booking.razorpayOrderId !== razorpay_order_id) {
      booking.paymentStatus = "failed";
      await booking.save();
      await DailyAvailability.deleteMany({ booking: booking._id });
      req.flash("error", "Invalid or mismatched Razorpay order ID.");
      return res.redirect(`/bookings/${booking._id}/payment`);
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      console.error("RAZORPAY_KEY_SECRET is not configured");
      booking.paymentStatus = "failed";
      await booking.save();
      await DailyAvailability.deleteMany({ booking: booking._id });
      req.flash("error", "Payment gateway secret not configured.");
      return res.redirect(`/bookings/${booking._id}/payment`);
    }

    // Cryptographic signature verification: HMAC SHA256 (order_id + "|" + payment_id, secret)
    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      booking.paymentStatus = "failed";
      await booking.save();
      await DailyAvailability.deleteMany({ booking: booking._id });
      req.flash("error", "Payment signature verification failed. Please try again.");
      return res.redirect(`/bookings/${booking._id}/payment`);
    }

    // Mark booking as confirmed & paid
    booking.status = "confirmed";
    booking.paymentStatus = "paid";
    booking.razorpayOrderId = razorpay_order_id;
    booking.razorpayPaymentId = razorpay_payment_id;
    booking.razorpaySignature = razorpay_signature;
    booking.paidAt = new Date();
    await booking.save();

    // Lock DailyAvailability permanently for confirmed booking
    await DailyAvailability.updateMany(
      { booking: booking._id },
      { $set: { status: "confirmed", expiresAt: null } }
    );

    // Create or update immutable Payment audit record
    let payment = await Payment.findOne({ booking: booking._id });
    if (!payment) {
      payment = new Payment({
        booking: booking._id,
        guest: booking.guest,
        listing: booking.listing ? booking.listing._id : booking.listing,
        amount: booking.totalPrice,
        platformCommission: booking.platformCommission || Math.round(booking.totalPrice * 0.05),
        hostEarnings: booking.hostEarnings || (booking.totalPrice - Math.round(booking.totalPrice * 0.05)),
        currency: "INR",
        status: "succeeded",
        provider: "razorpay",
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      });
    } else {
      payment.status = "succeeded";
      payment.provider = "razorpay";
      payment.amount = booking.totalPrice;
      payment.platformCommission = booking.platformCommission || Math.round(booking.totalPrice * 0.05);
      payment.hostEarnings = booking.hostEarnings || (booking.totalPrice - Math.round(booking.totalPrice * 0.05));
      payment.razorpayOrderId = razorpay_order_id;
      payment.razorpayPaymentId = razorpay_payment_id;
      payment.razorpaySignature = razorpay_signature;
    }
    await payment.save();

    // Immutable audit record
    await auditService.recordAuditLog({
      action: "payment.verified",
      actor: req.user,
      actorRole: req.user.role,
      actorUsername: req.user.username,
      targetType: "Payment",
      targetId: payment._id,
      metadata: {
        bookingId: booking._id,
        amount: booking.totalPrice,
        razorpayPaymentId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
      },
      req,
    });

    // Dispatch booking confirmation email to guest
    const guestUser = await User.findById(booking.guest);
    const listingDoc = booking.listing && booking.listing.title ? booking.listing : await Listing.findById(booking.listing);
    if (guestUser && listingDoc) {
      emailService.sendBookingConfirmationEmail(booking, guestUser, listingDoc).catch((e) => {
        console.error("Booking confirmation email error:", e.message);
      });
    }

    req.flash("success", "Payment verified successfully! Your reservation is confirmed.");
    res.redirect(`/bookings/${booking._id}`);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /bookings/:id/failed — Handle Payment Failure & Cancellation
// ---------------------------------------------------------------------------
module.exports.handlePaymentFailure = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      req.flash("error", "Booking not found.");
      return res.redirect("/bookings/my");
    }

    // Ensure only booking guest or admin can change payment state
    if (!booking.guest.equals(req.user._id) && req.user.role !== "admin") {
      req.flash("error", "Unauthorized to update payment state.");
      return res.redirect("/bookings/my");
    }

    if (booking.paymentStatus !== "paid") {
      booking.paymentStatus = "failed";
      await booking.save();
      await DailyAvailability.deleteMany({ booking: booking._id });
    }

    await auditService.recordAuditLog({
      action: "payment.failed",
      actor: req.user,
      actorRole: req.user.role,
      actorUsername: req.user.username,
      targetType: "Booking",
      targetId: booking._id,
      metadata: {
        amount: booking.totalPrice,
        reason: "User cancelled or payment failed at checkout",
      },
      req,
    });

    req.flash(
      "error",
      "Payment was not completed or failed. You can retry paying below to confirm your stay."
    );
    res.redirect(`/bookings/${booking._id}/payment`);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /webhook/razorpay — Handle Webhooks from Razorpay
// ---------------------------------------------------------------------------
module.exports.handleWebhook = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (!secret) {
      console.error("RAZORPAY_WEBHOOK_SECRET is not configured");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    if (!signature) {
      return res.status(400).json({ error: "Missing webhook signature" });
    }

    const payload = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body);
    const shasum = crypto.createHmac("sha256", secret);
    shasum.update(payload);
    const digest = shasum.digest("hex");

    if (digest !== signature) {
      console.error("Razorpay webhook signature mismatch");
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    const event = req.body;

    if (event.event === "payment.captured" || event.event === "order.paid") {
      const paymentEntity = event.payload && event.payload.payment ? event.payload.payment.entity : null;
      const orderId = paymentEntity ? paymentEntity.order_id : (event.payload && event.payload.order ? event.payload.order.entity.id : null);
      const bookingId = paymentEntity && paymentEntity.notes ? paymentEntity.notes.bookingId : null;

      let booking = null;
      if (bookingId) {
        booking = await Booking.findById(bookingId);
      } else if (orderId) {
        booking = await Booking.findOne({ razorpayOrderId: orderId });
      }

      if (booking && booking.paymentStatus !== "paid") {
        booking.status = "confirmed";
        booking.paymentStatus = "paid";
        booking.razorpayPaymentId = paymentEntity ? paymentEntity.id : `pay_${Date.now()}`;
        booking.paidAt = new Date();
        await booking.save();

        await DailyAvailability.updateMany(
          { booking: booking._id },
          { $set: { status: "confirmed", expiresAt: null } }
        );

        const paymentDoc = await Payment.findOneAndUpdate(
          { booking: booking._id },
          {
            booking: booking._id,
            guest: booking.guest,
            listing: booking.listing,
            amount: booking.totalPrice,
            platformCommission: booking.platformCommission || Math.round(booking.totalPrice * 0.05),
            hostEarnings: booking.hostEarnings || (booking.totalPrice - Math.round(booking.totalPrice * 0.05)),
            currency: "INR",
            status: "succeeded",
            provider: "razorpay",
            razorpayOrderId: booking.razorpayOrderId,
            razorpayPaymentId: booking.razorpayPaymentId,
          },
          { upsert: true, new: true }
        );

        await auditService.recordAuditLog({
          action: "payment.webhook_captured",
          actorRole: "system",
          actorUsername: "razorpay_webhook",
          targetType: "Payment",
          targetId: paymentDoc ? paymentDoc._id : booking._id,
          metadata: {
            bookingId: booking._id,
            amount: booking.totalPrice,
            razorpayPaymentId: booking.razorpayPaymentId,
            razorpayOrderId: booking.razorpayOrderId,
          },
          req,
        });

        const guestUser = await User.findById(booking.guest);
        const listingDoc = await Listing.findById(booking.listing);
        if (guestUser && listingDoc) {
          emailService.sendBookingConfirmationEmail(booking, guestUser, listingDoc).catch((e) => {
            console.error("Webhook booking confirmation email error:", e.message);
          });
        }
      }
    } else if (event.event === "payment.failed") {
      const paymentEntity = event.payload && event.payload.payment ? event.payload.payment.entity : null;
      const orderId = paymentEntity ? paymentEntity.order_id : null;
      const booking = await Booking.findOne({ razorpayOrderId: orderId });

      if (booking && booking.paymentStatus !== "paid") {
        booking.paymentStatus = "failed";
        await booking.save();
        await DailyAvailability.deleteMany({ booking: booking._id });

        await Payment.findOneAndUpdate(
          { booking: booking._id },
          { status: "failed", provider: "razorpay" },
          { upsert: true }
        );

        await auditService.recordAuditLog({
          action: "payment.webhook_failed",
          actorRole: "system",
          actorUsername: "razorpay_webhook",
          targetType: "Booking",
          targetId: booking._id,
          metadata: { orderId },
          req,
        });
      }
    } else if (event.event === "refund.processed" || event.event === "refund.created") {
      const refundEntity = event.payload && event.payload.refund ? event.payload.refund.entity : null;
      const paymentId = refundEntity ? refundEntity.payment_id : null;

      if (paymentId) {
        const booking = await Booking.findOne({ razorpayPaymentId: paymentId });
        if (booking) {
          booking.refundStatus = "completed";
          booking.refundedAt = new Date();
          booking.razorpayRefundId = refundEntity.id;
          await booking.save();

          await Payment.findOneAndUpdate(
            { booking: booking._id },
            {
              $set: {
                status: "refunded",
                razorpayRefundId: refundEntity.id,
                refundAmount: (refundEntity.amount || 0) / 100,
              },
            }
          );
        }
      }
    }

    res.json({ status: "ok" });
  } catch (err) {
    console.error("Razorpay webhook error:", err);
    res.status(500).json({ error: "Webhook error" });
  }
};
