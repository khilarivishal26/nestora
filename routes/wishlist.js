// Nestora Wishlist Routes.
// All wishlist routes require authentication via isLoggedIn.

const express = require("express");
const router = express.Router();
const wishlistController = require("../controllers/wishlistController");
const { isLoggedIn } = require("../middleware/auth");

router.use(isLoggedIn);

router.get("/", wishlistController.index);
router.post("/toggle/:id", wishlistController.toggle);
router.post("/:id/remove", wishlistController.remove);
router.delete("/:id", wishlistController.remove);

module.exports = router;
