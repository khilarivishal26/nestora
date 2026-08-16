// Small reusable MongoDB connection helper.
// app.js waits for this promise to resolve before starting the server,
// so we never accept requests without a working database connection.

const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is not set. Check your .env file.");
  }

  await mongoose.connect(uri);
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}

module.exports = connectDB;
