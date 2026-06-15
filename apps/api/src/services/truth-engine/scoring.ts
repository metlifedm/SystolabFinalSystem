import {
  clampScore,
  confidenceLevelForScore,
  DIMENSION_LABELS,
  type DimensionKey,
  type DimensionScore,
  type EvidenceObject,
  type ScoreTraceFactor,
  visualStateForScore
} from "@systolab/shared";

interface FactorDefinition {
  factorId: string;
  key: string;
  label: string;
  weight: number;
  direction?: "positive" | "negative" | "informational";
}

const DIMENSION_FACTORS: Record<DimensionKey, FactorDefinition[]> = {
  trust: [
    { factorId: "trust_https", key: "https_transport", label: "HTTPS transport observed", weight: 16 },
    { factorId: "trust_security_headers", key: "security_headers_score", label: "Security header coverage", weight: 14 },
    { factorId: "trust_contact_identity", key: "contact_signal_present", label: "Contact identity signals", weight: 18 },
    { factorId: "trust_privacy", key: "privacy_link_present", label: "Privacy policy visibility", weight: 12 },
    { factorId: "trust_terms", key: "terms_link_present", label: "Terms or policy visibility", weight: 8 },
    { factorId: "trust_about", key: "about_link_present", label: "About or company context", weight: 10 },
    { factorId: "trust_reviews", key: "review_signal_present", label: "Review or testimonial signals", weight: 12 },
    { factorId: "trust_social", key: "social_link_present", label: "External identity/social references", weight: 10 }
  ],
  accessibility: [
    { factorId: "a11y_lang", key: "lang_present", label: "HTML language attribute", weight: 18 },
    { factorId: "a11y_alt", key: "alt_coverage", label: "Image alternative text coverage", weight: 28 },
    { factorId: "a11y_labels", key: "label_coverage", label: "Form label coverage", weight: 24 },
    { factorId: "a11y_headings", key: "h1_present", label: "Primary heading structure", weight: 16 },
    { factorId: "a11y_mobile", key: "viewport_present", label: "Responsive viewport declaration", weight: 14 }
  ],
  renderingQuality: [
    { factorId: "render_environment", key: "render_environment_score", label: "Rendering environment classification", weight: 45 },
    { factorId: "render_dom", key: "dom_complexity_score", label: "DOM complexity score", weight: 25 },
    { factorId: "render_resource", key: "resource_weight_score", label: "Resource weight score", weight: 20 },
    { factorId: "render_text", key: "text_density_score", label: "Readable HTML text density", weight: 10 }
  ],
  stability: [
    { factorId: "stability_status", key: "http_status_success", label: "Successful HTTP status behavior", weight: 35 },
    { factorId: "stability_redirect", key: "redirect_stability", label: "Redirect stability", weight: 15 },
    { factorId: "stability_robots", key: "robots_allowed", label: "Robots.txt scan allowance", weight: 20 },
    { factorId: "stability_errors", key: "fetch_success_rate", label: "Fetch success rate", weight: 30 }
  ],
  mobileExperience: [
    { factorId: "mobile_viewport", key: "viewport_present", label: "Mobile viewport declaration", weight: 32 },
    { factorId: "mobile_resource", key: "resource_weight_score", label: "Mobile resource weight", weight: 24 },
    { factorId: "mobile_cta", key: "cta_present", label: "Mobile-action CTA availability", weight: 24 },
    { factorId: "mobile_forms", key: "form_or_contact_present", label: "Mobile contact path availability", weight: 20 }
  ],
  websiteHealth: [
    { factorId: "health_status", key: "http_status_success", label: "HTTP health", weight: 24 },
    { factorId: "health_metadata", key: "metadata_quality_score", label: "Metadata quality", weight: 18 },
    { factorId: "health_nav", key: "navigation_depth_score", label: "Internal navigation availability", weight: 18 },
    { factorId: "health_index", key: "indexability_present", label: "Indexability signals", weight: 16 },
    { factorId: "health_security", key: "security_headers_score", label: "Security hygiene", weight: 14 },
    { factorId: "health_resource", key: "resource_weight_score", label: "Resource efficiency", weight: 10 }
  ],
  visibilityStructure: [
    { factorId: "visibility_title", key: "title_present", label: "Title element", weight: 20 },
    { factorId: "visibility_description", key: "description_present", label: "Meta description", weight: 18 },
    { factorId: "visibility_h1", key: "h1_present", label: "Primary heading", weight: 20 },
    { factorId: "visibility_canonical", key: "canonical_present", label: "Canonical signal", weight: 12 },
    { factorId: "visibility_links", key: "internal_link_score", label: "Internal link structure", weight: 20 },
    { factorId: "visibility_robots", key: "indexability_present", label: "Robots indexability", weight: 10 }
  ],
  conversionReadiness: [
    { factorId: "conversion_cta", key: "cta_present", label: "Primary CTA presence", weight: 30 },
    { factorId: "conversion_contact", key: "contact_signal_present", label: "Contact path visibility", weight: 24 },
    { factorId: "conversion_form", key: "form_or_contact_present", label: "Form or contact mechanism", weight: 18 },
    { factorId: "conversion_trust", key: "review_signal_present", label: "Decision-point trust support", weight: 12 },
    { factorId: "conversion_clarity", key: "information_clarity_score", label: "Offer clarity", weight: 16 }
  ],
  informationClarity: [
    { factorId: "clarity_title", key: "title_present", label: "Page purpose in title", weight: 18 },
    { factorId: "clarity_description", key: "description_present", label: "Summary description", weight: 18 },
    { factorId: "clarity_heading", key: "h1_present", label: "Primary message heading", weight: 22 },
    { factorId: "clarity_text_density", key: "text_density_score", label: "Readable text density", weight: 18 },
    { factorId: "clarity_navigation", key: "navigation_depth_score", label: "Navigation clarity", weight: 14 },
    { factorId: "clarity_cta", key: "cta_present", label: "Action clarity", weight: 10 }
  ]
};

export function buildDimensionScores(evidenceObjects: EvidenceObject[]): DimensionScore[] {
  return (Object.keys(DIMENSION_FACTORS) as DimensionKey[]).map((key) => {
    const definitions = DIMENSION_FACTORS[key] ?? [];
    const trace = definitions.map((factor) => buildTraceFactor(factor, evidenceObjects));
    const score = clampScore(trace.reduce((sum, factor) => sum + factor.contribution, 0));
    const evidenceIds = Array.from(new Set(trace.flatMap((factor) => factor.evidenceIds)));
    const confidenceScore = buildConfidenceScore(evidenceObjects, evidenceIds);
    const visualState = visualStateForScore(score);

    return {
      key,
      label: DIMENSION_LABELS[key],
      score,
      classification: classifyScore(score),
      visualState,
      businessMeaning: visualState.businessMeaning,
      confidenceScore,
      confidenceLevel: confidenceLevelForScore(confidenceScore),
      evidenceIds,
      trace
    };
  });
}

export function calculateOss(dimensions: DimensionScore[]): number {
  const weights: Record<DimensionKey, number> = {
    trust: 0.16,
    accessibility: 0.1,
    renderingQuality: 0.1,
    stability: 0.1,
    mobileExperience: 0.14,
    websiteHealth: 0.12,
    visibilityStructure: 0.1,
    conversionReadiness: 0.14,
    informationClarity: 0.04
  };

  return clampScore(
    dimensions.reduce((sum, dimension) => sum + dimension.score * (weights[dimension.key] ?? 0), 0)
  );
}

export function classifyScore(score: number): DimensionScore["classification"] {
  if (score < 40) return "Critical";
  if (score < 60) return "Weak";
  if (score < 75) return "At Risk";
  if (score < 90) return "Stable";
  return "Strong";
}

function buildTraceFactor(factor: FactorDefinition, evidenceObjects: EvidenceObject[]): ScoreTraceFactor {
  const matches = evidenceObjects.filter((evidence) => evidence.normalizedInput.signalKey === factor.key);
  const valueScore = aggregateSignal(matches);
  return {
    factorId: factor.factorId,
    label: factor.label,
    contribution: Number(((valueScore / 100) * factor.weight).toFixed(2)),
    weight: factor.weight,
    evidenceIds: matches.map((evidence) => evidence.evidenceId),
    normalization: "v1.0 deterministic linear scaling",
    direction: factor.direction ?? "positive"
  };
}

function aggregateSignal(matches: EvidenceObject[]): number {
  if (matches.length === 0) return 0;

  const scores = matches.map((evidence) => {
    const value = evidence.normalizedInput.value;
    if (typeof value === "boolean") return value ? 100 : 0;
    if (typeof value === "number") return clampScore(value);
    if (typeof value === "string") return value.length > 0 ? 100 : 0;
    return 0;
  });

  if (matches.some((evidence) => evidence.normalizedInput.aggregate === "any")) {
    return Math.max(...scores);
  }

  return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function buildConfidenceScore(evidenceObjects: EvidenceObject[], evidenceIds: string[]): number {
  const matches = evidenceObjects.filter((evidence) => evidenceIds.includes(evidence.evidenceId));
  if (matches.length === 0) return 60;
  const average = matches.reduce((sum, evidence) => sum + evidence.groundTruthConfidence, 0) / matches.length;
  const densityBonus = Math.min(8, matches.length);
  return clampScore(average + densityBonus);
}
