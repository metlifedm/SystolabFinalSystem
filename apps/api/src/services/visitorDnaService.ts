import { isMongoConnected } from "../db/mongoose.js";
import { makeId } from "../utils/crypto.js";
import { VisitorDnaRecord, VisitorDnaRecordDocument, VisitorArchetype } from "../models/VisitorDnaRecord.js";

// ── In-memory fallback ───────────────────────────────────────────────────────

interface MemVisitorDna {
  visitorDnaId: string;
  workspaceId: string;
  tenantSlug: string;
  archetype: VisitorArchetype;
  archetypeLabel: string;
  archetypeDescription: string;
  sessionCount: number;
  sampleSize: number;
  shareOfTotalSessions: number;
  avgPagesVisited: number;
  avgDwellMs: number;
  avgMaxScrollDepth: number;
  avgVisitorFrustrationScore: number;
  conversionRate: number;
  commonEntryPages: string[];
  commonExitPages: string[];
  commonPathPatterns: string[];
  confidenceScore: number;
  consistencyLevel: "low" | "medium" | "high";
  statisticalSignificance: boolean;
  estimatedConversionValue?: number;
  observedFrom: Date;
  observedTo: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const _memVisitorDna = new Map<string, MemVisitorDna>();
// workspaceId:archetype → visitorDnaId
const _archetypeIndex = new Map<string, string>();

// ── Archetype metadata ───────────────────────────────────────────────────────

const ARCHETYPE_METADATA: Record<VisitorArchetype, { label: string; description: string }> = {
  trust_seeker: {
    label: "Trust Seeker",
    description: "Visitors primarily focused on social proof, credentials, and trust signals before committing."
  },
  price_checker: {
    label: "Price Checker",
    description: "Visitors who visit pricing pages frequently and compare options before making a decision."
  },
  research_visitor: {
    label: "Research Visitor",
    description: "Deep-reading visitors exploring multiple pages with long dwell times, building knowledge."
  },
  conversion_ready: {
    label: "Conversion Ready",
    description: "High-intent visitors who navigate directly to conversion-oriented pages with minimal friction."
  },
  returning_visitor: {
    label: "Returning Visitor",
    description: "Visitors who have been seen before and demonstrate recurring intent patterns."
  },
  frustrated_visitor: {
    label: "Frustrated Visitor",
    description: "Visitors with elevated VFS scores indicating friction, confusion, or unmet expectations."
  },
  unclassified: {
    label: "Unclassified",
    description: "Visitors whose behavior does not match a known archetype pattern."
  }
};

// ── Session aggregation input ─────────────────────────────────────────────────

export interface VisitorSessionSummary {
  archetype: VisitorArchetype;
  pagesVisited: number;
  dwellMs: number;
  maxScrollDepth: number;
  visitorFrustrationScore: number;
  converted: boolean;
  entryPage?: string;
  exitPage?: string;
  pathPattern?: string;
}

// ── Build or refresh Visitor DNA profiles from session summaries ──────────────

export async function buildVisitorDnaProfiles(
  workspaceId: string,
  tenantSlug: string,
  sessions: VisitorSessionSummary[],
  windowStart: Date,
  windowEnd: Date
): Promise<Map<VisitorArchetype, MemVisitorDna | VisitorDnaRecordDocument>> {
  const grouped = new Map<VisitorArchetype, VisitorSessionSummary[]>();
  for (const s of sessions) {
    const list = grouped.get(s.archetype) ?? [];
    list.push(s);
    grouped.set(s.archetype, list);
  }

  const totalSessions = sessions.length;
  const results = new Map<VisitorArchetype, MemVisitorDna | VisitorDnaRecordDocument>();

  for (const [archetype, group] of grouped) {
    const count = group.length;
    const avgPages = avg(group.map((s) => s.pagesVisited));
    const avgDwell = avg(group.map((s) => s.dwellMs));
    const avgScroll = avg(group.map((s) => s.maxScrollDepth));
    const avgVfs = avg(group.map((s) => s.visitorFrustrationScore));
    const convRate = (group.filter((s) => s.converted).length / count) * 100;
    const share = totalSessions > 0 ? (count / totalSessions) * 100 : 0;

    const entryPages = topN(group.map((s) => s.entryPage).filter(Boolean) as string[], 5);
    const exitPages = topN(group.map((s) => s.exitPage).filter(Boolean) as string[], 5);
    const pathPatterns = topN(group.map((s) => s.pathPattern).filter(Boolean) as string[], 5);

    // Confidence: sample score (0-50) + share magnitude (0-30) + dwell consistency (0-20)
    const sampleScore = Math.min((count / 100) * 50, 50);
    const shareScore = Math.min((share / 30) * 30, 30);
    const dwellConsistency = coefficientOfVariation(group.map((s) => s.dwellMs)) < 0.3 ? 20 : 10;
    const confidenceScore = Math.round(sampleScore + shareScore + dwellConsistency);
    const statisticalSignificance = count >= 30 && confidenceScore >= 50;
    const consistencyLevel: "low" | "medium" | "high" =
      confidenceScore >= 70 ? "high" : confidenceScore >= 40 ? "medium" : "low";

    const meta = ARCHETYPE_METADATA[archetype];
    const profile: MemVisitorDna = {
      visitorDnaId: makeId("ciif_vdna"),
      workspaceId,
      tenantSlug,
      archetype,
      archetypeLabel: meta.label,
      archetypeDescription: meta.description,
      sessionCount: count,
      sampleSize: count,
      shareOfTotalSessions: Math.round(share * 10) / 10,
      avgPagesVisited: Math.round(avgPages * 10) / 10,
      avgDwellMs: Math.round(avgDwell),
      avgMaxScrollDepth: Math.round(avgScroll * 10) / 10,
      avgVisitorFrustrationScore: Math.round(avgVfs * 10) / 10,
      conversionRate: Math.round(convRate * 10) / 10,
      commonEntryPages: entryPages,
      commonExitPages: exitPages,
      commonPathPatterns: pathPatterns,
      confidenceScore,
      consistencyLevel,
      statisticalSignificance,
      observedFrom: windowStart,
      observedTo: windowEnd,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (isMongoConnected()) {
      const saved = await VisitorDnaRecord.findOneAndUpdate(
        { workspaceId, archetype },
        {
          $set: {
            ...profile,
            visitorDnaId: undefined // preserve existing ID on update
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      results.set(archetype, saved!);
    } else {
      const indexKey = `${workspaceId}:${archetype}`;
      const existingId = _archetypeIndex.get(indexKey);
      if (existingId) {
        const existing = _memVisitorDna.get(existingId);
        if (existing) {
          Object.assign(existing, profile, { visitorDnaId: existingId });
          results.set(archetype, existing);
          continue;
        }
      }
      _memVisitorDna.set(profile.visitorDnaId, profile);
      _archetypeIndex.set(indexKey, profile.visitorDnaId);
      results.set(archetype, profile);
    }
  }

  return results;
}

export async function getVisitorDnaForArchetype(
  workspaceId: string,
  archetype: VisitorArchetype
): Promise<MemVisitorDna | VisitorDnaRecordDocument | null> {
  if (isMongoConnected()) {
    return VisitorDnaRecord.findOne({ workspaceId, archetype });
  }
  const id = _archetypeIndex.get(`${workspaceId}:${archetype}`);
  return id ? (_memVisitorDna.get(id) ?? null) : null;
}

export async function listVisitorDnas(
  workspaceId: string
): Promise<Array<MemVisitorDna | VisitorDnaRecordDocument>> {
  if (isMongoConnected()) {
    return VisitorDnaRecord.find({ workspaceId }).sort({ sessionCount: -1 }).lean();
  }
  return [..._memVisitorDna.values()]
    .filter((d) => d.workspaceId === workspaceId)
    .sort((a, b) => b.sessionCount - a.sessionCount);
}

export async function getArchetypeDistributionSummary(workspaceId: string): Promise<
  Array<{
    archetype: VisitorArchetype;
    label: string;
    sessionCount: number;
    shareOfTotalSessions: number;
    conversionRate: number;
    confidenceScore: number;
    statisticalSignificance: boolean;
  }>
> {
  const records = await listVisitorDnas(workspaceId);
  return records.map((r) => ({
    archetype: (r as MemVisitorDna).archetype,
    label: (r as MemVisitorDna).archetypeLabel,
    sessionCount: (r as MemVisitorDna).sessionCount,
    shareOfTotalSessions: (r as MemVisitorDna).shareOfTotalSessions,
    conversionRate: (r as MemVisitorDna).conversionRate,
    confidenceScore: (r as MemVisitorDna).confidenceScore,
    statisticalSignificance: (r as MemVisitorDna).statisticalSignificance
  }));
}

// ── Math helpers ─────────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = avg(values);
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function topN(values: string[], n: number): string[] {
  const freq = new Map<string, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([v]) => v);
}
