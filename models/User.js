// Nestora User model.
// Roles: guest (default), host, admin.
// Passwords are always hashed with bcrypt before saving - never stored
// as plaintext. See the pre("save") hook below.

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required."],
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required."],
    },
    role: {
      type: String,
      enum: ["guest", "host", "admin"],
      default: "guest",
    },
    profileImage: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

// Hash the password automatically whenever it is set or changed.
// This runs for both new users and password updates, so controllers
// never need to remember to call bcrypt themselves.
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  try {
    this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
    next();
  } catch (err) {
    next(err);
  }
});

// Instance method used during login (Step 11) to check a submitted
// password against the stored hash.
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);