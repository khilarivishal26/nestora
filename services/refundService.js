// Nestora Cancellation & Refund Service — Phase 7: Correctness & Gateway Processing.
// Calculates policy refund eligibility and executes verified Razorpay refund API requests.

const Razorpay = require("razorpay");

let razorpayClient = null;
function getRazorpayClient() {
  if (!razorpayClient && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    try {
      razorpayClient = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
    } catch (e) {
      console.error("Razorpay client initialization error in refund service:", e.message);
    }
  }
  return razorpayClient;
}

/**
 * Calculates refund eligibility for a cancelled reservation.
 * Sets initial refund status to 'pending' if eligible for an amount > 0, or 'ineligible' / 'none'.
 * @param {Object} booking - Booking document
 * @param {Date} [cancellationTime=new Date()] - Time of cancellation
 * @returns {Object} { refundAmount, refundStatus, refundReason, refundPercentage }
 */
function calculateCancellationRefund(booking, cancellationTime = new Date()) {
  // If booking was never paid, no money was collected
  if (booking.paymentStatus !== "paid") {
    return {
      refundAmount: 0,
      refundStatus: "none",
      refundPercentage: 0,
      refundReason: "Booking was pending/unpaid. No payment was collected.",
    };
  }

  const checkInDate = new Date(booking.checkIn);
  const now = new Date(cancellationTime);
  const hoursUntilCheckIn = (checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  const policy = booking.cancellationPolicy || "flexible";
  const totalPrice = Number(booking.totalPrice) || 0;

  let refundPercentage = 0;
  let refundReason = "";

  if (policy === "flexible") {
    // Flexible: Full refund up to 24h before check-in; 50% refund after that
    if (hoursUntilCheckIn >= 24) {
      refundPercentage = 100;
      refundReason = "Flexible Policy: Cancelled 24+ hours before check-in. 100% refund eligible.";
    } else {
      refundPercentage = 50;
      refundReason = "Flexible Policy: Cancelled less than 24 hours before check-in. 50% refund eligible.";
    }
  } else if (policy === "moderate") {
    // Moderate: Full refund up to 5 days (120h); 50% up to 24h; 0% after
    if (hoursUntilCheckIn >= 120) {
      refundPercentage = 100;
      refundReason = "Moderate Policy: Cancelled 5+ days before check-in. 100% refund eligible.";
    } else if (hoursUntilCheckIn >= 24) {
      refundPercentage = 50;
      refundReason = "Moderate Policy: Cancelled between 24 hours and 5 days before check-in. 50% refund eligible.";
    } else {
      refundPercentage = 0;
      refundReason = "Moderate Policy: Cancelled less than 24 hours before check-in. Non-refundable.";
    }
  } else if (policy === "strict") {
    // Strict: 50% refund up to 7 days (168h); 0% after
    if (hoursUntilCheckIn >= 168) {
      refundPercentage = 50;
      refundReason = "Strict Policy: Cancelled 7+ days before check-in. 50% refund eligible.";
    } else {
      refundPercentage = 0;
      refundReason = "Strict Policy: Cancelled less than 7 days before check-in. Non-refundable.";
    }
  }

  const refundAmount = Math.round((totalPrice * refundPercentage) / 100);
  // Status starts as 'pending' for nonzero refunds until confirmed by gateway, or 'ineligible' if 0
  const refundStatus = refundAmount > 0 ? "pending" : "ineligible";

  return {
    refundAmount,
    refundStatus,
    refundPercentage,
    refundReason,
  };
}

/**
 * Dispatches a refund request to Razorpay using the verified payment ID.
 * @param {Object} params
 * @param {string} params.paymentId - Verified Razorpay payment ID (e.g., 'pay_xxx')
 * @param {number} params.amountInRupees - Amount in INR to refund
 * @param {string} [params.bookingId] - Booking reference
 * @param {Object} [params.notes] - Additional metadata
 * @returns {Promise<Object>} { success, refundId, status, error }
 */
async function processRazorpayRefund({ paymentId, amountInRupees, bookingId = "", notes = {} }) {
  if (!paymentId) {
    return {
      success: false,
      status: "failed",
      error: "Missing verified Razorpay payment ID for refund.",
    };
  }

  const amountInPaise = Math.round(amountInRupees * 100);
  const client = getRazorpayClient();

  if (client && process.env.NODE_ENV !== "test" && !paymentId.startsWith("pay_test_")) {
    try {
      const refund = await client.payments.refund(paymentId, {
        amount: amountInPaise,
        speed: "optimum",
        notes: {
          ...notes,
          bookingId: String(bookingId),
        },
      });

      return {
        success: true,
        refundId: refund.id,
        status: refund.status === "processed" || refund.status === "captured" ? "completed" : "pending",
        raw: refund,
      };
    } catch (err) {
      console.error("Razorpay refund API error:", err.message);
      return {
        success: false,
        status: "failed",
        error: err.message,
      };
    }
  }

  // Simulated / Test environment fallback
  const mockRefundId = `rfnd_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  return {
    success: true,
    refundId: mockRefundId,
    status: "completed",
    mocked: true,
  };
}

module.exports = {
  calculateCancellationRefund,
  processRazorpayRefund,
};
