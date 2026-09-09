// Nestora Email Service — Phase 5: Startup Essentials.
// Handles system notification emails: verification, password reset, booking confirmations, cancellations, and property approval statuses.

const nodemailer = require("nodemailer");

// In-memory outbox for testing and local inspection
const emailOutbox = [];

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return null;
}

const FROM_ADDRESS = process.env.EMAIL_FROM || "Nestora Stays <notifications@nestora.com>";
const APP_URL = process.env.APP_BASE_URL || "http://localhost:8080";

/**
 * Sends an email using nodemailer if configured, or records to outbox for dev/test environments.
 */
async function sendMail({ to, subject, html, text }) {
  const mailOptions = {
    from: FROM_ADDRESS,
    to,
    subject,
    text: text || html.replace(/<[^>]*>?/gm, ""),
    html,
  };

  emailOutbox.push({
    ...mailOptions,
    sentAt: new Date(),
  });

  const transporter = getTransporter();
  if (transporter && process.env.NODE_ENV !== "test") {
    try {
      return await transporter.sendMail(mailOptions);
    } catch (err) {
      console.error(`Failed to send email to ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // In test / dev without SMTP, log structured message
  if (process.env.NODE_ENV !== "test") {
    console.log(`[EMAIL DISPATCHED] To: ${to} | Subject: ${subject}`);
  }

  return { success: true, mocked: !transporter };
}

/**
 * 1. Email Verification
 */
async function sendVerificationEmail(user, token) {
  const verifyUrl = `${APP_URL}/verify-email/${token}`;
  const subject = "Verify your email address - Nestora";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #202522;">
      <h2 style="color: #174a3a;">Welcome to Nestora, ${user.username}!</h2>
      <p>Thank you for joining Nestora. Please verify your email address by clicking the link below:</p>
      <div style="margin: 24px 0;">
        <a href="${verifyUrl}" style="background: #174a3a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Verify Email Address
        </a>
      </div>
      <p style="color: #666; font-size: 0.9rem;">Or copy and paste this link into your browser: <br/><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="color: #888; font-size: 0.85rem;">This link expires in 24 hours.</p>
    </div>
  `;
  return sendMail({ to: user.email, subject, html });
}

/**
 * 2. Password Reset
 */
async function sendPasswordResetEmail(user, token) {
  const resetUrl = `${APP_URL}/reset-password/${token}`;
  const subject = "Reset your password - Nestora";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #202522;">
      <h2 style="color: #174a3a;">Password Reset Request</h2>
      <p>Hi ${user.username},</p>
      <p>We received a request to reset your Nestora account password. Click the button below to choose a new password:</p>
      <div style="margin: 24px 0;">
        <a href="${resetUrl}" style="background: #d9825b; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p style="color: #666; font-size: 0.9rem;">Or copy and paste this link into your browser: <br/><a href="${resetUrl}">${resetUrl}</a></p>
      <p style="color: #888; font-size: 0.85rem;">This link will expire in 1 hour. If you did not request this, please ignore this email.</p>
    </div>
  `;
  return sendMail({ to: user.email, subject, html });
}

/**
 * 3. Booking Confirmation
 */
async function sendBookingConfirmationEmail(booking, guest, listing) {
  const subject = `Booking Confirmed: ${listing.title} - Nestora`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #202522;">
      <h2 style="color: #174a3a;">🎉 Your Reservation is Confirmed!</h2>
      <p>Hi ${guest.username},</p>
      <p>Your stay at <strong>${listing.title}</strong> in ${listing.location}, ${listing.country} has been booked and paid.</p>
      <div style="background: #fdfaf6; border: 1px solid #eee5da; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 4px 0;"><strong>Check-in:</strong> ${new Date(booking.checkIn).toDateString()}</p>
        <p style="margin: 4px 0;"><strong>Check-out:</strong> ${new Date(booking.checkOut).toDateString()}</p>
        <p style="margin: 4px 0;"><strong>Nights:</strong> ${booking.nights}</p>
        <p style="margin: 4px 0;"><strong>Guests:</strong> ${booking.guests}</p>
        <p style="margin: 4px 0;"><strong>Total Paid:</strong> ₹${booking.totalPrice.toLocaleString()}</p>
        <p style="margin: 4px 0; font-size: 0.85rem; color: #777;">Booking Reference: ${booking._id}</p>
      </div>
      <p>View your full itinerary in your <a href="${APP_URL}/bookings/${booking._id}" style="color: #174a3a; font-weight: bold;">Nestora Dashboard</a>.</p>
    </div>
  `;
  return sendMail({ to: guest.email, subject, html });
}

/**
 * 4. Booking Cancellation & Refund Notification
 */
async function sendBookingCancellationEmail(booking, guest, refundDetails) {
  const subject = `Reservation Cancelled: Booking #${booking._id} - Nestora`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #202522;">
      <h2 style="color: #721c24;">Reservation Cancelled</h2>
      <p>Hi ${guest.username},</p>
      <p>Your reservation #${booking._id} has been cancelled.</p>
      <div style="background: #fdf7f7; border: 1px solid #ebd8d8; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 4px 0;"><strong>Cancellation Policy:</strong> ${booking.cancellationPolicy.toUpperCase()}</p>
        <p style="margin: 4px 0;"><strong>Refund Status:</strong> ${refundDetails.refundStatus.toUpperCase()}</p>
        <p style="margin: 4px 0;"><strong>Refund Amount:</strong> ₹${refundDetails.refundAmount.toLocaleString()}</p>
        <p style="margin: 4px 0; font-size: 0.85rem; color: #666;">${refundDetails.refundReason || ""}</p>
      </div>
      <p>If you have questions, please check your <a href="${APP_URL}/profile" style="color: #174a3a;">dashboard</a> or reach out to support.</p>
    </div>
  `;
  return sendMail({ to: guest.email, subject, html });
}

/**
 * 5. Listing Approval/Rejection Notification
 */
async function sendListingStatusEmail(listing, owner, status, remarks = "") {
  const isApproved = status === "approved";
  const subject = `Property Listing ${isApproved ? "Approved" : "Update"}: ${listing.title} - Nestora`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #202522;">
      <h2 style="color: ${isApproved ? "#174a3a" : "#856404"};">Property Review Update</h2>
      <p>Hi ${owner.username},</p>
      <p>Your property listing <strong>${listing.title}</strong> has been <strong>${status.toUpperCase()}</strong> by the Nestora Admin Team.</p>
      ${isApproved ? `<p>Your stay is now live and bookable by travelers worldwide!</p><p><a href="${APP_URL}/listings/${listing._id}" style="color: #174a3a; font-weight: bold;">View Public Listing</a></p>` : `<p>Remarks: ${remarks || "Property does not meet current platform guidelines."}</p>`}
    </div>
  `;
  return sendMail({ to: owner.email, subject, html });
}

module.exports = {
  sendMail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendBookingConfirmationEmail,
  sendBookingCancellationEmail,
  sendListingStatusEmail,
  emailOutbox,
};
