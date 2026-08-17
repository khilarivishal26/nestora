// Nestora host routes — Phase 7: Dashboards.
// Protected routes for host dashboard and operations.

const express = require("express");
const router = express.Router();

const hostController = require("../controllers/hostController");
const { isLoggedIn, isHost } = require("../middleware/auth");

// Host dashboard overview
router.get("/dashboard", isLoggedIn, isHost, hostController.dashboard);

module.exports = router;
