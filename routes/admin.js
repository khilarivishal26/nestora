// Nestora admin routes — Phase 3: Property Approval.
// Every route in this router is protected: only logged-in admins may access.

const express = require("express");
const router = express.Router();

const adminController = require("../controllers/adminController");
const { isLoggedIn, isAdmin } = require("../middleware/auth");

router.get("/", isLoggedIn, isAdmin, adminController.dashboard);
router.get("/audit-logs", isLoggedIn, isAdmin, adminController.viewAuditLogs);
router.put("/listings/:id/approve", isLoggedIn, isAdmin, adminController.approve);
router.put("/listings/:id/reject", isLoggedIn, isAdmin, adminController.reject);

module.exports = router;
