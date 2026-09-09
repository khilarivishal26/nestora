const crypto = require("crypto");
const passport = require("passport");
const User = require("../models/User");
const { validateRegisterInput } = require("../middleware/validators");
const emailService = require("../services/emailService");
const auditService = require("../services/auditService");

module.exports.renderRegisterForm = (req, res) => {
  res.render("auth/register", { title: "Register" });
};

module.exports.register = async (req, res, next) => {
  try {
    const validation = validateRegisterInput(req.body);
    if (!validation.valid) {
      req.flash("error", validation.error);
      return res.redirect("/register");
    }

    const { username, email, password } = validation.data;

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      req.flash("error", "Email is already registered.");
      return res.redirect("/register");
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      req.flash("error", "That username is already taken.");
      return res.redirect("/register");
    }

    // Generate email verification token (valid for 24 hours)
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const newUser = new User({
      username,
      email,
      password,
      isVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires,
    });
    await newUser.save();

    // Send verification email asynchronously
    emailService.sendVerificationEmail(newUser, verificationToken).catch((e) => {
      console.error("Verification email send error:", e.message);
    });

    await auditService.recordAuditLog({
      action: "user.registered",
      actor: newUser,
      actorRole: newUser.role,
      actorUsername: newUser.username,
      targetType: "User",
      targetId: newUser._id,
      metadata: { email: newUser.email },
      req,
    });

    req.login(newUser, (err) => {
      if (err) return next(err);
      req.flash("success", "Welcome to Nestora! A verification link has been sent to your email.");
      res.redirect("/");
    });
  } catch (err) {
    next(err);
  }
};

module.exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      req.flash("error", "Email verification token is invalid or has expired.");
      return res.redirect("/");
    }

    user.isVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    await auditService.recordAuditLog({
      action: "user.email_verified",
      actor: user,
      actorRole: user.role,
      actorUsername: user.username,
      targetType: "User",
      targetId: user._id,
      metadata: { email: user.email },
      req,
    });

    req.flash("success", "Your email has been successfully verified! Thank you.");
    res.redirect("/profile");
  } catch (err) {
    next(err);
  }
};

module.exports.resendVerification = async (req, res, next) => {
  try {
    const user = req.user || (req.body.email ? await User.findOne({ email: req.body.email.trim().toLowerCase() }) : null);

    if (!user) {
      req.flash("error", "User account not found.");
      return res.redirect("/login");
    }

    if (user.isVerified) {
      req.flash("info", "Your email is already verified.");
      return res.redirect("/profile");
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    emailService.sendVerificationEmail(user, verificationToken).catch((e) => {
      console.error("Resend verification email error:", e.message);
    });

    req.flash("success", "A new verification link has been sent to your email.");
    res.redirect(req.user ? "/profile" : "/login");
  } catch (err) {
    next(err);
  }
};

module.exports.renderLoginForm = (req, res) => {
  res.render("auth/login", { title: "Login" });
};

module.exports.login = (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) return next(err);

    if (!user) {
      req.flash("error", (info && info.message) || "Invalid username or password.");
      return res.redirect("/login");
    }

    req.login(user, (err) => {
      if (err) return next(err);
      req.flash("success", `Welcome back, ${user.username}!`);
      res.redirect("/");
    });
  })(req, res, next);
};

module.exports.renderForgotPassword = (req, res) => {
  res.render("auth/forgot-password", { title: "Forgot Password" });
};

module.exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email || !email.trim()) {
      req.flash("error", "Please provide your registered email address.");
      return res.redirect("/forgot-password");
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (user) {
      const resetToken = crypto.randomBytes(32).toString("hex");
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry
      await user.save();

      emailService.sendPasswordResetEmail(user, resetToken).catch((e) => {
        console.error("Password reset email send error:", e.message);
      });

      await auditService.recordAuditLog({
        action: "user.password_reset_requested",
        actor: user,
        actorRole: user.role,
        actorUsername: user.username,
        targetType: "User",
        targetId: user._id,
        metadata: { email: user.email },
        req,
      });
    }

    // Generic safe message preventing user email enumeration
    req.flash(
      "success",
      "If an account exists with that email, a password reset link has been sent."
    );
    res.redirect("/login");
  } catch (err) {
    next(err);
  }
};

module.exports.renderResetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      req.flash("error", "Password reset link is invalid or has expired.");
      return res.redirect("/forgot-password");
    }

    res.render("auth/reset-password", {
      title: "Reset Password",
      token,
    });
  } catch (err) {
    next(err);
  }
};

module.exports.resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (!password || password.length < 6) {
      req.flash("error", "New password must be at least 6 characters long.");
      return res.redirect(`/reset-password/${token}`);
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");
      return res.redirect(`/reset-password/${token}`);
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      req.flash("error", "Password reset link is invalid or has expired.");
      return res.redirect("/forgot-password");
    }

    // Update password (pre('save') hook will hash it automatically)
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    await auditService.recordAuditLog({
      action: "user.password_reset_completed",
      actor: user,
      actorRole: user.role,
      actorUsername: user.username,
      targetType: "User",
      targetId: user._id,
      metadata: { email: user.email },
      req,
    });

    req.flash("success", "Your password has been successfully updated. Please log in with your new password.");
    res.redirect("/login");
  } catch (err) {
    next(err);
  }
};

module.exports.logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash("success", "You have been logged out.");
    res.redirect("/");
  });
};