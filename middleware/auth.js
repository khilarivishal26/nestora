// Nestora authentication/authorization middleware.
// Phase 1 keeps this simple: check req.isAuthenticated() (from Passport)
// and req.user.role. More granular permission logic comes in later phases.

module.exports.isLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.flash("error", "Please log in to continue.");
    return res.redirect("/login");
  }
  next();
};

// Allows only users with the "guest" role (the default role for anyone
// who registers). Mirrors the pattern used by isHost/isAdmin below.
module.exports.isGuest = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.flash("error", "Please log in to continue.");
    return res.redirect("/login");
  }

  if (req.user.role !== "guest") {
    req.flash("error", "You do not have permission to access that page.");
    return res.redirect("/");
  }

  next();
};

module.exports.isHost = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.flash("error", "Please log in to continue.");
    return res.redirect("/login");
  }

  if (req.user.role !== "host") {
    req.flash("error", "You do not have permission to access that page.");
    return res.redirect("/");
  }

  next();
};

module.exports.isAdmin = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.flash("error", "Please log in to continue.");
    return res.redirect("/login");
  }

  if (req.user.role !== "admin") {
    req.flash("error", "You do not have permission to access that page.");
    return res.redirect("/");
  }

  next();
};