// Nestora Safe Image Upload Middleware.
// Wraps Multer and provides user-friendly flash error responses for size/count/type limits.

const multer = require("multer");
const { upload } = require("../config/cloudinary");

/**
 * Middleware that handles multi-image uploads safely with flash messages on errors.
 */
function handleImageUpload(req, res, next) {
  const uploadHandler = upload.array("images", 5);

  uploadHandler(req, res, (err) => {
    if (err) {
      let errorMessage = "Failed to upload image. Please try again.";

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          errorMessage = "Image file is too large. Maximum allowed size is 5MB per image.";
        } else if (err.code === "LIMIT_FILE_COUNT") {
          errorMessage = "Too many images. You can upload a maximum of 5 images at once.";
        } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
          errorMessage = "Unexpected upload field received.";
        } else {
          errorMessage = `Upload error: ${err.message}`;
        }
      } else if (err.message) {
        errorMessage = err.message;
      }

      req.flash("error", errorMessage);
      const redirectUrl = req.originalUrl.includes("/edit")
        ? req.originalUrl
        : req.path.includes("/new") || req.method === "POST"
        ? "/listings/new"
        : "/listings";
      return res.redirect(redirectUrl);
    }
    next();
  });
}

module.exports = {
  handleImageUpload,
};
