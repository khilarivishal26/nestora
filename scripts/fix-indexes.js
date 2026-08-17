require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../utils/db");

async function fixIndexes() {
  await connectDB();
  try {
    const coll = mongoose.connection.collection("reviews");
    const indexes = await coll.indexes();
    console.log("Current reviews indexes:", indexes);
    for (const idx of indexes) {
      if (idx.name !== "_id_") {
        await coll.dropIndex(idx.name);
        console.log(`Dropped index: ${idx.name}`);
      }
    }
  } catch (err) {
    console.log("No existing reviews collection or error:", err.message);
  }
  await mongoose.connection.close();
}

fixIndexes();
