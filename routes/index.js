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

module.exports = router;