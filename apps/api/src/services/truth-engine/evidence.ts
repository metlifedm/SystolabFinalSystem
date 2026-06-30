import type {
  DimensionKey,
  EvidenceFreshnessMetadata,
  EvidenceObject,
  EvidenceSourceType,
  EvidenceVisibilityState,
  RenderState,
  ValidationMethod
} from "@systolab/shared";
import { sha256, stableStringify } from "../../utils/crypto.js";

export interface EvidenceInput {
  sourceType: EvidenceSourceType;
  url: string;
  pageRole: string;
  selectorPath?: string | null;
  rawValue: string;
  normalizedInput: Record<string, unknown>;
  validationMethod: ValidationMethod;
  confidenceBasis: string;
  groundTruthConfidence: number;
  groundTruthMeaning?: string;
  rawDomSnapshot?: string;
  renderState?: RenderState;
  renderVisibility?: EvidenceVisibilityState;
  renderVerification?: string;
  httpSnippet?: string;
  screenshotRef?: string | null;
  dimensionRefs: DimensionKey[];
}

export class EvidenceBuilder {
  private sequence = 0;

  constructor(private readonly snapshotSeed: string) {}

  add(input: EvidenceInput): EvidenceObject {
    this.sequence += 1;
    const now = new Date().toISOString();
    const freshness = buildEvidenceFreshness(input, now);
    const hash = sha256(stableStringify({ ...input, freshness, snapshotSeed: this.snapshotSeed, sequence: this.sequence }));
    return {
      evidenceId: `EO-${String(this.sequence).padStart(4, "0")}-${hash.slice(0, 10)}`,
      selectorPath: input.selectorPath ?? null,
      timestamp: now,
      freshness,
      groundTruthMeaning: input.groundTruthMeaning ?? meaningForGtcs(input.groundTruthConfidence),
      renderVisibility: input.renderVisibility ?? defaultVisibility(input),
      hash,
      ...input
    };
  }
}

export function snippet(value: string, max = 900): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function meaningForGtcs(score: number): string {
  if (score >= 85) return "High cross-source confidence from deterministic HTTP, DOM, parser, or render evidence.";
  if (score >= 70) return "Usable cross-source confidence with a documented validation limitation.";
  if (score >= 50) return "Limited confidence; evidence is retained for transparency but should be reviewed.";
  return "Low confidence; evidence is included as a constraint or failure signal only.";
}

function defaultVisibility(input: EvidenceInput): EvidenceVisibilityState {
  if (input.sourceType === "http" || input.sourceType === "system" || input.sourceType === "network") return "not_applicable";
  if (input.renderState === "dynamic_javascript") return "dynamically_injected";
  if (input.renderState === "not_rendered") return "not_rendered";
  if (String(input.normalizedInput.value) === "false") return "hidden";
  return "visible_below_fold";
}

function buildEvidenceFreshness(input: EvidenceInput, now: string): EvidenceFreshnessMetadata {
  const expectation: EvidenceFreshnessMetadata["updateFrequencyExpectation"] =
    input.sourceType === "http" || input.sourceType === "network" ? "per_scan" :
    input.sourceType === "render" ? "per_scan" :
    String(input.normalizedInput.signalKey ?? "").includes("competitor") ? "weekly" :
    String(input.normalizedInput.signalKey ?? "").includes("freshness") ? "monthly" :
    "per_scan";

  return {
    acquiredAt: now,
    validatedAt: now,
    sourceRecency: "current_scan",
    updateFrequencyExpectation: expectation,
    freshnessStatus: "fresh",
    confidenceAdjustment: 0
  };
}
