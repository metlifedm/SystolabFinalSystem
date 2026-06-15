import mongoose, { Schema } from "mongoose";

export type EngineSource = "scroll" | "cta" | "form" | "friction" | "exit" | "heatmap" | "journey";

export type BehavioralEventType =
  // Scroll Intelligence Engine
  | "scroll_depth"
  | "scroll_pause"
  | "scroll_reversal"
  | "section_engagement"
  // CTA Intelligence Engine
  | "cta_view"
  | "cta_hover"
  | "cta_click"
  | "cta_abandon"
  // Form Intelligence Engine
  | "form_start"
  | "form_field_focus"
  | "form_field_blur"
  | "form_field_complete"
  | "form_abandon"
  | "form_submit"
  // Friction Detection Engine
  | "rage_click"
  | "dead_click"
  | "hover_confusion"
  | "interaction_loop"
  | "navigation_uncertainty"
  // Exit Intelligence Engine
  | "exit_intent"
  | "page_exit"
  // Heatmap Intelligence Engine (deferred — accepted but not yet processed)
  | "heatmap_point"
  // Journey events
  | "page_view";

export interface BehavioralEventDocument extends mongoose.Document {
  eventId: string;
  sessionId: string;
  workspaceId: string;
  tenantSlug: string;
  engineSource: EngineSource;
  eventType: BehavioralEventType;
  page: string;
  timestamp: Date;
  data: Record<string, unknown>;
  processedAt?: Date;
  behavioralEvidenceId?: string;
}

const BehavioralEventSchema = new Schema<BehavioralEventDocument>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    tenantSlug: { type: String, required: true, index: true },
    engineSource: { type: String, required: true, index: true },
    eventType: { type: String, required: true, index: true },
    page: { type: String, required: true },
    timestamp: { type: Date, required: true, index: true },
    data: { type: Schema.Types.Mixed, default: {} },
    processedAt: { type: Date },
    behavioralEvidenceId: { type: String, index: true }
  },
  { timestamps: false, minimize: false }
);

BehavioralEventSchema.index({ workspaceId: 1, eventType: 1, timestamp: -1 });
BehavioralEventSchema.index({ sessionId: 1, timestamp: 1 });
BehavioralEventSchema.index({ workspaceId: 1, engineSource: 1, timestamp: -1 });

export const BehavioralEvent = mongoose.model<BehavioralEventDocument>("BehavioralEvent", BehavioralEventSchema);
