// Nestora Cloudinary configuration.
// Initialises the Cloudinary SDK and creates a multer storage engine
// that uploads files directly to Cloudinary.  The resulting middleware
// (`upload`) is used in listing routes to handle image file fields.
//
// Required env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
// CLOUDINARY_API_SECRET.  If these are missing, image uploads will
// fail at runtime with a clear Cloudinary error — the rest of the
// app (text fields, auth, etc.) still works fine.
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "nestora",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});
const upload = multer({ storage });
module.exports = { cloudinary, upload };
