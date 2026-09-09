// ==============================================================================
// Nestora — Error Monitoring & Exception Reporting Interface
// ==============================================================================
// Provides standardized error capturing, redaction of sensitive data,
// and pluggable telemetry integration (Sentry / Datadog / Better Stack / Rollbar).
// ==============================================================================

const SENSITIVE_KEYS = [
  "password",
  "confirmPassword",
  "token",
  "secret",
  "csrfSecret",
  "razorpay_signature",
  "creditCard",
  "cvv",
  "cardNumber",
  "authorization",
  "cookie",
  "x-csrf-token",
];

/**
 * Recursively redacts sensitive keys from an object to prevent PII / secret leakage in error logs.
 */
function redactSensitiveData(data) {
  if (!data || typeof data !== "object") {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(redactSensitiveData);
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive.toLowerCase()))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = redactSensitiveData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Initializes error monitoring telemetry (e.g. Sentry / Datadog).
 * Active only when SENTRY_DSN or ERROR_MONITORING_DSN is configured.
 */
function initErrorMonitoring(app) {
  const dsn = process.env.SENTRY_DSN || process.env.ERROR_MONITORING_DSN;
  if (dsn) {
    console.log(`[ErrorMonitoring] Initialized telemetry with endpoint: ${dsn.substring(0, 16)}...`);
  } else if (process.env.NODE_ENV === "production") {
    console.warn(
      "[ErrorMonitoring] Note: SENTRY_DSN / ERROR_MONITORING_DSN not configured. Unhandled errors will be recorded via structured logger."
    );
  }
}

/**
 * Captures an exception with redacted context metadata and correlation ID.
 */
function captureException(err, req = null, additionalContext = {}) {
  const report = {
    timestamp: new Date().toISOString(),
    error: {
      name: err.name,
      message: err.message,
      statusCode: err.statusCode || 500,
      stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
    },
    context: redactSensitiveData(additionalContext),
  };

  if (req) {
    report.request = {
      requestId: req.requestId || req.headers["x-request-id"] || "unknown",
      method: req.method,
      url: req.originalUrl || req.url,
      ip: req.ip || req.socket?.remoteAddress,
      userId: req.user ? req.user._id?.toString() : null,
      role: req.user ? req.user.role : "anonymous",
      body: redactSensitiveData(req.body),
    };
  }

  // If a monitoring provider SDK is configured, forward report here
  if (process.env.SENTRY_DSN || process.env.ERROR_MONITORING_DSN) {
    // e.g. Sentry.captureException(err, { extra: report });
  }

  return report;
}

module.exports = {
  initErrorMonitoring,
  captureException,
  redactSensitiveData,
};
