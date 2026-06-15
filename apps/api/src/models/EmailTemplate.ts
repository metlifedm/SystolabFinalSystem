import mongoose, { Schema } from "mongoose";

export type EmailTemplateType =
  | "scan_completed"
  | "alert_triggered"
  | "invitation"
  | "welcome"
  | "report_ready"
  | "subscription_update"
  | "billing_alert";

export interface EmailTemplateDocument extends mongoose.Document {
  templateId: string;
  tenantSlug: string;
  templateType: EmailTemplateType;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  fromName?: string;
  fromEmail?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EmailTemplateSchema = new Schema<EmailTemplateDocument>(
  {
    templateId: { type: String, required: true, unique: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    templateType: { type: String, required: true, index: true },
    subject: { type: String, required: true },
    bodyHtml: { type: String, required: true },
    bodyText: { type: String, required: true },
    fromName: { type: String },
    fromEmail: { type: String },
    isActive: { type: Boolean, required: true, default: true }
  },
  { timestamps: true }
);

EmailTemplateSchema.index({ tenantSlug: 1, templateType: 1 });

export const EmailTemplate = mongoose.model<EmailTemplateDocument>("EmailTemplate", EmailTemplateSchema);
