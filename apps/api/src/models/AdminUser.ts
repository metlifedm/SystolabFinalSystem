import mongoose, { Schema } from "mongoose";

export type AdminRole = "owner" | "manager";

export interface AdminUserDocument extends mongoose.Document {
  adminUserId: string;
  email: string;
  passwordHash: string;
  role: AdminRole;
  isActive: boolean;
  createdBy: string;
  loginFailureCount: number;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminUserSchema = new Schema<AdminUserDocument>(
  {
    adminUserId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["owner", "manager"], required: true, index: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: String, required: true },
    loginFailureCount: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    lastLoginAt: { type: Date }
  },
  { timestamps: true }
);

export const AdminUser = mongoose.model<AdminUserDocument>("AdminUser", AdminUserSchema);
