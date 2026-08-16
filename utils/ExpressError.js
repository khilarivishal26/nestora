// A minimal custom error class so route handlers can throw/next() an
// error with a specific HTTP status code, e.g. next(new ExpressError(404, "Not found."))

class ExpressError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.message = message;
  }
}

module.exports = ExpressError;