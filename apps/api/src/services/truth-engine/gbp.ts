import * as cheerio from "cheerio";
import {
  clampScore,
  confidenceLevelForScore,
  type EvidenceCluster,
  type EvidenceObject,
  type GbpIdentityAnalysis,
  type RawSignalEvent,
  type ValidationTraceEntry
} from "@systolab/shared";
import { EvidenceBuilder, snippet } from "./evidence.js";
import { assertPublicHttpUrl, fetchText } from "./network.js";

export interface GbpAnalysisResult {
  gbpIdentity: GbpIdentityAnalysis;
  evidenceObjects: EvidenceObject[];
  evidenceClusters: EvidenceCluster[];
  validationTrace: ValidationTraceEntry[];
  rawSignalTelemetry: RawSignalEvent[];
}

export async function analyzeGbpIdentity(
  gbpUrl: string | undefined,
  primaryEvidenceObjects: EvidenceObject[],
  snapshotSeed: string
): Promise<GbpAnalysisResult> {
  if (!gbpUrl) {
    return {
      gbpIdentity: {
        status: "not_assessed",
        identityMismatchFlag: "not_assessed",
        identityConsistencyScore: 0,
        confidenceScore: 0,
        confidenceLevel: "Limited",
        profileCompletenessLevel: "Not Assessed",
        signals: [],
        consistencyNotes: ["No Google Business Profile URL was provided."],
        limitations: ["GBP Identity was not assessed in this scan."],
        evidenceIds: []
      },
      evidenceObjects: [],
      evidenceClusters: [],
      validationTrace: [],
      rawSignalTelemetry: []
    };
  }

  const telemetry: RawSignalEvent[] = [];
  const builder = new EvidenceBuilder(`${snapshotSeed}-gbp`);
  const evidenceObjects: EvidenceObject[] = [];

  try {
    pushGbpTelemetry(telemetry, "info", "GBP public page fetch started", { url: gbpUrl });
    const url = await assertPublicHttpUrl(gbpUrl);
    const response = await fetchText(url, 12000, 1_200_000);
    pushGbpTelemetry(telemetry, response.ok ? "info" : "warning", `GBP public page returned HTTP ${response.status}`, {
      finalUrl: response.finalUrl,
      bytesRead: response.bytesRead
    });

    const $ = cheerio.load(response.body);
    const title = cleanText($("meta[property='og:title']").attr("content") || $("title").first().text());
    const description = cleanText(
      $("meta[property='og:description']").attr("content") ||
        $("meta[name='description']").attr("content") ||
        $("body").text()
    );
    const bodyText = cleanText($("body").text());
    const combined = cleanText(`${title} ${description} ${bodyText.slice(0, 6000)}`);
    const extractedBusinessName = cleanBusinessName(title || extractBusinessNameFromUrl(response.finalUrl));
    const extractedCategory = extractCategory(description, combined);
    const addressSignal = detectAddress(combined);
    const hoursSignal = /open now|closed|hours|opens|closes|24 hours|temporarily closed/i.test(combined);
    const reviewSignal = /review|rating|stars|\b[1-5]\.\d\b/i.test(combined);
    const phoneSignal = /\+?\d[\d\s().-]{7,}\d/.test(combined);
    const websiteSignal = /website|http|www\./i.test(combined);
    const primaryName = extractPrimaryBusinessName(primaryEvidenceObjects);
    const consistencyScore = scoreNameConsistency(primaryName, extractedBusinessName);
    const websiteContext = buildWebsiteIdentityContext(primaryEvidenceObjects);
    const mismatchNotes = buildIdentityMismatchNotes(
      { addressSignal, hoursSignal, phoneSignal },
      websiteContext
    );

    evidenceObjects.push(
      builder.add({
        sourceType: "gbp",
        url: response.finalUrl,
        pageRole: "gbp_identity",
        selectorPath: "meta[property='og:title'], title",
        rawValue: title || "No public GBP title extracted",
        normalizedInput: { signalKey: "gbp_business_name", value: Boolean(extractedBusinessName) },
        validationMethod: title ? "direct_extraction" : "direct_extraction",
        confidenceBasis: "public GBP title and Open Graph metadata extraction",
        groundTruthConfidence: title ? 78 : 48,
        rawDomSnapshot: snippet($("head").html() ?? response.body),
        dimensionRefs: []
      }),
      builder.add({
        sourceType: "gbp",
        url: response.finalUrl,
        pageRole: "gbp_identity",
        selectorPath: "meta[property='og:description'], meta[name='description'], body",
        rawValue: description || "No public GBP description extracted",
        normalizedInput: { signalKey: "gbp_description", value: Boolean(description) },
        validationMethod: "direct_extraction",
        confidenceBasis: "public GBP metadata and visible text extraction",
        groundTruthConfidence: description ? 72 : 44,
        rawDomSnapshot: snippet($("body").html() ?? response.body),
        dimensionRefs: []
      }),
      buildGbpSignalEvidence(builder, response.finalUrl, "gbp_address_presence", "Address Presence", addressSignal, combined),
      buildGbpSignalEvidence(builder, response.finalUrl, "gbp_hours_presence", "Operating Hours Visibility", hoursSignal, combined),
      buildGbpSignalEvidence(builder, response.finalUrl, "gbp_review_presence", "Review Availability Indicator", reviewSignal, combined),
      buildGbpSignalEvidence(builder, response.finalUrl, "gbp_phone_presence", "Phone Signal", phoneSignal, combined),
      buildGbpSignalEvidence(builder, response.finalUrl, "gbp_website_presence", "Website Link Signal", websiteSignal, combined)
    );

    const signalMap = [
      { label: "Business Name", observed: Boolean(extractedBusinessName), value: extractedBusinessName || "Not observed" },
      { label: "Category Alignment", observed: Boolean(extractedCategory), value: extractedCategory || "Limited from public page" },
      { label: "Address Presence", observed: addressSignal, value: addressSignal ? "Address-like public signal observed" : "Not observed" },
      { label: "Operating Hours Visibility", observed: hoursSignal, value: hoursSignal ? "Hours-like public signal observed" : "Not observed" },
      { label: "Review Availability Indicator", observed: reviewSignal, value: reviewSignal ? "Review/rating public signal observed" : "Not observed" },
      { label: "Phone Signal", observed: phoneSignal, value: phoneSignal ? "Phone-like public signal observed" : "Not observed" },
      { label: "Website Link Signal", observed: websiteSignal, value: websiteSignal ? "Website-like public signal observed" : "Not observed" }
    ];

    const observedCount = signalMap.filter((signal) => signal.observed).length;
    const completenessScore = clampScore((observedCount / signalMap.length) * 100);
    const confidenceScore = clampScore(
      evidenceObjects.reduce((sum, evidence) => sum + evidence.groundTruthConfidence, 0) / evidenceObjects.length
    );
    const identityConsistencyScore = clampScore(Math.round((completenessScore * 0.55 + consistencyScore * 0.45)));
    const limitations = [
      "GBP analysis uses only publicly retrievable page HTML and metadata.",
      "GBP data is supplementary identity context and does not affect OSS or core decision scoring."
    ];

    if (confidenceScore < 70) {
      limitations.push("The public GBP page returned limited inspectable content; identity interpretation is confidence-limited.");
    }

    const gbpIdentity: GbpIdentityAnalysis = {
      status: confidenceScore >= 70 ? "assessed" : "limited",
      inputUrl: gbpUrl,
      finalUrl: response.finalUrl,
      identityMismatchFlag:
        mismatchNotes.length > 0
          ? "possible_mismatch"
          : !extractedBusinessName || !primaryName
          ? "insufficient_evidence"
          : consistencyScore < 45
            ? "possible_mismatch"
            : "not_detected",
      identityConsistencyScore,
      confidenceScore,
      confidenceLevel: confidenceLevelForScore(confidenceScore),
      extractedBusinessName,
      extractedCategory,
      profileCompletenessLevel: completenessLevel(completenessScore),
      signals: signalMap.map((signal) => ({
        label: signal.label,
        status: signal.observed ? "Observed" : confidenceScore < 70 ? "Limited" : "Not Observed",
        observedValue: signal.value,
        evidenceIds: evidenceIdsForGbpSignal(evidenceObjects, signal.label)
      })),
      consistencyNotes: [...buildConsistencyNotes(primaryName, extractedBusinessName, consistencyScore), ...mismatchNotes],
      limitations,
      evidenceIds: evidenceObjects.map((evidence) => evidence.evidenceId)
    };

    return {
      gbpIdentity,
      evidenceObjects,
      evidenceClusters: [
        {
          clusterId: "ECL-gbp-identity",
          label: "GBP identity evidence cluster",
          evidenceIds: evidenceObjects.map((evidence) => evidence.evidenceId),
          validationMethod: "structural_redundancy",
          confidenceScore
        }
      ],
      validationTrace: buildGbpValidationTrace(evidenceObjects),
      rawSignalTelemetry: telemetry
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GBP analysis failure";
    pushGbpTelemetry(telemetry, "error", "GBP public page fetch failed", { url: gbpUrl, reason: message });
    const failedEvidence = builder.add({
      sourceType: "gbp",
      url: gbpUrl,
      pageRole: "gbp_identity",
      rawValue: message,
      normalizedInput: { signalKey: "gbp_fetch_success", value: false },
      validationMethod: "direct_extraction",
      confidenceBasis: "GBP URL could not be fetched through the public-page extractor",
      groundTruthConfidence: 35,
      dimensionRefs: []
    });

    return {
      gbpIdentity: {
        status: "failed",
        inputUrl: gbpUrl,
        identityMismatchFlag: "insufficient_evidence",
        identityConsistencyScore: 0,
        confidenceScore: 35,
        confidenceLevel: "Limited",
        profileCompletenessLevel: "Limited",
        signals: [],
        consistencyNotes: ["GBP public-page extraction failed; no identity consistency conclusion was generated."],
        limitations: [message, "GBP data does not affect OSS or core decision scoring."],
        evidenceIds: [failedEvidence.evidenceId]
      },
      evidenceObjects: [failedEvidence],
      evidenceClusters: [
        {
          clusterId: "ECL-gbp-identity",
          label: "GBP identity evidence cluster",
          evidenceIds: [failedEvidence.evidenceId],
          validationMethod: "direct_extraction",
          confidenceScore: 35
        }
      ],
      validationTrace: buildGbpValidationTrace([failedEvidence]),
      rawSignalTelemetry: telemetry
    };
  }
}

function buildGbpSignalEvidence(
  builder: EvidenceBuilder,
  url: string,
  signalKey: string,
  label: string,
  observed: boolean,
  combinedText: string
): EvidenceObject {
  return builder.add({
    sourceType: "gbp",
    url,
    pageRole: "gbp_identity",
    selectorPath: "public GBP metadata/body text",
    rawValue: `${label}: ${observed ? "observed" : "not observed"}`,
    normalizedInput: { signalKey, value: observed },
    validationMethod: "direct_extraction",
    confidenceBasis: "public GBP page text pattern extraction",
    groundTruthConfidence: observed ? 70 : 58,
    rawDomSnapshot: snippet(combinedText),
    dimensionRefs: []
  });
}

function buildGbpValidationTrace(evidenceObjects: EvidenceObject[]): ValidationTraceEntry[] {
  return evidenceObjects.map((evidence, index) => ({
    traceId: `GBP-VTL-${String(index + 1).padStart(3, "0")}`,
    evidenceId: evidence.evidenceId,
    check: "GBP public signal validation",
    httpResult: "found",
    domResult: evidence.rawDomSnapshot ? "found" : "not_checked",
    renderResult: "not_rendered",
    outcome:
      evidence.groundTruthConfidence >= 70
        ? "accepted as supplementary identity evidence"
        : "accepted with public-page limitation",
    confidenceScore: evidence.groundTruthConfidence
  }));
}

function cleanText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function cleanBusinessName(title: string): string | undefined {
  const cleaned = title
    .replace(/\s*[-|]\s*Google\s*(Maps|Search)?\s*$/i, "")
    .replace(/\s*-\s*Google Maps\s*$/i, "")
    .replace(/^Google Maps\s*[-|]\s*/i, "")
    .trim();
  if (!cleaned || /^google maps$/i.test(cleaned)) return undefined;
  return cleaned.slice(0, 120);
}

function extractBusinessNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/place\/([^/]+)/i);
    return match?.[1] ? decodeURIComponent(match[1].replace(/\+/g, " ")) : parsed.hostname;
  } catch {
    return "";
  }
}

function extractCategory(description: string, combined: string): string | undefined {
  const categoryPatterns = [
    /(?:category|business type)\s*[:\-]\s*([^.,|]+)/i,
    /\b(restaurant|clinic|hospital|dentist|agency|hotel|school|consultant|salon|store|shop|law firm|accountant)\b/i
  ];
  for (const pattern of categoryPatterns) {
    const match = (description || combined).match(pattern);
    if (match?.[1]) return cleanText(match[1]).slice(0, 80);
    if (match?.[0]) return cleanText(match[0]).slice(0, 80);
  }
  return undefined;
}

function detectAddress(value: string): boolean {
  return /\b\d{1,6}\s+[A-Za-z0-9 .'-]+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|sector|nagar|colony|market|suite|floor)\b/i.test(value);
}

function extractPrimaryBusinessName(evidenceObjects: EvidenceObject[]): string | undefined {
  const title = evidenceObjects.find((evidence) => evidence.normalizedInput.signalKey === "title_present" && evidence.rawValue)?.rawValue;
  const h1 = evidenceObjects.find((evidence) => evidence.normalizedInput.signalKey === "h1_present" && evidence.rawValue)?.rawValue;
  return cleanBusinessName(title || h1 || "");
}

function buildWebsiteIdentityContext(evidenceObjects: EvidenceObject[]): {
  contactSignal: boolean;
  addressSignal: boolean;
  hoursSignal: boolean;
} {
  const websiteText = evidenceObjects
    .filter((evidence) => evidence.sourceType !== "gbp")
    .map((evidence) => `${evidence.rawValue} ${evidence.rawDomSnapshot ?? ""}`)
    .join(" ");

  return {
    contactSignal: evidenceObjects.some((evidence) =>
      ["contact_signal_present", "form_or_contact_present"].includes(String(evidence.normalizedInput.signalKey)) &&
      evidence.normalizedInput.value === true
    ),
    addressSignal: detectAddress(websiteText) || /address|location|directions|suite|floor/i.test(websiteText),
    hoursSignal: /hours|open now|closed|opens|closes|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?/i.test(websiteText)
  };
}

function buildIdentityMismatchNotes(
  gbpSignals: { addressSignal: boolean; hoursSignal: boolean; phoneSignal: boolean },
  websiteContext: { contactSignal: boolean; addressSignal: boolean; hoursSignal: boolean }
): string[] {
  const notes: string[] = [];
  if (gbpSignals.addressSignal && !websiteContext.addressSignal) {
    notes.push("Identity Mismatch Flag: GBP exposes an address-like signal, but the website did not expose a comparable address/location signal.");
  }
  if (gbpSignals.hoursSignal && !websiteContext.hoursSignal) {
    notes.push("Identity Mismatch Flag: GBP exposes operating-hours context, but the website did not expose comparable hours context.");
  }
  if (gbpSignals.phoneSignal && !websiteContext.contactSignal) {
    notes.push("Identity Mismatch Flag: GBP exposes a phone-like contact signal, but the website did not expose a comparable contact path.");
  }
  return notes;
}

function evidenceIdsForGbpSignal(evidenceObjects: EvidenceObject[], label: string): string[] {
  const keyMap: Record<string, string[]> = {
    "Business Name": ["gbp_business_name"],
    "Category Alignment": ["gbp_description"],
    "Address Presence": ["gbp_address_presence"],
    "Operating Hours Visibility": ["gbp_hours_presence"],
    "Review Availability Indicator": ["gbp_review_presence"],
    "Phone Signal": ["gbp_phone_presence"],
    "Website Link Signal": ["gbp_website_presence"]
  };
  const keys = keyMap[label] ?? [];
  return evidenceObjects
    .filter((evidence) => keys.includes(String(evidence.normalizedInput.signalKey)))
    .map((evidence) => evidence.evidenceId);
}

function scoreNameConsistency(primaryName: string | undefined, gbpName: string | undefined): number {
  if (!primaryName || !gbpName) return 50;
  const primaryTokens = tokenSet(primaryName);
  const gbpTokens = tokenSet(gbpName);
  if (primaryTokens.size === 0 || gbpTokens.size === 0) return 50;
  const overlap = [...primaryTokens].filter((token) => gbpTokens.has(token)).length;
  return clampScore((overlap / Math.max(primaryTokens.size, gbpTokens.size)) * 100);
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !["the", "and", "www", "com", "google", "maps"].includes(token))
  );
}

function buildConsistencyNotes(primaryName: string | undefined, gbpName: string | undefined, score: number): string[] {
  if (!gbpName) return ["GBP business name could not be confidently extracted from public page metadata."];
  if (!primaryName) return [`GBP business name observed as "${gbpName}". Website business name signal was limited.`];
  if (score >= 70) return [`Website identity signal and GBP name show structural token overlap: "${primaryName}" / "${gbpName}".`];
  return [`Potential identity mismatch signal: website title "${primaryName}" and GBP name "${gbpName}" have limited token overlap.`];
}

function completenessLevel(score: number): GbpIdentityAnalysis["profileCompletenessLevel"] {
  if (score <= 0) return "Not Assessed";
  if (score < 40) return "Limited";
  if (score < 75) return "Partial";
  return "Strong";
}

function pushGbpTelemetry(
  telemetry: RawSignalEvent[],
  level: RawSignalEvent["level"],
  message: string,
  metadata?: Record<string, unknown>
): void {
  telemetry.push({
    eventId: `GBP-RSE-${String(telemetry.length + 1).padStart(3, "0")}`,
    timestamp: new Date().toISOString(),
    stage: "parse",
    level,
    message,
    metadata
  });
}
