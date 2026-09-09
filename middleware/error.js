// Nestora centralized error handling.
// notFound catches any request that didn't match a route.
// errorHandler is the single place that turns any error (thrown,
// next(err)'d, or a Mongoose error) into a rendered error page.

const ExpressError = require("../utils/ExpressError");

module.exports.notFound = (req, res, next) => {
  next(new ExpressError(404, "Page not found."));
};

module.exports.errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Something went wrong. Please try again.";

  // Translate common Mongoose errors into friendlier messages instead
  // of leaking raw driver/schema error text to the user.
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(" ");
  }

  if (err.name === "CastError") {
    statusCode = 400;
    message = "Invalid ID format.";
  }

  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue || {})[0] || "value";
    message = `That ${field} is already in use.`;
  }

  const { captureException } = require("../utils/errorMonitoring");
  const errorReport = captureException(err, req);

  if (process.env.NODE_ENV !== "test") {
    console.error(
      `[ERROR] ${req.method} ${req.originalUrl || req.url} -> Status ${statusCode}: ${err.message} (Request ID: ${req.requestId || "unknown"})`
    );
  }

  res.status(statusCode).render("error", {
    title: "Error",
    statusCode,
    message,
    // Stack traces are only shown in development - never leak them
    // to users in production.
    stack: process.env.NODE_ENV === "development" ? err.stack : null,
  });
};