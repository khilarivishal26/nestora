// Nestora Audit Logging Service — Phase 5: Startup Essentials.
// Records immutable audit logs for administrative, financial, and lifecycle events.

const AuditLog = require("../models/AuditLog");

/**
 * Creates an audit log entry.
 * @param {Object} params
 * @param {string} params.action - Event action (e.g. 'listing.approved', 'booking.cancelled')
 * @param {Object} [params.actor] - User object or null for system
 * @param {string} [params.actorRole] - 'admin' | 'host' | 'guest' | 'system'
 * @param {string} params.targetType - 'Listing' | 'Booking' | 'Payment' | 'User'
 * @param {string} params.targetId - ID of the target resource
 * @param {Object} [params.metadata] - Additional structured context
 * @param {Object} [params.req] - Express request object for IP and user-agent extraction
 */
async function recordAuditLog({
  action,
  actor = null,
  actorRole = "system",
  actorUsername = "system",
  targetType,
  targetId,
  metadata = {},
  req = null,
}) {
  try {
    const ipAddress = req
      ? req.ip || req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || ""
      : "";
    const userAgent = req ? req.headers?.["user-agent"] || "" : "";

    const resolvedActorId = actor?._id || (typeof actor === "string" ? actor : null);
    const resolvedRole = actor?.role || actorRole;
    const resolvedUsername = actor?.username || actorUsername;

    const logEntry = new AuditLog({
      action,
      actor: resolvedActorId,
      actorRole: resolvedRole,
      actorUsername: resolvedUsername,
      targetType,
      targetId: String(targetId),
      metadata,
      ipAddress,
      userAgent,
    });

    await logEntry.save();
    return logEntry;
  } catch (err) {
    console.error("Failed to record audit log (non-fatal):", err.message);
    return null;
  }
}

module.exports = {
  recordAuditLog,
};
