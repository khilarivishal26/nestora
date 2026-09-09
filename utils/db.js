// Small reusable MongoDB connection helper.
// app.js waits for this promise to resolve before starting the server,
// so we never accept requests without a working database connection.

const dns = require("dns");
const mongoose = require("mongoose");

// Configure public DNS resolvers to prevent querySrv ECONNREFUSED on MongoDB Atlas (SRV) connections
try {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
} catch (e) {
  /* Ignore if setting custom DNS servers is not supported in the host environment */
}

async function connectDB(uriOverride) {
  // If already connected to the requested target, return existing connection
  if (mongoose.connection.readyState === 1 && !uriOverride) {
    return mongoose.connection;
  }

  let uri = (uriOverride || process.env.MONGODB_URI_TEST || process.env.MONGODB_URI || "").trim();
  if (!uri && process.env.NODE_ENV !== "production") {
    uri = "mongodb://127.0.0.1:27017/nestora";
  }

  if (!uri) {
    throw new Error(
      "MONGODB_URI is missing in environment variables. Please add MONGODB_URI in your Render Dashboard -> Environment tab with your MongoDB Atlas connection string."
    );
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
    return mongoose.connection;
  } catch (err) {
    if (uri.startsWith("mongodb+srv://") && process.env.NODE_ENV !== "production") {
      console.warn(
        `MongoDB Atlas connection failed (${err.message}). Attempting fallback to local MongoDB instance...`
      );
      try {
        await mongoose.connect("mongodb://127.0.0.1:27017/nestora", {
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 5000,
        });
        console.log(`MongoDB fallback connected: ${mongoose.connection.name}`);
        return mongoose.connection;
      } catch (localErr) {
        throw new Error(`Failed to connect to MongoDB within 5s timeout: ${err.message} (Fallback failed: ${localErr.message})`);
      }
    }
    throw new Error(`Failed to connect to MongoDB at '${uri}' within 5s timeout: ${err.message}`);
  }
}

module.exports = connectDB;
