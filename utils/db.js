// Small reusable MongoDB connection helper.
// app.js waits for this promise to resolve before starting the server,
// so we never accept requests without a working database connection.

const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/nestora";

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
  } catch (err) {
    if (uri.startsWith("mongodb+srv://") && process.env.NODE_ENV !== "production") {
      console.warn(
        `MongoDB Atlas connection failed (${err.message}). Attempting fallback to local MongoDB instance...`
      );
      try {
        await mongoose.connect("mongodb://127.0.0.1:27017/nestora", {
          serverSelectionTimeoutMS: 5000,
        });
        console.log(`MongoDB fallback connected: ${mongoose.connection.name}`);
        return;
      } catch (localErr) {
        throw new Error(`Failed to connect to MongoDB: ${err.message}`);
      }
    }
    throw err;
  }
}

module.exports = connectDB;
