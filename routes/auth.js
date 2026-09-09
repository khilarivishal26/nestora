const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authLimiter } = require("../middleware/rateLimiter");

router.route("/register")
  .get(authController.renderRegisterForm)
  .post(authLimiter, authController.register);

router.route("/login")
  .get(authController.renderLoginForm)
  .post(authLimiter, authController.login);

// Email verification routes
router.get("/verify-email/:token", authController.verifyEmail);
router.post("/resend-verification", authLimiter, authController.resendVerification);

// Password reset routes
router.route("/forgot-password")
  .get(authController.renderForgotPassword)
  .post(authLimiter, authController.forgotPassword);

router.route("/reset-password/:token")
  .get(authController.renderResetPassword)
  .post(authLimiter, authController.resetPassword);

// The navbar submits logout as a POST (a plain <a> link performing a
// destructive/state-changing action like logout is bad practice).
router.post("/logout", authController.logout);

module.exports = router;