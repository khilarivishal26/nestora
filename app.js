// Nestora - main Express application entry point.

require("dotenv").config();

const dns = require("dns");
try {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
} catch (e) {
  /* Ignore if custom DNS server override is not permitted */
}

const mongoose = require("mongoose");
const express = require("express");
const path = require("path");
const ejsMate = require("ejs-mate");
const methodOverride = require("method-override");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const passport = require("./config/passport");
const connectDB = require("./utils/db");
const indexRouter = require("./routes/index");
const authRouter = require("./routes/auth");
const listingsRouter = require("./routes/listings");
const reviewsRouter = require("./routes/reviews");
const bookingsRouter = require("./routes/bookings");
const hostRouter = require("./routes/host");
const adminRouter = require("./routes/admin");
const wishlistRouter = require("./routes/wishlist");
const Wishlist = require("./models/Wishlist");
const paymentController = require("./controllers/paymentController");
const { notFound, errorHandler } = require("./middleware/error");

const app = express();
const PORT = process.env.PORT || 8080;

// In production behind reverse proxies (Render, Railway, AWS, NGINX),
// trust the proxy header so secure cookies and client IPs are handled properly.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// EJS-Mate lets pages declare a shared layout (views/layouts/boilerplate.ejs)
// instead of duplicating the full HTML document on every page.
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Parse form submissions and capture raw body for webhook verification
app.use(express.urlencoded({ extended: true }));
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// method-override lets HTML forms send PUT and DELETE requests via a
// query-string flag, e.g. POST /listings/123?_method=DELETE.
app.use(methodOverride("_method"));

// Serve static assets (CSS/JS) from /public.
app.use(express.static(path.join(__dirname, "public")));

const mongoUri = (process.env.MONGODB_URI || "").trim() || (process.env.NODE_ENV !== "production" ? "mongodb://127.0.0.1:27017/nestora" : "");

const sessionStore = MongoStore.create({
  mongoUrl: mongoUri,
  dbName: "nestora",
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
      sameSite: "lax",
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
app.use(async (req, res, next) => {
  res.locals.currentUser = req.user;
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.mapboxAccessToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_TOKEN || "";
  res.locals.mapboxToken = res.locals.mapboxAccessToken;

  // Make saved wishlist listing IDs available to all EJS templates for instant favorite state
  if (req.user) {
    try {
      const userWishlist = await Wishlist.find({ user: req.user._id }).select("listing");
      res.locals.wishlistListingIds = userWishlist.map((w) => w.listing.toString());
    } catch (e) {
      res.locals.wishlistListingIds = [];
    }
  } else {
    res.locals.wishlistListingIds = [];
  }

  next();
});

// Health check route for cloud liveness & readiness probes
app.get("/health", (req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;
  res.status(isDbConnected ? 200 : 503).json({
    status: isDbConnected ? "ok" : "degraded",
    service: "nestora",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: isDbConnected ? "connected" : "disconnected",
    environment: process.env.NODE_ENV || "development",
  });
});

app.post("/webhook/razorpay", paymentController.handleWebhook);

app.use("/", indexRouter);
app.use("/", authRouter);
app.use("/listings", listingsRouter);
app.use("/listings/:id/reviews", reviewsRouter);
app.use("/bookings", bookingsRouter);
app.use("/host", hostRouter);
app.use("/admin", adminRouter);
app.use("/wishlist", wishlistRouter);

// Any request that didn't match a route above falls through to here.
app.use(notFound);

// Centralized error handler - must be defined last, with 4 arguments,
// so Express recognizes it as an error-handling middleware.
app.use(errorHandler);

// The server only starts listening once the database connection succeeds.
// This avoids accepting traffic that would immediately fail on DB access.
let server;
async function startServer() {
  try {
    await connectDB();
    server = app.listen(PORT, () => {
      console.log(`Nestora server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start Nestora server:", err.message);
    process.exit(1);
  }
}

function gracefulShutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  if (server) {
    server.close(async () => {
      console.log("HTTP server closed.");
      try {
        await mongoose.connection.close();
        console.log("MongoDB connection closed.");
        process.exit(0);
      } catch (e) {
        console.error("Error closing MongoDB connection:", e);
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

startServer();