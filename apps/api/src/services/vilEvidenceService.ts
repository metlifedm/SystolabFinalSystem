import { isMongoConnected } from "../db/mongoose.js";
import { makeId } from "../utils/crypto.js";
import { BehavioralEvidence, BehavioralEvidenceDocument, BehavioralEvidenceType } from "../models/BehavioralEvidence.js";
import { _memBehavioralEvents, getEventsForSession, getEventsForWorkspace } from "./vilEventService.js";

// ─── Behavioral Confidence Engine ──────────────────────────────────────────────
// Every behavioral conclusion must carry a confidence score, consistency level,
// and statistical significance flag. Weak signals are not suppressed — they are
// surfaced with low confidence so downstream systems can weight them appropriately.

interface ConfidenceResult {
  confidenceScore: number;
  consistencyLevel: "low" | "medium" | "high";
  statisticalSignificance: boolean;
}

function computeConfidence(
  sampleSize: number,
  rate: number,
  historicalRates: number[] = []
): ConfidenceResult {
  // Sample adequacy: 0–50 points. Reaches 50 at 1000 samples.
  const sampleScore = Math.min(sampleSize / 1000, 1) * 50;

  // Consistency: how stable the rate has been historically (0–40 points)
  let consistencyScore = 10;
  let consistencyLevel: "low" | "medium" | "high" = "low";
  if (historicalRates.length >= 3) {
    const avg = historicalRates.reduce((a, b) => a + b, 0) / historicalRates.length;
    const variance = historicalRates.reduce((s, r) => s + Math.pow(r - avg, 2), 0) / historicalRates.length;
    const cv = avg > 0 ? Math.sqrt(variance) / avg : 1;
    if (cv < 0.1) { consistencyScore = 40; consistencyLevel = "high"; }
    else if (cv < 0.25) { consistencyScore = 25; consistencyLevel = "medium"; }
    else { consistencyScore = 10; consistencyLevel = "low"; }
  }

  // Rate relevance: extreme rates are more actionable (0–10 points)
  const extremeness = Math.abs(rate - 0.5) * 2; // 0 = neutral, 1 = extreme
  const rateScore = extremeness * 10;

  const confidenceScore = Math.min(Math.round(sampleScore + consistencyScore + rateScore), 100);
  const statisticalSignificance = sampleSize >= 30 && confidenceScore >= 50;

  return { confidenceScore, consistencyLevel, statisticalSignificance };
}

// ─── In-memory evidence store ──────────────────────────────────────────────────

export const _memBehavioralEvidences = new Map<string, Record<string, unknown>>();

type BehavioralEvidenceInput = {
  behavioralEvidenceId: string;
  workspaceId: string;
  tenantSlug: string;
  evidenceType: BehavioralEvidenceType;
  confidenceScore: number;
  sampleSize: number;
  consistencyLevel: "low" | "medium" | "high";
  statisticalSignificance: boolean;
  sourceSessionIds: string[];
  sourceEventIds: string[];
  targetPage?: string;
  targetElement?: string;
  observation: string;
  metrics: Record<string, number>;
  vfsContribution?: number;
  consumedByIntelligence: boolean;
  recommendationIds: string[];
  observedFrom: Date;
  observedTo: Date;
  generatedAt: Date;
};

async function persistEvidence(
  data: BehavioralEvidenceInput
): Promise<BehavioralEvidenceDocument | Record<string, unknown>> {
  if (!isMongoConnected()) {
    const rec = { ...data, createdAt: new Date() };
    _memBehavioralEvidences.set(data.behavioralEvidenceId, rec as Record<string, unknown>);
    return rec as Record<string, unknown>;
  }
  return BehavioralEvidence.create(data);
}

interface EvidenceWindow {
  workspaceId: string;
  tenantSlug: string;
  observedFrom: Date;
  observedTo: Date;
}

// ─── CTA Intelligence Engine ───────────────────────────────────────────────────

export async function generateCtaFrictionEvidence(
  w: EvidenceWindow
): Promise<(BehavioralEvidenceDocument | Record<string, unknown>)[]> {
  const [ctaViews, ctaClicks, ctaAbandons] = await Promise.all([
    getEventsForWorkspace(w.workspaceId, { eventType: "cta_view", since: w.observedFrom }),
    getEventsForWorkspace(w.workspaceId, { eventType: "cta_click", since: w.observedFrom }),
    getEventsForWorkspace(w.workspaceId, { eventType: "cta_abandon", since: w.observedFrom })
  ]);

  const results: (BehavioralEvidenceDocument | Record<string, unknown>)[] = [];
  const viewCount = ctaViews.length;
  if (viewCount < 5) return results;

  const clickRate = ctaClicks.length / viewCount;
  const abandonRate = ctaAbandons.length / viewCount;

  if (abandonRate > 0.3 || clickRate < 0.15) {
    const { confidenceScore, consistencyLevel, statisticalSignificance } = computeConfidence(
      viewCount, abandonRate
    );
    const sessionIds = uniqueSessionIds(ctaViews);
    results.push(await persistEvidence({
      behavioralEvidenceId: makeId("vil_bev"),
      workspaceId: w.workspaceId,
      tenantSlug: w.tenantSlug,
      evidenceType: "cta_friction",
      confidenceScore,
      sampleSize: viewCount,
      consistencyLevel,
      statisticalSignificance,
      sourceSessionIds: sessionIds.slice(0, 100),
      sourceEventIds: eventIds([...ctaViews, ...ctaAbandons]).slice(0, 100),
      observation: `CTA friction detected: ${pct(clickRate)}% click-through, ${pct(abandonRate)}% abandon rate from ${viewCount} exposures`,
      metrics: {
        viewCount,
        clickCount: ctaClicks.length,
        abandonCount: ctaAbandons.length,
        clickRate: pct(clickRate),
        abandonRate: pct(abandonRate)
      },
      vfsContribution: Math.round(abandonRate * 20),
      consumedByIntelligence: false,
      recommendationIds: [],
      observedFrom: w.observedFrom,
      observedTo: w.observedTo,
      generatedAt: new Date()
    }));
  }
  return results;
}

// ─── Form Intelligence Engine ──────────────────────────────────────────────────

export async function generateFormAbandonmentEvidence(
  w: EvidenceWindow
): Promise<(BehavioralEvidenceDocument | Record<string, unknown>)[]> {
  const [formStarts, formAbandons, formSubmits] = await Promise.all([
    getEventsForWorkspace(w.workspaceId, { eventType: "form_start", since: w.observedFrom }),
    getEventsForWorkspace(w.workspaceId, { eventType: "form_abandon", since: w.observedFrom }),
    getEventsForWorkspace(w.workspaceId, { eventType: "form_submit", since: w.observedFrom })
  ]);

  const results: (BehavioralEvidenceDocument | Record<string, unknown>)[] = [];
  if (formStarts.length < 3) return results;

  const abandonRate = formAbandons.length / formStarts.length;
  const completionRate = formSubmits.length / formStarts.length;

  if (abandonRate > 0.4) {
    const { confidenceScore, consistencyLevel, statisticalSignificance } = computeConfidence(
      formStarts.length, abandonRate
    );
    results.push(await persistEvidence({
      behavioralEvidenceId: makeId("vil_bev"),
      workspaceId: w.workspaceId,
      tenantSlug: w.tenantSlug,
      evidenceType: "form_abandonment",
      confidenceScore,
      sampleSize: formStarts.length,
      consistencyLevel,
      statisticalSignificance,
      sourceSessionIds: uniqueSessionIds(formAbandons).slice(0, 100),
      sourceEventIds: eventIds(formAbandons).slice(0, 100),
      observation: `Form abandonment: ${pct(abandonRate)}% abandon rate, ${pct(completionRate)}% completion from ${formStarts.length} starts`,
      metrics: {
        formStarts: formStarts.length,
        abandons: formAbandons.length,
        submissions: formSubmits.length,
        abandonRate: pct(abandonRate),
        completionRate: pct(completionRate)
      },
      vfsContribution: Math.round(abandonRate * 15),
      consumedByIntelligence: false,
      recommendationIds: [],
      observedFrom: w.observedFrom,
      observedTo: w.observedTo,
      generatedAt: new Date()
    }));
  }
  return results;
}

// ─── Scroll Intelligence Engine ────────────────────────────────────────────────

export async function generateEngagementDropoffEvidence(
  w: EvidenceWindow
): Promise<(BehavioralEvidenceDocument | Record<string, unknown>)[]> {
  const scrollEvents = await getEventsForWorkspace(w.workspaceId, { eventType: "scroll_depth", since: w.observedFrom });

  const results: (BehavioralEvidenceDocument | Record<string, unknown>)[] = [];
  if (scrollEvents.length < 5) return results;

  const depths = scrollEvents.map((e) => (((e as Record<string, unknown>)["data"] as Record<string, unknown>)?.["depth"] as number) ?? 0);
  const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;
  const shallowCount = depths.filter((d) => d < 30).length;
  const shallowRate = shallowCount / depths.length;

  if (avgDepth < 50 || shallowRate > 0.4) {
    const { confidenceScore, consistencyLevel, statisticalSignificance } = computeConfidence(
      scrollEvents.length, shallowRate
    );
    results.push(await persistEvidence({
      behavioralEvidenceId: makeId("vil_bev"),
      workspaceId: w.workspaceId,
      tenantSlug: w.tenantSlug,
      evidenceType: "engagement_dropoff",
      confidenceScore,
      sampleSize: scrollEvents.length,
      consistencyLevel,
      statisticalSignificance,
      sourceSessionIds: uniqueSessionIds(scrollEvents).slice(0, 100),
      sourceEventIds: eventIds(scrollEvents).slice(0, 100),
      observation: `Content engagement dropoff: avg scroll depth ${Math.round(avgDepth)}%, ${pct(shallowRate)}% of sessions scroll below 30%`,
      metrics: {
        avgScrollDepth: Math.round(avgDepth),
        shallowEngagementRate: pct(shallowRate),
        sampleCount: scrollEvents.length
      },
      vfsContribution: shallowRate > 0.6 ? 10 : 0,
      consumedByIntelligence: false,
      recommendationIds: [],
      observedFrom: w.observedFrom,
      observedTo: w.observedTo,
      generatedAt: new Date()
    }));
  }
  return results;
}

// ─── Exit Intelligence Engine ──────────────────────────────────────────────────

export async function generateExitConcentrationEvidence(
  w: EvidenceWindow
): Promise<(BehavioralEvidenceDocument | Record<string, unknown>)[]> {
  const exitEvents = await getEventsForWorkspace(w.workspaceId, { eventType: "page_exit", since: w.observedFrom });

  const results: (BehavioralEvidenceDocument | Record<string, unknown>)[] = [];
  if (exitEvents.length < 5) return results;

  const exitsByPage = new Map<string, typeof exitEvents>();
  for (const e of exitEvents) {
    const page = (e as Record<string, unknown>)["page"] as string;
    if (!exitsByPage.has(page)) exitsByPage.set(page, []);
    exitsByPage.get(page)!.push(e);
  }

  for (const [page, pageExits] of exitsByPage.entries()) {
    const exitRate = pageExits.length / exitEvents.length;
    if (exitRate < 0.25) continue; // Only pages where 25%+ of all exits occur

    const { confidenceScore, consistencyLevel, statisticalSignificance } = computeConfidence(
      exitEvents.length, exitRate
    );
    results.push(await persistEvidence({
      behavioralEvidenceId: makeId("vil_bev"),
      workspaceId: w.workspaceId,
      tenantSlug: w.tenantSlug,
      evidenceType: "exit_concentration",
      confidenceScore,
      sampleSize: exitEvents.length,
      consistencyLevel,
      statisticalSignificance,
      sourceSessionIds: uniqueSessionIds(pageExits).slice(0, 100),
      sourceEventIds: eventIds(pageExits).slice(0, 100),
      targetPage: page,
      observation: `Exit concentration on "${page}": ${pct(exitRate)}% of all exits (${pageExits.length}/${exitEvents.length} sessions) depart here`,
      metrics: {
        exitCount: pageExits.length,
        totalExits: exitEvents.length,
        exitConcentrationRate: pct(exitRate)
      },
      vfsContribution: 0,
      consumedByIntelligence: false,
      recommendationIds: [],
      observedFrom: w.observedFrom,
      observedTo: w.observedTo,
      generatedAt: new Date()
    }));
  }
  return results;
}

// ─── Friction Detection Engine ─────────────────────────────────────────────────

export async function generateFrictionEvidence(
  w: EvidenceWindow
): Promise<(BehavioralEvidenceDocument | Record<string, unknown>)[]> {
  const [rageClicks, deadClicks, navUncertain] = await Promise.all([
    getEventsForWorkspace(w.workspaceId, { eventType: "rage_click", since: w.observedFrom }),
    getEventsForWorkspace(w.workspaceId, { eventType: "dead_click", since: w.observedFrom }),
    getEventsForWorkspace(w.workspaceId, { eventType: "navigation_uncertainty", since: w.observedFrom })
  ]);

  const results: (BehavioralEvidenceDocument | Record<string, unknown>)[] = [];

  if (rageClicks.length >= 3) {
    const { confidenceScore, consistencyLevel, statisticalSignificance } = computeConfidence(
      rageClicks.length, Math.min(rageClicks.length / 100, 1)
    );
    const affectedSessions = uniqueSessionIds(rageClicks);
    results.push(await persistEvidence({
      behavioralEvidenceId: makeId("vil_bev"),
      workspaceId: w.workspaceId,
      tenantSlug: w.tenantSlug,
      evidenceType: "rage_click_cluster",
      confidenceScore,
      sampleSize: rageClicks.length,
      consistencyLevel,
      statisticalSignificance,
      sourceSessionIds: affectedSessions.slice(0, 100),
      sourceEventIds: eventIds(rageClicks).slice(0, 100),
      observation: `Rage click cluster: ${rageClicks.length} rage click events across ${affectedSessions.length} sessions — repeated clicking signals frustration or broken interactions`,
      metrics: { rageClickCount: rageClicks.length, affectedSessions: affectedSessions.length },
      vfsContribution: Math.min(rageClicks.length * 5, 60),
      consumedByIntelligence: false,
      recommendationIds: [],
      observedFrom: w.observedFrom,
      observedTo: w.observedTo,
      generatedAt: new Date()
    }));
  }

  if (deadClicks.length >= 5) {
    const { confidenceScore, consistencyLevel, statisticalSignificance } = computeConfidence(
      deadClicks.length, Math.min(deadClicks.length / 100, 1)
    );
    results.push(await persistEvidence({
      behavioralEvidenceId: makeId("vil_bev"),
      workspaceId: w.workspaceId,
      tenantSlug: w.tenantSlug,
      evidenceType: "dead_click_cluster",
      confidenceScore,
      sampleSize: deadClicks.length,
      consistencyLevel,
      statisticalSignificance,
      sourceSessionIds: uniqueSessionIds(deadClicks).slice(0, 100),
      sourceEventIds: eventIds(deadClicks).slice(0, 100),
      observation: `Dead click cluster: ${deadClicks.length} clicks on non-functional elements — visitors expect interactions that are not implemented`,
      metrics: {
        deadClickCount: deadClicks.length,
        affectedSessions: uniqueSessionIds(deadClicks).length
      },
      vfsContribution: Math.min(deadClicks.length * 3, 30),
      consumedByIntelligence: false,
      recommendationIds: [],
      observedFrom: w.observedFrom,
      observedTo: w.observedTo,
      generatedAt: new Date()
    }));
  }

  if (navUncertain.length >= 3) {
    const { confidenceScore, consistencyLevel, statisticalSignificance } = computeConfidence(
      navUncertain.length, Math.min(navUncertain.length / 50, 1)
    );
    results.push(await persistEvidence({
      behavioralEvidenceId: makeId("vil_bev"),
      workspaceId: w.workspaceId,
      tenantSlug: w.tenantSlug,
      evidenceType: "navigation_uncertainty",
      confidenceScore,
      sampleSize: navUncertain.length,
      consistencyLevel,
      statisticalSignificance,
      sourceSessionIds: uniqueSessionIds(navUncertain).slice(0, 100),
      sourceEventIds: eventIds(navUncertain).slice(0, 100),
      observation: `Navigation uncertainty: ${navUncertain.length} events where visitors reversed direction or revisited pages — site structure may be unclear`,
      metrics: {
        uncertaintyEventCount: navUncertain.length,
        affectedSessions: uniqueSessionIds(navUncertain).length
      },
      vfsContribution: Math.min(navUncertain.length * 4, 24),
      consumedByIntelligence: false,
      recommendationIds: [],
      observedFrom: w.observedFrom,
      observedTo: w.observedTo,
      generatedAt: new Date()
    }));
  }

  return results;
}

// ─── Visitor Frustration Score (VFS) ──────────────────────────────────────────
// Composite metric: rage clicks + dead clicks + hover confusion + form abandonment
// + rapid exits + navigation uncertainty. Normalized to 0–100.
// Every VFS is traceable through source event IDs.

export async function computeSessionVfs(sessionId: string): Promise<{ vfsScore: number; breakdown: Record<string, number> }> {
  const events = await getEventsForSession(sessionId);

  let rageCnt = 0, deadCnt = 0, hoverCnt = 0, navCnt = 0, formAbandons = 0, rapidExits = 0;

  for (const evt of events) {
    const e = evt as Record<string, unknown>;
    switch (e["eventType"] as string) {
      case "rage_click":            rageCnt++; break;
      case "dead_click":            deadCnt++; break;
      case "hover_confusion":       hoverCnt++; break;
      case "navigation_uncertainty": navCnt++; break;
      case "form_abandon":          formAbandons++; break;
      case "page_exit": {
        const dwellMs = ((e["data"] as Record<string, unknown>)?.["dwellMs"] as number) ?? 99999;
        if (dwellMs < 10_000) rapidExits++;
        break;
      }
    }
  }

  const breakdown = {
    rageClichts: Math.min(rageCnt * 20, 60),
    deadClicks: Math.min(deadCnt * 10, 30),
    hoverConfusion: Math.min(hoverCnt * 5, 15),
    navigationUncertainty: Math.min(navCnt * 8, 24),
    formAbandonment: Math.min(formAbandons * 15, 30),
    rapidExits: Math.min(rapidExits * 20, 40)
  };

  const raw = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const vfsScore = Math.min(raw, 100);

  return { vfsScore, breakdown };
}

// ─── Full Evidence Generation Sweep ───────────────────────────────────────────

export async function runEvidenceGeneration(
  workspaceId: string,
  tenantSlug: string,
  windowDays = 7
): Promise<{ generated: number; types: string[]; evidenceIds: string[] }> {
  const observedFrom = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const observedTo = new Date();
  const w: EvidenceWindow = { workspaceId, tenantSlug, observedFrom, observedTo };

  const [ctaResults, formResults, scrollResults, exitResults, frictionResults] = await Promise.all([
    generateCtaFrictionEvidence(w),
    generateFormAbandonmentEvidence(w),
    generateEngagementDropoffEvidence(w),
    generateExitConcentrationEvidence(w),
    generateFrictionEvidence(w)
  ]);

  const all = [...ctaResults, ...formResults, ...scrollResults, ...exitResults, ...frictionResults];
  const types = [...new Set(all.map((e) => (e as Record<string, unknown>)["evidenceType"] as string))];
  const evidenceIds = all.map((e) => (e as Record<string, unknown>)["behavioralEvidenceId"] as string);

  return { generated: all.length, types, evidenceIds };
}

// ─── Evidence Listing ──────────────────────────────────────────────────────────

export async function listBehavioralEvidence(
  workspaceId: string,
  opts: { evidenceType?: BehavioralEvidenceType; minConfidence?: number; limit?: number; skip?: number } = {}
): Promise<{ evidence: (BehavioralEvidenceDocument | Record<string, unknown>)[]; total: number }> {
  const limit = opts.limit ?? 50;
  const skip = opts.skip ?? 0;

  if (!isMongoConnected()) {
    const all = [..._memBehavioralEvidences.values()].filter((e) => {
      if (e["workspaceId"] !== workspaceId) return false;
      if (opts.evidenceType && e["evidenceType"] !== opts.evidenceType) return false;
      if (opts.minConfidence !== undefined && (e["confidenceScore"] as number) < opts.minConfidence) return false;
      return true;
    });
    return { evidence: all.slice(skip, skip + limit), total: all.length };
  }

  const query: Record<string, unknown> = { workspaceId };
  if (opts.evidenceType) query["evidenceType"] = opts.evidenceType;
  if (opts.minConfidence !== undefined) query["confidenceScore"] = { $gte: opts.minConfidence };
  const [evidence, total] = await Promise.all([
    BehavioralEvidence.find(query).sort({ generatedAt: -1 }).skip(skip).limit(limit).lean(),
    BehavioralEvidence.countDocuments(query)
  ]);
  return { evidence, total };
}

export async function getBehavioralEvidenceById(
  behavioralEvidenceId: string
): Promise<BehavioralEvidenceDocument | Record<string, unknown> | null> {
  if (!isMongoConnected()) {
    return _memBehavioralEvidences.get(behavioralEvidenceId) ?? null;
  }
  return BehavioralEvidence.findOne({ behavioralEvidenceId }).lean();
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function pct(rate: number): number {
  return Math.round(rate * 100);
}

function uniqueSessionIds(events: (Record<string, unknown> | object)[]): string[] {
  return [...new Set(events.map((e) => (e as Record<string, unknown>)["sessionId"] as string))];
}

function eventIds(events: (Record<string, unknown> | object)[]): string[] {
  return events.map((e) => (e as Record<string, unknown>)["eventId"] as string);
}
