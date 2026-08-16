const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

router.route("/register")
  .get(authController.renderRegisterForm)
  .post(authController.register);

router.route("/login")
  .get(authController.renderLoginForm)
  .post(authController.login);

// The navbar submits logout as a POST (a plain <a> link performing a
// destructive/state-changing action like logout is bad practice).
router.post("/logout", authController.logout);

module.exports = router;