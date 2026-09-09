// Nestora AuditLog Model — Phase 5: Startup Essentials.
// Tracks critical platform events (listing approvals/rejections, payments, cancellations, refunds).

const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    actorRole: {
      type: String,
      default: "system",
      index: true,
    },
    actorUsername: {
      type: String,
      default: "system",
    },
    targetType: {
      type: String,
      required: true,
      enum: ["Listing", "Booking", "Payment", "User", "System"],
      index: true,
    },
    targetId: {
      type: String,
      required: true,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      default: "",
    },
    userAgent: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
