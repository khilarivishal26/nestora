// Nestora Environment Configuration Validator.
// Enforces fail-fast startup checks to ensure production/staging secrets and configurations are valid.

/**
 * Validates essential environment variables and fails fast in production if any are missing or insecure.
 * In development/testing/staging, emits non-blocking warnings.
 *
 * @param {Object} [options]
 * @param {boolean} [options.isProduction] - Override environment check (default: process.env.NODE_ENV === 'production')
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateEnv(options = {}) {
  const isProduction =
    options.isProduction !== undefined
      ? options.isProduction
      : process.env.NODE_ENV === "production";

  const isStaging = process.env.NODE_ENV === "staging";
  const isTest = process.env.NODE_ENV === "test" && options.isProduction !== true;

  const errors = [];
  const warnings = [];

  // In test mode, allow tests to run with minimal test configuration unless testing production mode
  if (isTest) {
    return { valid: true, errors: [], warnings: [] };
  }

  // 1. Database Connection String
  const mongoUri = (process.env.MONGODB_URI || "").trim();
  if (!mongoUri) {
    if (isProduction) {
      errors.push("MONGODB_URI is required in production (e.g. mongodb+srv://user:pass@cluster.mongodb.net/nestora).");
    } else {
      warnings.push("MONGODB_URI not set. Falling back to local mongodb://127.0.0.1:27017/nestora.");
    }
  } else if (isProduction && (mongoUri.includes("127.0.0.1") || mongoUri.includes("localhost"))) {
    errors.push("MONGODB_URI must not point to localhost in production.");
  }

  // 2. Session Secret Security
  const sessionSecret = (process.env.SESSION_SECRET || "").trim();
  const insecurePlaceholders = [
    "secret",
    "session_secret",
    "keyboard cat",
    "development_secret",
    "123456",
    "default_secret",
    "nestora_dev_fallback_secret_32_chars_long!!",
  ];

  if (!sessionSecret) {
    if (isProduction) {
      errors.push("SESSION_SECRET is required in production. Must be a 32+ char random string (e.g. openssl rand -hex 32).");
    } else {
      warnings.push("SESSION_SECRET is not configured in .env. Using ephemeral dev secret.");
    }
  } else if (isProduction) {
    if (sessionSecret.length < 32) {
      errors.push(`SESSION_SECRET is too short (${sessionSecret.length} chars). Production requires at least 32 characters.`);
    }
    if (insecurePlaceholders.includes(sessionSecret.toLowerCase())) {
      errors.push("SESSION_SECRET is using an insecure default/placeholder string.");
    }
  }

  // 3. Razorpay Gateway Keys & Live Payment Mode Feature Flag
  const razorpayKeyId = (process.env.RAZORPAY_KEY_ID || "").trim();
  const razorpayKeySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
  const razorpayWebhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  const enableLivePayments = process.env.ENABLE_LIVE_PAYMENTS === "true";

  if (isProduction) {
    if (!razorpayKeyId) {
      errors.push("RAZORPAY_KEY_ID is missing in production environment.");
    }
    if (!razorpayKeySecret) {
      errors.push("RAZORPAY_KEY_SECRET is missing in production environment.");
    }
    if (!razorpayWebhookSecret) {
      errors.push("RAZORPAY_WEBHOOK_SECRET is missing in production environment.");
    }

    if (razorpayKeyId.startsWith("rzp_live_") && !enableLivePayments) {
      warnings.push(
        "Live Razorpay Key ID (rzp_live_*) detected but ENABLE_LIVE_PAYMENTS is not set to 'true'. Live charges will be safely held in Sandbox mode."
      );
    }
  } else {
    if (!razorpayKeyId || !razorpayKeySecret) {
      warnings.push("Razorpay keys (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) not set. Payment checkout will run in sandbox/mock test mode.");
    }
  }

  // 4. Cloudinary Media Storage
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const cloudKey = (process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY || "").trim();
  const cloudSecret = (process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET || "").trim();
  const cloudinaryUrl = (process.env.CLOUDINARY_URL || "").trim();

  const hasCloudinary = cloudinaryUrl || (cloudName && cloudKey && cloudSecret);
  if (isProduction && !hasCloudinary) {
    errors.push("Cloudinary configuration missing in production (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).");
  } else if (!hasCloudinary) {
    warnings.push("Cloudinary credentials not configured. Image uploads will use fallback placeholder media.");
  }

  // 5. Mapbox Maps
  const mapboxToken = (process.env.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_TOKEN || "").trim();
  if (isProduction && !mapboxToken) {
    warnings.push("MAPBOX_ACCESS_TOKEN is not configured. Interactive property maps will display fallback pin cards.");
  }

  // 6. SMTP Transactional Email (Optional in dev, recommended in production)
  const smtpHost = (process.env.SMTP_HOST || "").trim();
  const smtpUser = (process.env.SMTP_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || "").trim();
  if (isProduction && (!smtpHost || !smtpUser || !smtpPass)) {
    warnings.push("SMTP email credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) not configured. Emails will be logged to stdout/outbox fallback.");
  }

  const valid = errors.length === 0;

  if (!valid && isProduction) {
    console.error("\n=======================================================");
    console.error("❌ CRITICAL: NESTORA PRODUCTION STARTUP VALIDATION FAILED");
    console.error("=======================================================");
    errors.forEach((err, i) => console.error(` [${i + 1}] ${err}`));
    console.error("=======================================================\n");
  } else if (warnings.length > 0 && !isTest) {
    console.warn("\n-------------------------------------------------------");
    console.warn("⚠️  Nestora Configuration Warnings:");
    warnings.forEach((warn, i) => console.warn(` [${i + 1}] ${warn}`));
    console.warn("-------------------------------------------------------\n");
  }

  return { valid, errors, warnings };
}

module.exports = {
  validateEnv,
};
