// Nestora - main Express application entry point.

require("dotenv").config();

const express = require("express");
const path = require("path");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const passport = require("./config/passport");
const connectDB = require("./utils/db");
const indexRouter = require("./routes/index");
const authRouter = require("./routes/auth");
const { notFound, errorHandler } = require("./middleware/error");

const app = express();
const PORT = process.env.PORT || 3000;

// EJS-Mate lets pages declare a shared layout (views/layouts/boilerplate.ejs)
// instead of duplicating the full HTML document on every page.
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Parse form submissions.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static assets (CSS/JS) from /public.
app.use(express.static(path.join(__dirname, "public")));

// Sessions are stored in MongoDB (not memory), so logins survive server
// restarts and work correctly if we ever run more than one server process.
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  touchAfter: 24 * 60 * 60, // only re-save an unchanged session once a day
});

sessionStore.on("error", (err) => {
  console.error("Session store error:", err);
});

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // secure cookies require HTTPS - only turn this on in production,
      // otherwise the cookie won't be set at all over plain HTTP in dev.
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// Passport must be initialized after the session middleware, since
// passport.session() reads the session set up above.
app.use(passport.initialize());
app.use(passport.session());

app.use(flash());

// Makes the logged-in user and flash messages available in every EJS
// template automatically, so we don't have to pass them manually in
// every single route.
app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  next();
});

app.use("/", indexRouter);
app.use("/", authRouter);

// Basic 404 handler - refined further in the error-handling step.
app.use((req, res) => {
  res.status(404).send("Page not found.");
});

// Any request that didn't match a route above falls through to here.
app.use(notFound);

// Centralized error handler - must be defined last, with 4 arguments,
// so Express recognizes it as an error-handling middleware.
app.use(errorHandler);

// The server only starts listening once the database connection succeeds.
// This avoids accepting traffic that would immediately fail on DB access.
async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Nestora server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start Nestora server:", err.message);
    process.exit(1);
  }
}

startServer();