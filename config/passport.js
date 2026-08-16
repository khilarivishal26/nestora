// Nestora Passport configuration.
// Uses passport-local to authenticate against the User model by username +
// password, and stores only the user's ID in the session (serializeUser).

const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const User = require("../models/User");

// Nestora logs in with "username" (not email), so this uses passport-local's
// default usernameField - no override needed, but it's spelled out here
// for clarity.
passport.use(
  new LocalStrategy({ usernameField: "username" }, async (username, password, done) => {
    try {
      const user = await User.findOne({ username: username.trim() });

      if (!user) {
        return done(null, false, { message: "Invalid username or password." });
      }

      const isMatch = await user.comparePassword(password);

      if (!isMatch) {
        return done(null, false, { message: "Invalid username or password." });
      }

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

// Only the user's ID is stored in the session cookie/store.
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// On each request, the ID from the session is used to look up the
// full user document and attach it to req.user.
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;