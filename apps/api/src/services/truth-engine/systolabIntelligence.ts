import * as cheerio from "cheerio";
import { clampScore, type DimensionKey, type EvidenceObject } from "@systolab/shared";
import { EvidenceBuilder, snippet } from "./evidence.js";

export interface SystolabIntelligencePage {
  finalUrl: string;
  role: string;
  html: string;
  headers?: Record<string, string>;
  visual?: {
    screenshotArtifactId: string | null;
    viewportArtifactId: string | null;
    renderedHtml: string;
    ctaAboveFold: boolean;
    jsInjected: boolean;
    renderTimeMs: number;
  } | null;
}

interface QuestionFamily {
  key: string;
  label: string;
  patterns: RegExp[];
}

interface SignalInput {
  sourceModule: string;
  signalKey: string;
  label: string;
  score: number;
  url: string;
  pageRole: string;
  selectorPath: string;
  rawValue: string;
  confidenceBasis: string;
  dimensionRefs: DimensionKey[];
  rawDomSnapshot?: string;
  details?: Record<string, unknown>;
}

const CORE_QUESTION_FAMILIES: QuestionFamily[] = [
  { key: "pricing_transparency", label: "Pricing Transparency", patterns: [/price|pricing|cost|rates|fees?|quote|estimate/i] },
  { key: "process_clarity", label: "Process Clarity", patterns: [/how it works|process|steps|what to expect|timeline|book|schedule/i] },
  { key: "trust_questions", label: "Trust Questions", patterns: [/review|testimonial|case stud|certified|licensed|insured|award|guarantee|accredit/i] },
  { key: "comparison_support", label: "Comparison Support", patterns: [/compare|vs\.?|versus|alternative|why choose|different from|best/i] },
  { key: "objection_handling", label: "Objection Handling", patterns: [/refund|return|warranty|guarantee|risk.?free|cancel|support|faq/i] },
  { key: "decision_support", label: "Decision Support", patterns: [/faq|questions|learn more|guide|resources|case stud|portfolio/i] },
  { key: "contact_confidence", label: "Contact Confidence", patterns: [/contact|call|email|appointment|consultation|demo|request/i] }
];

const BUSINESS_QUESTION_FAMILIES: Record<string, QuestionFamily[]> = {
  ecommerce: [
    { key: "shipping_confidence", label: "Shipping Confidence", patterns: [/shipping|delivery|dispatch|tracking/i] },
    { key: "returns_confidence", label: "Returns Confidence", patterns: [/return|refund|exchange|warranty/i] },
    { key: "purchase_security", label: "Purchase Security", patterns: [/secure|payment|checkout|ssl|trusted/i] }
  ],
  local_service: [
    { key: "service_area", label: "Service Area", patterns: [/service area|near me|location|areas served|city|local/i] },
    { key: "availability", label: "Availability", patterns: [/hours|open|emergency|same day|schedule|availability/i] }
  ],
  healthcare: [
    { key: "appointment_confidence", label: "Appointment Confidence", patterns: [/appointment|patient|insurance|treatment|doctor|clinic/i] }
  ],
  law_firm: [
    { key: "case_fit", label: "Case Fit", patterns: [/case|consultation|practice area|attorney|lawyer|legal fees/i] }
  ],
  saas: [
    { key: "demo_trial", label: "Demo Or Trial Confidence", patterns: [/demo|trial|pricing|integration|security|onboarding/i] }
  ]
};

export function extractSystolabIntelligenceEvidence(
  pages: SystolabIntelligencePage[],
  normalizedUrl: URL,
  builder: EvidenceBuilder
): EvidenceObject[] {
  const evidence: EvidenceObject[] = [];
  for (const page of pages) {
    const html = page.visual?.renderedHtml?.trim() ? page.visual.renderedHtml : page.html;
    if (!html.trim()) continue;

    const $ = cheerio.load(html);
    const text = $("body").text().replace(/\s+/g, " ").trim();
    const head = $("head").html() ?? "";
    const body = $("body").html() ?? "";
    const bodySnapshot = snippet(body);
    const title = $("title").first().text().trim();
    const description = $("meta[name='description']").attr("content")?.trim() ?? "";
    const canonical = $("link[rel='canonical']").attr("href")?.trim() ?? "";
    const robotsMeta = $("meta[name='robots']").attr("content")?.trim().toLowerCase() ?? "";
    const viewport = $("meta[name='viewport']").attr("content")?.trim() ?? "";
    const h1Count = $("h1").length;
    const h2Count = $("h2").length;
    const headingText = $("h1,h2,h3").map((_, heading) => $(heading).text().trim()).get().join(" ");
    const imageCount = $("img").length;
    const imagesWithAlt = $("img[alt]").filter((_, image) => ($(image).attr("alt") ?? "").trim().length > 0).length;
    const internalLinks = $("a[href]").filter((_, element) => isInternalLink($(element).attr("href"), page.finalUrl, normalizedUrl.origin)).length;
    const schemaTypes = extractSchemaTypes($);
    const businessType = detectBusinessType(text, page.finalUrl, schemaTypes);
    const expectedQuestions = expectedQuestionFamilies(businessType);
    const coveredQuestions = expectedQuestions.filter((family) => family.patterns.some((pattern) => pattern.test(text)));
    const proofSignals = extractTrustProofSignals(text, body);
    const localSignals = extractLocalSignals(text, body, schemaTypes);
    const ecommerceSignals = extractEcommerceSignals(text, body, schemaTypes);
    const citationSignals = extractCitationSignals(text, body);
    const entitySignals = extractEntitySignals(text, title, description, headingText, schemaTypes, businessType, localSignals, ecommerceSignals);
    const contentFreshness = evaluateContentFreshness(text, page.headers ?? {});
    const ctaText = $("a,button,input[type='submit']").text();
    const hasCta = /contact|call|book|quote|start|schedule|buy|demo|appointment|get started|checkout|cart/i.test(`${ctaText} ${body}`);
    const hasPricing = /price|pricing|cost|rates|fees?|quote|estimate/i.test(text);
    const hasProcess = /how it works|process|steps|what to expect|timeline|book|schedule/i.test(text);
    const hasContact = /mailto:|tel:|contact|appointment|address|location|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/i.test(body);
    const hasPolicy = /privacy|terms|refund|return|warranty|guarantee|shipping|policy/i.test(text);
    const educationalSignals = [
      h2Count >= 3,
      text.length >= 1200,
      /guide|resources|learn|blog|insights|faq|questions|education|tips/i.test(text),
      coveredQuestions.length >= Math.ceil(expectedQuestions.length * 0.55),
      internalLinks >= 8,
      proofSignals.length > 0,
      schemaTypes.length > 0
    ];
    const questionCoverageScore = ratioScore(coveredQuestions.length, expectedQuestions.length);
    const trustProofScore = ratioScore(proofSignals.length, 8);
    const topicAuthorityScore = ratioScore(educationalSignals.filter(Boolean).length, educationalSignals.length);
    const entityClarityScore = ratioScore(entitySignals.length, 8);
    const citationOpportunityScore = ratioScore(citationSignals.length, 7);
    const decisionConfidenceScore = ratioScore(
      [hasCta, hasPricing, hasProcess, hasContact, hasPolicy, proofSignals.length >= 2, description.length > 0].filter(Boolean).length,
      7
    );
    const geoReadinessScore = buildGeoReadinessScore($, text, schemaTypes);
    const searchToSaleScore = ratioScore(
      [title, description, h1Count === 1, hasCta, hasPricing || hasProcess, proofSignals.length > 0, internalLinks >= 5].filter(Boolean).length,
      7
    );
    const journeyScore = ratioScore(
      [viewport, internalLinks >= 5, hasCta, hasContact, proofSignals.length > 0, page.visual?.ctaAboveFold ?? hasCta].filter(Boolean).length,
      6
    );
    const technicalSeoScore = averageScore([
      titleQuality(title),
      descriptionQuality(description),
      canonical ? 100 : 35,
      robotsMeta.includes("noindex") ? 0 : 100,
      headingStructureScore(h1Count, h2Count),
      clampScore(Math.min(internalLinks, 20) * 5),
      imageCount === 0 ? 100 : ratioScore(imagesWithAlt, imageCount),
      new URL(page.finalUrl).protocol === "https:" ? 100 : 0,
      viewport ? 100 : 0
    ]);

    evidence.push(
      scoreSignal(builder, {
        sourceModule: "systolab_seo_intelligence",
        signalKey: "native_seo_technical_foundation_score",
        label: "Technical SEO Foundation",
        score: technicalSeoScore,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "head,body",
        rawValue: `Technical SEO foundation score ${technicalSeoScore}; title=${Boolean(title)}, meta=${Boolean(description)}, canonical=${Boolean(canonical)}, headings=${h1Count} h1/${h2Count} h2, internalLinks=${internalLinks}, alt=${imagesWithAlt}/${imageCount}`,
        confidenceBasis: "Native SYSTOLAB HTML, DOM, metadata, indexability, heading, link, image, HTTPS, and viewport evidence.",
        dimensionRefs: ["visibilityStructure", "websiteHealth", "informationClarity"],
        rawDomSnapshot: snippet(head)
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_seo_intelligence",
        signalKey: "native_schema_coverage_score",
        label: "Schema Entity Coverage",
        score: schemaCoverageScore(schemaTypes, businessType),
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "script[type='application/ld+json'],[itemscope]",
        rawValue: schemaTypes.length ? `Schema entities detected: ${schemaTypes.join(", ")}` : "No supported schema entity detected",
        confidenceBasis: "Native SYSTOLAB structured-data extraction from JSON-LD and microdata item types.",
        dimensionRefs: ["trust", "visibilityStructure", "websiteHealth"],
        rawDomSnapshot: snippet(head),
        details: { schemaTypes, businessType }
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_geo_ai_search_intelligence",
        signalKey: "native_geo_ai_readiness_score",
        label: "GEO And AI Search Readiness",
        score: geoReadinessScore,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "main,article,section,h1,h2,h3",
        rawValue: `GEO readiness score ${geoReadinessScore}; question blocks, entity clarity, topical sections, and citation-friendly content evaluated.`,
        confidenceBasis: "Native SYSTOLAB question-oriented content, entity clarity, topical organization, attribution, and answer-block evidence.",
        dimensionRefs: ["visibilityStructure", "informationClarity"],
        rawDomSnapshot: bodySnapshot
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_topic_authority_intelligence",
        signalKey: "native_topic_authority_coverage_score",
        label: "Topic Authority Coverage",
        score: topicAuthorityScore,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "main,article,section,h1,h2,h3",
        rawValue: `Topic authority score ${topicAuthorityScore}; educational depth, topical sections, question coverage, supporting content, internal links, proof, and entity signals evaluated.`,
        confidenceBasis: "Native SYSTOLAB topical coverage, educational-content depth, expertise-support, and unanswered information-need evidence.",
        dimensionRefs: ["visibilityStructure", "informationClarity", "conversionReadiness"],
        rawDomSnapshot: bodySnapshot,
        details: {
          businessType,
          educationalSignalCount: educationalSignals.filter(Boolean).length,
          expectedEducationalSignals: educationalSignals.length
        }
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_customer_question_coverage_intelligence",
        signalKey: "native_customer_question_coverage_score",
        label: "Customer Question Coverage",
        score: questionCoverageScore,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "body",
        rawValue: `Answered ${coveredQuestions.length} of ${expectedQuestions.length} expected customer question families: ${coveredQuestions.map((item) => item.label).join(", ") || "none"}`,
        confidenceBasis: "Native SYSTOLAB comparison of likely customer decision questions against visible page content.",
        dimensionRefs: ["informationClarity", "conversionReadiness", "trust"],
        rawDomSnapshot: bodySnapshot,
        details: {
          businessType,
          coveredQuestionFamilies: coveredQuestions.map((item) => item.key),
          missingQuestionFamilies: expectedQuestions.filter((item) => !coveredQuestions.includes(item)).map((item) => item.key)
        }
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_decision_confidence_intelligence",
        signalKey: "native_decision_confidence_score",
        label: "Decision Confidence Coverage",
        score: decisionConfidenceScore,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "body",
        rawValue: `Decision confidence score ${decisionConfidenceScore}; CTA=${hasCta}, pricing=${hasPricing}, process=${hasProcess}, contact=${hasContact}, policy=${hasPolicy}, proofSignals=${proofSignals.length}`,
        confidenceBasis: "Native SYSTOLAB evaluation of information, proof, reassurance, transparency, credibility, and action clarity.",
        dimensionRefs: ["trust", "conversionReadiness", "informationClarity"],
        rawDomSnapshot: bodySnapshot
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_trust_proof_coverage_intelligence",
        signalKey: "native_trust_proof_coverage_score",
        label: "Trust Proof Coverage",
        score: trustProofScore,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "body",
        rawValue: proofSignals.length ? `Trust proof signals detected: ${proofSignals.join(", ")}` : "No strong trust proof signals detected",
        confidenceBasis: "Native SYSTOLAB trust-proof extraction for reviews, testimonials, case studies, certifications, awards, portfolio, media, and credibility cues.",
        dimensionRefs: ["trust", "conversionReadiness"],
        rawDomSnapshot: bodySnapshot,
        details: { proofSignals }
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_entity_intelligence",
        signalKey: "native_entity_clarity_score",
        label: "Entity Clarity",
        score: entityClarityScore,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "title,meta[name='description'],h1,h2,script[type='application/ld+json'],body",
        rawValue: entitySignals.length ? `Entity clarity signals detected: ${entitySignals.join(", ")}` : "Entity clarity signals are limited",
        confidenceBasis: "Native SYSTOLAB business, service, product, location, person, schema, brand, and relationship clarity evidence.",
        dimensionRefs: ["trust", "visibilityStructure", "informationClarity"],
        rawDomSnapshot: bodySnapshot,
        details: { entitySignals, schemaTypes, businessType }
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_citation_opportunity_intelligence",
        signalKey: "native_citation_credibility_score",
        label: "Citation And Credibility Coverage",
        score: citationOpportunityScore,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "body,a[href]",
        rawValue: citationSignals.length ? `Citation and credibility signals detected: ${citationSignals.join(", ")}` : "Citation and credibility reinforcement signals are limited",
        confidenceBasis: "Native SYSTOLAB directory, association, business listing, reputation, authority-reference, and credibility reinforcement evidence.",
        dimensionRefs: ["trust", "visibilityStructure"],
        rawDomSnapshot: bodySnapshot,
        details: { citationSignals }
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_content_decay_intelligence",
        signalKey: "native_content_freshness_score",
        label: "Content Freshness",
        score: contentFreshness.score,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "body,time,[datetime],meta[property='article:modified_time']",
        rawValue: contentFreshness.rawValue,
        confidenceBasis: "Native SYSTOLAB content freshness, outdated-reference, offer-validity, and page-update evidence.",
        dimensionRefs: ["websiteHealth", "informationClarity", "trust"],
        rawDomSnapshot: bodySnapshot,
        details: contentFreshness.details
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_customer_journey_breakpoint_intelligence",
        signalKey: "native_customer_journey_continuity_score",
        label: "Customer Journey Continuity",
        score: journeyScore,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "nav,main,a,button,form",
        rawValue: `Journey continuity score ${journeyScore}; viewport=${Boolean(viewport)}, internalLinks=${internalLinks}, CTA=${hasCta}, contact=${hasContact}, proof=${proofSignals.length}`,
        confidenceBasis: "Native SYSTOLAB discovery-to-conversion continuity checks across navigation, mobile viewport, trust cues, contact path, and CTA visibility.",
        dimensionRefs: ["conversionReadiness", "mobileExperience", "informationClarity"],
        rawDomSnapshot: bodySnapshot
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_search_opportunity_intelligence",
        signalKey: "native_search_to_sale_support_score",
        label: "Search-To-Sale Support",
        score: searchToSaleScore,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "title,meta[name='description'],h1,body,a,button",
        rawValue: `Search-to-sale support score ${searchToSaleScore}; demand capture, answer support, proof, and conversion path evaluated.`,
        confidenceBasis: "Native SYSTOLAB mapping of search-intent support to customer decision and conversion signals.",
        dimensionRefs: ["visibilityStructure", "conversionReadiness", "informationClarity"],
        rawDomSnapshot: bodySnapshot
      }),
      scoreSignal(builder, {
        sourceModule: "systolab_business_type_intelligence",
        signalKey: "native_business_type_detection",
        label: "Business Type Detection",
        score: businessType === "unknown" ? 45 : 82,
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "body,script[type='application/ld+json']",
        rawValue: `Detected business type: ${businessType}`,
        confidenceBasis: "Native SYSTOLAB business-type classification from content, URL, schema, and commerce/local signals.",
        dimensionRefs: ["informationClarity"],
        rawDomSnapshot: bodySnapshot,
        details: { businessType }
      })
    );

    if (localSignals.length > 0 || businessType === "local_service" || businessType === "healthcare" || businessType === "law_firm") {
      evidence.push(scoreSignal(builder, {
        sourceModule: "systolab_local_business_intelligence",
        signalKey: "native_local_business_readiness_score",
        label: "Local Business Readiness",
        score: ratioScore(localSignals.length, 6),
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "body,script[type='application/ld+json']",
        rawValue: localSignals.length ? `Local business signals detected: ${localSignals.join(", ")}` : "Local business signals are limited",
        confidenceBasis: "Native SYSTOLAB local-business extraction for phone, address, hours, service area, maps, appointment, and LocalBusiness schema signals.",
        dimensionRefs: ["trust", "conversionReadiness", "visibilityStructure"],
        rawDomSnapshot: bodySnapshot,
        details: { localSignals, businessType }
      }));
    }

    if (ecommerceSignals.length > 0 || businessType === "ecommerce") {
      evidence.push(scoreSignal(builder, {
        sourceModule: "systolab_ecommerce_intelligence",
        signalKey: "native_ecommerce_purchase_confidence_score",
        label: "E-commerce Purchase Confidence",
        score: ratioScore(ecommerceSignals.length, 8),
        url: page.finalUrl,
        pageRole: page.role,
        selectorPath: "body,script[type='application/ld+json']",
        rawValue: ecommerceSignals.length ? `E-commerce confidence signals detected: ${ecommerceSignals.join(", ")}` : "E-commerce confidence signals are limited",
        confidenceBasis: "Native SYSTOLAB e-commerce extraction for products, cart, checkout, reviews, shipping, returns, payment, and support reassurance.",
        dimensionRefs: ["trust", "conversionReadiness", "informationClarity"],
        rawDomSnapshot: bodySnapshot,
        details: { ecommerceSignals, businessType }
      }));
    }
  }

  return evidence;
}

export function buildCompetitorContentGapEvidence(
  primaryUrl: URL,
  primaryEvidence: EvidenceObject[],
  competitors: Array<{ requestedUrl: string; analysis: { evidenceObjects: EvidenceObject[] } | null }>,
  builder: EvidenceBuilder
): EvidenceObject[] {
  const signalKeys = [
    "native_topic_authority_coverage_score",
    "native_customer_question_coverage_score",
    "native_trust_proof_coverage_score",
    "native_decision_confidence_score",
    "native_search_to_sale_support_score",
    "native_entity_clarity_score",
    "native_citation_credibility_score",
    "native_content_freshness_score"
  ];
  const evidence: EvidenceObject[] = [];

  for (const competitor of competitors) {
    if (!competitor.analysis) continue;
    const gaps = signalKeys
      .map((signalKey) => {
        const primaryScore = averageSignalScore(primaryEvidence, signalKey);
        const competitorScore = averageSignalScore(competitor.analysis!.evidenceObjects, signalKey);
        return { signalKey, primaryScore, competitorScore, gap: competitorScore - primaryScore };
      })
      .filter((gap) => gap.gap >= 12)
      .sort((a, b) => b.gap - a.gap);

    const topGap = gaps[0];
    if (!topGap) continue;
    const competitorLabel = safeCompetitorLabel(competitor.requestedUrl);
    evidence.push(builder.add({
      sourceType: "system",
      url: primaryUrl.toString(),
      pageRole: "competitor_content_gap",
      rawValue: `${competitorLabel} shows stronger ${signalBusinessLabel(topGap.signalKey)} support by ${Math.round(topGap.gap)} points.`,
      normalizedInput: {
        signalKey: "native_competitor_content_gap_score",
        value: clampScore(100 - topGap.gap),
        sourceModule: "systolab_competitor_content_gap_intelligence",
        label: "Competitor Content Gap",
        competitor: competitorLabel,
        comparedSignal: topGap.signalKey,
        primaryScore: Math.round(topGap.primaryScore),
        competitorScore: Math.round(topGap.competitorScore),
        gap: Math.round(topGap.gap)
      },
      validationMethod: "multi_page_verification",
      confidenceBasis: "Native SYSTOLAB comparison of primary and competitor evidence contributors across content, proof, questions, entity, citation, and freshness signals.",
      groundTruthConfidence: 76,
      groundTruthMeaning: "Competitor content gap is an internal SYSTOLAB evidence contributor and must be compressed before customer-facing use.",
      dimensionRefs: ["visibilityStructure", "informationClarity", "trust", "conversionReadiness"]
    }));
  }

  return evidence;
}

function scoreSignal(builder: EvidenceBuilder, input: SignalInput): EvidenceObject {
  return builder.add({
    sourceType: "html",
    url: input.url,
    pageRole: input.pageRole,
    selectorPath: input.selectorPath,
    rawValue: input.rawValue,
    normalizedInput: {
      signalKey: input.signalKey,
      value: clampScore(input.score),
      sourceModule: input.sourceModule,
      label: input.label,
      ...(input.details ?? {})
    },
    validationMethod: "structural_redundancy",
    confidenceBasis: input.confidenceBasis,
    groundTruthConfidence: input.score >= 70 ? 84 : input.score >= 45 ? 74 : 64,
    groundTruthMeaning: `${input.label} is a native SYSTOLAB evidence contributor, not a third-party score.`,
    rawDomSnapshot: input.rawDomSnapshot,
    dimensionRefs: input.dimensionRefs
  });
}

function titleQuality(title: string): number {
  if (!title) return 0;
  if (title.length >= 30 && title.length <= 65) return 100;
  if (title.length >= 15 && title.length <= 90) return 72;
  return 45;
}

function descriptionQuality(description: string): number {
  if (!description) return 0;
  if (description.length >= 70 && description.length <= 170) return 100;
  if (description.length >= 35 && description.length <= 220) return 72;
  return 45;
}

function headingStructureScore(h1Count: number, h2Count: number): number {
  if (h1Count === 1 && h2Count > 0) return 100;
  if (h1Count === 1) return 78;
  if (h1Count > 1 && h2Count > 0) return 62;
  return 25;
}

function schemaCoverageScore(types: string[], businessType: string): number {
  if (types.length === 0) return 0;
  const normalized = new Set(types.map((type) => type.toLowerCase()));
  let score = 40;
  if (normalized.has("organization") || normalized.has("localbusiness") || normalized.has("website") || normalized.has("webpage")) score += 25;
  if (normalized.has("product") && businessType === "ecommerce") score += 20;
  if (normalized.has("breadcrumblist")) score += 10;
  if (normalized.has("faqpage")) score += 5;
  return clampScore(score);
}

function buildGeoReadinessScore($: cheerio.CheerioAPI, text: string, schemaTypes: string[]): number {
  const questionHeadings = $("h1,h2,h3").filter((_, heading) => /\?|\bhow\b|\bwhat\b|\bwhy\b|\bwhen\b|\bwhere\b|\bwho\b/i.test($(heading).text())).length;
  const topicalSections = $("section,article,h2,h3").length;
  const answerSignals = /faq|questions|answer|guide|learn|what to expect|how it works/i.test(text);
  const attributionSignals = /author|reviewed by|updated|published|source|references|case study/i.test(text);
  const entitySignals = schemaTypes.length > 0 || /about|team|company|clinic|service|product|brand/i.test(text);
  return ratioScore([questionHeadings > 0, topicalSections >= 4, answerSignals, attributionSignals, entitySignals].filter(Boolean).length, 5);
}

function extractSchemaTypes($: cheerio.CheerioAPI): string[] {
  const types = new Set<string>();
  $("script[type='application/ld+json']").each((_, script) => {
    const raw = $(script).contents().text();
    try {
      collectSchemaTypes(JSON.parse(raw), types);
    } catch {
      // Invalid JSON-LD is ignored as a failed entity signal, not surfaced as a crawler failure.
    }
  });
  $("[itemscope][itemtype]").each((_, element) => {
    const itemType = $(element).attr("itemtype") ?? "";
    const match = itemType.match(/schema\.org\/([^/#]+)/i);
    if (match?.[1]) types.add(match[1]);
  });
  return [...types].sort();
}

function collectSchemaTypes(value: unknown, types: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectSchemaTypes(item, types));
    return;
  }
  const record = value as Record<string, unknown>;
  const rawType = record["@type"];
  if (typeof rawType === "string") types.add(rawType);
  if (Array.isArray(rawType)) rawType.filter((item): item is string => typeof item === "string").forEach((item) => types.add(item));
  collectSchemaTypes(record["@graph"], types);
  collectSchemaTypes(record["mainEntity"], types);
  collectSchemaTypes(record["itemListElement"], types);
}

function detectBusinessType(text: string, url: string, schemaTypes: string[]): string {
  const haystack = `${text} ${url} ${schemaTypes.join(" ")}`.toLowerCase();
  if (/product|cart|checkout|shopify|woocommerce|magento|bigcommerce|shipping|returns?|add to cart/.test(haystack)) return "ecommerce";
  if (/dentist|dental|orthodont|implant|teeth/.test(haystack)) return "dental_clinic";
  if (/lawyer|attorney|law firm|legal|case consultation/.test(haystack)) return "law_firm";
  if (/doctor|clinic|healthcare|patient|treatment|medical/.test(haystack)) return "healthcare";
  if (/real estate|realtor|property|listing|homes for sale/.test(haystack)) return "real_estate";
  if (/restaurant|menu|reservation|dining|order online/.test(haystack)) return "hospitality";
  if (/saas|software|platform|subscription|demo|integration/.test(haystack)) return "saas";
  if (/interior design|designer|portfolio|renovation/.test(haystack)) return "interior_designer";
  if (/contractor|plumber|electrician|repair|installation|service area/.test(haystack)) return "contractor";
  if (/course|school|academy|university|training/.test(haystack)) return "education";
  if (/consultant|consulting|advisor|strategy/.test(haystack)) return "consultant";
  if (/localbusiness|local business|service area|appointment|quote|estimate/.test(haystack)) return "local_service";
  return "unknown";
}

function expectedQuestionFamilies(businessType: string): QuestionFamily[] {
  const extras =
    businessType === "ecommerce" ? BUSINESS_QUESTION_FAMILIES.ecommerce :
    businessType === "local_service" || businessType === "contractor" || businessType === "dental_clinic" ? BUSINESS_QUESTION_FAMILIES.local_service :
    businessType === "healthcare" ? BUSINESS_QUESTION_FAMILIES.healthcare :
    businessType === "law_firm" ? BUSINESS_QUESTION_FAMILIES.law_firm :
    businessType === "saas" ? BUSINESS_QUESTION_FAMILIES.saas :
    [];
  return [...CORE_QUESTION_FAMILIES, ...(extras ?? [])];
}

function extractTrustProofSignals(text: string, html: string): string[] {
  const checks: Array<[string, RegExp]> = [
    ["reviews", /reviews?|ratings?|stars?/i],
    ["testimonials", /testimonials?|what clients say|patient stories/i],
    ["case_studies", /case stud|success story|results/i],
    ["certifications", /certified|licensed|insured|accredited/i],
    ["awards", /award|recognized|featured/i],
    ["portfolio", /portfolio|before and after|gallery|projects/i],
    ["client_logos", /trusted by|our clients|partners/i],
    ["media_mentions", /as seen in|press|media|featured in/i]
  ];
  return checks.filter(([, pattern]) => pattern.test(`${text} ${html}`)).map(([key]) => key);
}

function extractLocalSignals(text: string, html: string, schemaTypes: string[]): string[] {
  const haystack = `${text} ${html} ${schemaTypes.join(" ")}`;
  const checks: Array<[string, RegExp]> = [
    ["phone", /tel:|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/i],
    ["address", /address|street|road|avenue|suite|city|state|zip/i],
    ["hours", /hours|open|closed|mon|tue|wed|thu|fri|sat|sun/i],
    ["service_area", /service area|areas served|near me|local/i],
    ["map", /google maps|map|directions/i],
    ["local_schema", /LocalBusiness|Dentist|MedicalBusiness|LegalService/i]
  ];
  return checks.filter(([, pattern]) => pattern.test(haystack)).map(([key]) => key);
}

function extractEcommerceSignals(text: string, html: string, schemaTypes: string[]): string[] {
  const haystack = `${text} ${html} ${schemaTypes.join(" ")}`;
  const checks: Array<[string, RegExp]> = [
    ["product", /Product|product|sku|variant/i],
    ["cart", /cart|add to cart|basket/i],
    ["checkout", /checkout|payment/i],
    ["reviews", /review|rating|stars/i],
    ["shipping", /shipping|delivery|dispatch/i],
    ["returns", /return|refund|exchange/i],
    ["secure_payment", /secure|ssl|payment|visa|mastercard|paypal/i],
    ["support", /support|help|contact/i]
  ];
  return checks.filter(([, pattern]) => pattern.test(haystack)).map(([key]) => key);
}

function extractEntitySignals(
  text: string,
  title: string,
  description: string,
  headingText: string,
  schemaTypes: string[],
  businessType: string,
  localSignals: string[],
  ecommerceSignals: string[]
): string[] {
  const haystack = `${title} ${description} ${headingText} ${text} ${schemaTypes.join(" ")}`;
  const checks: Array<[string, boolean]> = [
    ["business_entity", businessType !== "unknown" || /company|clinic|firm|agency|store|business|brand/i.test(haystack)],
    ["service_entity", /services?|solutions?|treatments?|practice areas?|repairs?|consulting|appointments?/i.test(haystack)],
    ["product_entity", ecommerceSignals.includes("product") || /products?|sku|catalog|collection/i.test(haystack)],
    ["location_entity", localSignals.length >= 2 || /near me|service area|address|directions|city|local/i.test(haystack)],
    ["industry_entity", /dental|legal|healthcare|real estate|restaurant|software|education|contractor|consulting|ecommerce/i.test(haystack)],
    ["brand_consistency", title.length > 0 && headingText.length > 0 && sharedMeaningfulWordCount(title, headingText) >= 1],
    ["person_entity", /founder|doctor|dentist|attorney|lawyer|consultant|author|team|specialist|expert/i.test(haystack)],
    ["structured_data_alignment", schemaTypes.length > 0]
  ];
  return checks.filter(([, present]) => present).map(([key]) => key);
}

function extractCitationSignals(text: string, html: string): string[] {
  const haystack = `${text} ${html}`;
  const checks: Array<[string, RegExp]> = [
    ["professional_directory", /yelp|google business|bing places|tripadvisor|zocdoc|avvo|healthgrades|houzz|clutch|g2|capterra/i],
    ["industry_association", /association|chamber of commerce|member of|accredited by|certified by|board certified/i],
    ["business_listing", /listed on|find us on|business profile|directory|local listing/i],
    ["reputation_signal", /reviews?|ratings?|stars?|trustpilot|bbb|better business bureau/i],
    ["authority_reference", /featured in|as seen in|press|publication|media|award/i],
    ["social_credibility", /linkedin|facebook|instagram|youtube|x\.com|twitter|tiktok/i],
    ["partner_reference", /partners?|trusted by|clients?|vendors?|affiliations?/i]
  ];
  return checks.filter(([, pattern]) => pattern.test(haystack)).map(([key]) => key);
}

function evaluateContentFreshness(text: string, headers: Record<string, string>): { score: number; rawValue: string; details: Record<string, unknown> } {
  const currentYear = new Date().getFullYear();
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1])).filter((year) => year >= 2000 && year <= currentYear + 1);
  const latestYear = years.length ? Math.max(...years) : null;
  const lastModified = headers["last-modified"] ?? headers["Last-Modified"] ?? "";
  const lastModifiedYear = Number.isFinite(Date.parse(lastModified)) ? new Date(lastModified).getFullYear() : null;
  const effectiveYear = Math.max(latestYear ?? 0, lastModifiedYear ?? 0) || null;
  const outdatedSignals = [
    /\bexpired\b|\bold offer\b|\blimited time offer\b/i.test(text),
    /\bcoming soon\b|\bunder construction\b/i.test(text),
    /\b201[0-9]\b|\b2020\b|\b2021\b|\b2022\b/.test(text) && currentYear >= 2026,
    /covid-19|pandemic/i.test(text) && !/\b2025\b|\b2026\b|\bupdated\b/i.test(text)
  ];
  const freshnessSignals = [
    /updated|last updated|reviewed|current|new|latest|recent/i.test(text),
    effectiveYear !== null && effectiveYear >= currentYear - 1,
    lastModifiedYear !== null && lastModifiedYear >= currentYear - 1,
    /blog|insights|resources|news|guide/i.test(text) && text.length > 900
  ];
  const freshnessBase = ratioScore(freshnessSignals.filter(Boolean).length, freshnessSignals.length);
  const decayPenalty = Math.min(55, outdatedSignals.filter(Boolean).length * 18);
  const score = clampScore(freshnessBase || effectiveYear ? Math.max(20, freshnessBase - decayPenalty) : 45 - decayPenalty);
  return {
    score,
    rawValue: `Content freshness score ${score}; latest visible year=${effectiveYear ?? "not detected"}, freshness signals=${freshnessSignals.filter(Boolean).length}, outdated signals=${outdatedSignals.filter(Boolean).length}`,
    details: {
      latestVisibleYear: effectiveYear,
      freshnessSignalCount: freshnessSignals.filter(Boolean).length,
      outdatedSignalCount: outdatedSignals.filter(Boolean).length
    }
  };
}

function sharedMeaningfulWordCount(left: string, right: string): number {
  const stop = new Set(["the", "and", "for", "with", "from", "your", "our", "home", "services"]);
  const leftWords = new Set(left.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !stop.has(word)));
  return right.toLowerCase().split(/[^a-z0-9]+/).filter((word) => leftWords.has(word)).length;
}

function isInternalLink(href: string | undefined, baseUrl: string, origin: string): boolean {
  if (!href) return false;
  try {
    return new URL(href, baseUrl).origin === origin;
  } catch {
    return false;
  }
}

function averageSignalScore(evidenceObjects: EvidenceObject[], signalKey: string): number {
  const matches = evidenceObjects.filter((evidence) => evidence.normalizedInput.signalKey === signalKey);
  if (matches.length === 0) return 0;
  return matches.reduce((sum, evidence) => {
    const value = evidence.normalizedInput.value;
    if (typeof value === "number") return sum + clampScore(value);
    if (typeof value === "boolean") return sum + (value ? 100 : 0);
    return sum;
  }, 0) / matches.length;
}

function safeCompetitorLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Competitor";
  }
}

function signalBusinessLabel(signalKey: string): string {
  if (signalKey.includes("topic_authority")) return "topical coverage";
  if (signalKey.includes("question")) return "customer question coverage";
  if (signalKey.includes("trust_proof")) return "trust-building proof";
  if (signalKey.includes("decision_confidence")) return "decision confidence";
  if (signalKey.includes("search_to_sale")) return "search-to-sale support";
  if (signalKey.includes("entity")) return "entity clarity";
  if (signalKey.includes("citation")) return "credibility reinforcement";
  if (signalKey.includes("freshness")) return "content freshness";
  return "content decision support";
}

function ratioScore(found: number, total: number): number {
  if (total <= 0) return 0;
  return clampScore((found / total) * 100);
}

function averageScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  return clampScore(scores.reduce((sum, score) => sum + clampScore(score), 0) / scores.length);
}
