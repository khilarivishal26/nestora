// ==============================================================================
// Nestora Rate Limiting Middleware
// ==============================================================================
// ARCHITECTURE NOTE:
// 1. Single-Instance Deployment (Beta Launch):
//    The current sliding-window implementation uses an in-memory Map. This is ideal
//    for single-instance container/monolith deployments (e.g., Render standard web
//    service), providing high-throughput rate limiting with zero external dependencies.
//
// 2. Multi-Instance / Horizontal Scaling Upgrade Path:
//    Because all route definitions consume the clean `(req, res, next)` middleware
//    contract, swapping this in-memory implementation for a distributed shared store
//    (e.g., Redis via `rate-limit-redis` or MongoDB-backed store) requires changing
//    only the internal store adapter in this file without modifying any routes or controllers.
// ==============================================================================

/**
 * Creates an in-memory sliding window rate limiter.
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Max requests allowed per window per IP
 * @param {string} options.message - Error message to return
 * @param {string} [options.prefix] - Key prefix for separating route buckets
 */
function createRateLimiter({ windowMs, max, message, prefix = "global" }) {
  const hits = new Map();

  // Periodic cleanup every 5 minutes to prevent memory leaks
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  if (interval.unref) {
    interval.unref();
  }

  return (req, res, next) => {
    // In test environment, allow disabling or resetting limiters if needed
    if (process.env.NODE_ENV === "test" && req.headers["x-disable-rate-limit"] === "true") {
      return next();
    }

    const ip = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
    const key = `${prefix}:${ip}`;
    const now = Date.now();

    let record = hits.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      hits.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetTime / 1000));

    if (record.count > max) {
      res.setHeader("Retry-After", retryAfterSec);

      if (req.xhr || req.headers.accept?.includes("json") || req.path?.startsWith("/webhook")) {
        return res.status(429).json({
          success: false,
          error: "Too Many Requests",
          message: message || "Too many requests, please try again later.",
          retryAfter: retryAfterSec,
        });
      }

      if (typeof req.flash === "function") {
        req.flash("error", message || `Too many attempts. Please try again in ${retryAfterSec} seconds.`);
      }
      const referer = req.headers.referer || "/";
      return res.status(429).redirect(referer);
    }

    next();
  };
}

// 1. Auth Limiter: max 15 login/register attempts per 15 minutes
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: "Too many authentication attempts. Please wait 15 minutes before trying again.",
  prefix: "auth",
});

// 2. Booking Limiter: max 30 reservation requests per 15 minutes
const bookingLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many reservation requests. Please try again in a few minutes.",
  prefix: "booking",
});

// 3. Payment Limiter: max 50 payment interactions per 15 minutes
const paymentLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: "Too many payment operations. Please try again in a few minutes.",
  prefix: "payment",
});

// 4. Webhook Limiter: max 120 incoming webhooks per minute
const webhookLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: "Webhook rate limit exceeded.",
  prefix: "webhook",
});

module.exports = {
  createRateLimiter,
  authLimiter,
  bookingLimiter,
  paymentLimiter,
  webhookLimiter,
};
