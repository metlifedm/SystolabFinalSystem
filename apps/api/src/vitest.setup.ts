import mongoose from "mongoose";
// Disable Mongoose operation buffering so operations fail immediately (not after 5s timeout)
// when no MongoDB connection is available. Services with isMongoConnected() checks use
// their in-memory fallbacks instead.
mongoose.set("bufferCommands", false);
