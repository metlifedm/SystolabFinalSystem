import mongoose from "mongoose";
import { env } from "../config/env.js";

let mongoConnected = false;

export async function connectMongo(): Promise<void> {
  mongoose.set("strictQuery", true);
  if (!env.mongoUri) {
    if (env.memoryStore) {
      mongoConnected = false;
      console.warn("MONGODB_URI is not set; SYSTOLAB_MEMORY_STORE=true so the API is using an in-memory development store.");
      return;
    }
    throw new Error("MONGODB_URI is required unless SYSTOLAB_MEMORY_STORE=true.");
  }
  try {
    await mongoose.connect(env.mongoUri, {
      autoIndex: env.nodeEnv !== "production"
    });
    mongoConnected = true;
  } catch (error) {
    if (!env.memoryStore) throw error;
    mongoConnected = false;
    const message = error instanceof Error ? error.message : "unknown MongoDB connection error";
    console.warn(`MongoDB unavailable; SYSTOLAB_MEMORY_STORE=true so the API is using an in-memory development store. ${message}`);
  }
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  mongoConnected = false;
}

export function isMongoConnected(): boolean {
  return mongoConnected;
}
