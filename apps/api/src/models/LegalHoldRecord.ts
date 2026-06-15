import mongoose, { Schema } from "mongoose";

export type HoldScope =
  | "snapshot"
  | "workspace"
  | "tenant"
  | "intelligence_event"
  | "user"
  | "export";

export type HoldStatus = "active" | "released";

export interface LegalHoldDocument extends mongoose.Document {
  holdId: string;
  holdKey: string;
  scope: HoldScope;
  targetId: string;
  reason: string;
  heldAt: Date;
  releasedAt?: Date;
  status: HoldStatus;
  createdBy: string;
}

const LegalHoldSchema = new Schema<LegalHoldDocument>(
  {
    holdId: { type: String, required: true, unique: true, index: true },
    holdKey: { type: String, required: true, unique: true, index: true },
    scope: { type: String, required: true, index: true },
    targetId: { type: String, required: true, index: true },
    reason: { type: String, required: true },
    heldAt: { type: Date, required: true },
    releasedAt: { type: Date },
    status: { type: String, required: true, default: "active", index: true },
    createdBy: { type: String, required: true }
  },
  { timestamps: false }
);

export const LegalHoldRecord = mongoose.model<LegalHoldDocument>("LegalHoldRecord", LegalHoldSchema);
