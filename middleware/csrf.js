// Nestora CSRF Protection Middleware.
// Generates and validates session-bound anti-CSRF tokens for all state-changing requests.

const crypto = require("crypto");

/**
 * Generates a random 32-byte hex token and binds it to the user's session.
 */
function generateToken(req) {
  if (!req.session) {
    return "";
  }
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrfSecret;
}

/**
 * Middleware that populates `req.csrfToken()` and `res.locals.csrfToken` for all requests,
 * and validates tokens on state-changing HTTP methods (POST, PUT, PATCH, DELETE).
 *
 * Exemptions:
 * - Safe HTTP methods: GET, HEAD, OPTIONS
 * - Webhooks: /webhook/razorpay (verified cryptographically via HMAC-SHA256 signature)
 */
function csrfProtection(req, res, next) {
  // Expose csrfToken generator to templates and controllers
  const token = generateToken(req);
  if (res) {
    if (!res.locals) res.locals = {};
    res.locals.csrfToken = token;
  }
  req.csrfToken = () => token;

  // Safe HTTP methods do not require CSRF validation
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // Exempt external server-to-server webhooks
  if (req.path === "/webhook/razorpay" || req.originalUrl?.startsWith("/webhook/razorpay")) {
    return next();
  }

  // Extract token from request body, query params, or HTTP headers
  const submittedToken =
    (req.body && req.body._csrf) ||
    (req.query && req.query._csrf) ||
    req.headers["x-csrf-token"] ||
    req.headers["x-xsrf-token"] ||
    req.headers["csrf-token"];

  if (!submittedToken || !req.session || submittedToken !== req.session.csrfSecret) {
    // Handle AJAX / JSON requests
    if (req.xhr || req.headers.accept?.includes("json") || req.path?.includes("/toggle")) {
      return res.status(403).json({
        success: false,
        error: "Invalid or expired CSRF security token.",
        message: "Your session or security token has expired. Please refresh the page.",
      });
    }

    // Handle standard browser form submissions
    if (typeof req.flash === "function") {
      req.flash("error", "Your session or security token has expired. Please try again.");
    }
    const referer = req.headers.referer || "/";
    return res.status(403).redirect(referer);
  }

  next();
}

module.exports = {
  csrfProtection,
  generateToken,
};
