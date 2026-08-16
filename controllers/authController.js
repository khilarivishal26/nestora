// Nestora authentication controller.
// Handles registration, login, and logout. Kept intentionally simple:
// straightforward validation, clear flash messages, no extra abstraction.

const passport = require("passport");
const User = require("../models/User");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports.renderRegisterForm = (req, res) => {
  res.render("auth/register", { title: "Register" });
};

module.exports.register = async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    // --- Basic validation ---
    if (!username || !username.trim()) {
      req.flash("error", "Username is required.");
      return res.redirect("/register");
    }

    if (!email || !EMAIL_REGEX.test(email.trim())) {
      req.flash("error", "Please enter a valid email address.");
      return res.redirect("/register");
    }

    if (!password || password.length < 6) {
      req.flash("error", "Password must be at least 6 characters long.");
      return res.redirect("/register");
    }

    const existingEmail = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingEmail) {
      req.flash("error", "Email is already registered.");
      return res.redirect("/register");
    }

    const existingUsername = await User.findOne({ username: username.trim() });
    if (existingUsername) {
      req.flash("error", "That username is already taken.");
      return res.redirect("/register");
    }

    // password is hashed automatically by the pre("save") hook on User.
    const newUser = new User({ username: username.trim(), email, password });
    await newUser.save();

    // Log the new user in immediately rather than sending them back to
    // a login form - fewer steps, same security since the password
    // was still required and validated.
    req.login(newUser, (err) => {
      if (err) return next(err);
      req.flash("success", "Welcome to Nestora! Your account has been created.");
      res.redirect("/");
    });
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

module.exports.logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash("success", "You have been logged out.");
    res.redirect("/");
  });
};