const express = require("express");
const router = express.Router();
const { isLoggedIn } = require("../middleware/auth");

// Renders the temporary Phase 1 home page through the shared layout.
// Full home page content (hero, search, featured listings) is Step 18.
router.get("/", (req, res) => {
  res.render("home", { title: "Home" });
});

// Temporary Phase 1 verification page - proves isLoggedIn middleware
// and session-based auth work end to end. Becomes the real profile
// page in a later phase.
router.get("/profile", isLoggedIn, (req, res) => {
  res.render("profile", { title: "Profile" });
});

// Upgrade the logged-in user's role from "guest" to "host" so they
// can create property listings.  This is the minimal mechanism needed
// for Phase 2 — a full host-onboarding flow can replace it later.
router.post("/become-host", isLoggedIn, async (req, res, next) => {
  try {
    if (req.user.role === "host" || req.user.role === "admin") {
      req.flash("error", "You are already a host.");
      return res.redirect("/profile");
    }

    req.user.role = "host";
    await req.user.save();

    req.flash("success", "You are now a host! You can list properties.");
    res.redirect("/profile");
  } catch (err) {
    next(err);
  }
});

module.exports = router;