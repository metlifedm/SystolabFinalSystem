import mongoose, { Schema } from "mongoose";
import type { AuthProviderType, UserLifecycleState } from "@systolab/shared";

export interface AuthUserDocument extends mongoose.Document {
  email?: string;
  phone?: string;
  googleId?: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  avatarUrl?: string;
  locale?: string;
  googleHostedDomain?: string;
  googleClaimsCapturedAt?: Date;
  googleAvailableClaims: string[];
  passwordHash?: string;
  providers: AuthProviderType[];
  emailVerified: boolean;
  phoneVerified: boolean;
  googleVerified: boolean;
  lifecycleState: UserLifecycleState;
  loginFailureCount: number;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AuthUserSchema = new Schema<AuthUserDocument>(
  {
    email: { type: String, lowercase: true, trim: true, unique: true, sparse: true, index: true },
    phone: { type: String, trim: true, unique: true, sparse: true, index: true },
    googleId: { type: String, trim: true, unique: true, sparse: true, index: true },
    displayName: { type: String, trim: true },
    givenName: { type: String, trim: true },
    familyName: { type: String, trim: true },
    avatarUrl: { type: String, trim: true },
    locale: { type: String, trim: true },
    googleHostedDomain: { type: String, trim: true },
    googleClaimsCapturedAt: { type: Date },
    googleAvailableClaims: { type: [String], default: [] },
    passwordHash: { type: String },
    providers: { type: [String], default: [] },
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },
    googleVerified: { type: Boolean, default: false },
    lifecycleState: {
      type: String,
      enum: ["PENDING", "VERIFIED", "SUSPENDED", "LOCKED", "DELETED"],
      default: "PENDING",
      index: true
    },
    loginFailureCount: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    lastLoginAt: { type: Date },
    deletedAt: { type: Date }
  },
  { timestamps: true }
);

export const AuthUser = mongoose.model<AuthUserDocument>("AuthUser", AuthUserSchema);
