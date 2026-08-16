/**
 * One-time script to create the first admin user.
 *
 * Usage: node scripts/seedAdmin.js
 *
 * Default credentials (change after first login):
 *   username: admin
 *   email:    admin@nestora.com
 *   password: Admin@123
 */

require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const connectDB = require("../utils/db");

const DEFAULT_ADMIN = {
  username: "admin",
  email: "admin@nestora.com",
  password: "Admin@123",
  role: "admin",
};

async function seedAdmin() {
  await connectDB();

  const existingAdmin = await User.findOne({ role: "admin" });
  if (existingAdmin) {
    console.log(`Admin user already exists: ${existingAdmin.username}`);
    await mongoose.connection.close();
    return;
  }

  const existingUsername = await User.findOne({ username: DEFAULT_ADMIN.username });
  if (existingUsername) {
    existingUsername.role = "admin";
    await existingUsername.save();
    console.log(`Updated existing user "${existingUsername.username}" to admin role.`);
    await mongoose.connection.close();
    return;
  }

  const admin = new User(DEFAULT_ADMIN);
  await admin.save();

  console.log("Admin user created successfully.");
  console.log(`  Username: ${DEFAULT_ADMIN.username}`);
  console.log(`  Email:    ${DEFAULT_ADMIN.email}`);
  console.log(`  Password: ${DEFAULT_ADMIN.password}`);
  console.log("Change the password after your first login.");

  await mongoose.connection.close();
}

seedAdmin().catch(async (err) => {
  console.error("Failed to seed admin user:", err.message);
  try {
    await mongoose.connection.close();
  } catch (e) {
    /* ignore */
  }
  process.exit(1);
});
