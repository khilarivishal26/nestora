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
const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB maximum file size per image
    files: 5,                  // Maximum 5 images per upload
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Invalid image format. Only JPG, JPEG, PNG, and WebP images are allowed."));
    }
  },
});

module.exports = { cloudinary, upload };
