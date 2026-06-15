import { isMongoConnected } from "../db/mongoose.js";
import { makeId, sha256 } from "../utils/crypto.js";
import { JourneyFingerprint, JourneyFingerprintDocument, JourneyStep } from "../models/JourneyFingerprint.js";
import { getEventsForSession } from "./vilEventService.js";
import { getVisitorSession, updateVisitorSession } from "./vilSessionService.js";

export type MemJourneyFingerprint = {
  fingerprintId: string;
  sessionId: string;
  workspaceId: string;
  tenantSlug: string;
  path: JourneyStep[];
  entryPage: string;
  exitPage?: string;
  totalPages: number;
  totalDurationMs: number;
  conversionOccurred: boolean;
  abandonmentPage?: string;
  patternHash: string;
  archetypeMatch?: string;
};

export const _memJourneyFingerprints = new Map<string, MemJourneyFingerprint>();
const _sessionFingerprintIndex = new Map<string, string>();

export async function reconstructJourney(
  sessionId: string
): Promise<{ fingerprint: MemJourneyFingerprint | JourneyFingerprintDocument }> {
  const session = await getVisitorSession(sessionId);
  if (!session) throw new Error(`VIL session not found: ${sessionId}`);

  const events = await getEventsForSession(sessionId);
  const sess = session as Record<string, unknown>;
  const pagesVisited = (sess["pagesVisited"] as string[]) ?? [];

  // Build per-page step data from events
  const pageSteps = new Map<string, JourneyStep>();
  for (const pg of pagesVisited) {
    if (!pageSteps.has(pg)) {
      pageSteps.set(pg, {
        page: pg,
        enteredAt: sess["startedAt"] as Date,
        dwellMs: 0,
        maxScrollDepth: 0,
        eventCount: 0
      });
    }
  }

  for (const evt of events) {
    const e = evt as Record<string, unknown>;
    const step = pageSteps.get(e["page"] as string);
    if (!step) continue;
    step.eventCount++;

    if (e["eventType"] === "scroll_depth") {
      const depth = ((e["data"] as Record<string, unknown>)?.["depth"] as number) ?? 0;
      if (depth > step.maxScrollDepth) step.maxScrollDepth = depth;
    }
    if (e["eventType"] === "page_exit") {
      const dwellMs = ((e["data"] as Record<string, unknown>)?.["dwellMs"] as number) ?? 0;
      step.dwellMs = dwellMs;
      step.exitedAt = e["timestamp"] as Date;
    }
  }

  const path: JourneyStep[] = pagesVisited
    .map((pg) => pageSteps.get(pg))
    .filter((s): s is JourneyStep => s !== undefined);

  const patternHash = sha256(pagesVisited.join("→") || "/");
  const entryPage = pagesVisited[0] ?? "/";
  const exitPage = pagesVisited[pagesVisited.length - 1];
  const totalDurationMs = path.reduce((sum, s) => sum + s.dwellMs, 0);
  const totalPages = pagesVisited.length;

  const fingerprintId = makeId("vil_jfp");
  const data: MemJourneyFingerprint = {
    fingerprintId,
    sessionId,
    workspaceId: sess["workspaceId"] as string,
    tenantSlug: sess["tenantSlug"] as string,
    path,
    entryPage,
    exitPage,
    totalPages,
    totalDurationMs,
    conversionOccurred: false,
    patternHash,
    archetypeMatch: classifyArchetype(pagesVisited) ?? undefined
  };

  if (!isMongoConnected()) {
    _memJourneyFingerprints.set(fingerprintId, data);
    _sessionFingerprintIndex.set(sessionId, fingerprintId);
    await updateVisitorSession(sessionId, {
      journeyFingerprintId: fingerprintId,
      visitorArchetype: data.archetypeMatch
    });
    return { fingerprint: data };
  }

  const fingerprint = await JourneyFingerprint.create(data);
  await updateVisitorSession(sessionId, {
    journeyFingerprintId: fingerprintId,
    visitorArchetype: data.archetypeMatch
  });
  return { fingerprint };
}

export async function getJourneyForSession(
  sessionId: string
): Promise<MemJourneyFingerprint | JourneyFingerprintDocument | null> {
  if (!isMongoConnected()) {
    const fpId = _sessionFingerprintIndex.get(sessionId);
    return fpId ? (_memJourneyFingerprints.get(fpId) ?? null) : null;
  }
  return JourneyFingerprint.findOne({ sessionId }).lean();
}

export async function listJourneysForWorkspace(
  workspaceId: string,
  opts: { limit?: number; skip?: number; archetypeMatch?: string } = {}
): Promise<{ fingerprints: (MemJourneyFingerprint | JourneyFingerprintDocument)[]; total: number }> {
  const limit = opts.limit ?? 50;
  const skip = opts.skip ?? 0;

  if (!isMongoConnected()) {
    const all = [..._memJourneyFingerprints.values()].filter(
      (f) => f.workspaceId === workspaceId && (!opts.archetypeMatch || f.archetypeMatch === opts.archetypeMatch)
    );
    return { fingerprints: all.slice(skip, skip + limit), total: all.length };
  }

  const query: Record<string, unknown> = { workspaceId };
  if (opts.archetypeMatch) query["archetypeMatch"] = opts.archetypeMatch;
  const [fingerprints, total] = await Promise.all([
    JourneyFingerprint.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    JourneyFingerprint.countDocuments(query)
  ]);
  return { fingerprints, total };
}

export async function getArchetypeDistribution(
  workspaceId: string
): Promise<Record<string, number>> {
  if (!isMongoConnected()) {
    const counts: Record<string, number> = {};
    for (const f of _memJourneyFingerprints.values()) {
      if (f.workspaceId !== workspaceId) continue;
      const key = f.archetypeMatch ?? "unclassified";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  const pipeline = [
    { $match: { workspaceId } },
    { $group: { _id: { $ifNull: ["$archetypeMatch", "unclassified"] }, count: { $sum: 1 } } }
  ];
  const results = await JourneyFingerprint.aggregate(pipeline);
  return Object.fromEntries(results.map((r: { _id: string; count: number }) => [r._id, r.count]));
}

// Deferred: full Visitor DNA Framework clustering. This initial version uses rule-based matching.
// Future activation: replace with ML-based clustering over patternHash distributions.
function classifyArchetype(pages: string[]): string | null {
  const lower = pages.map((p) => p.toLowerCase());
  const has = (keywords: string[]) => lower.some((p) => keywords.some((k) => p.includes(k)));

  if (has(["pric", "plan", "billing"]) && pages.length <= 3) return "price_checker";
  if (has(["review", "testimon", "case-study", "trust"])) return "trust_seeker";
  if (has(["blog", "article", "guide", "resource"]) && !has(["contact", "demo", "trial"])) return "research_visitor";
  if (has(["contact", "demo", "trial", "signup"]) && pages.length <= 5) return "conversion_ready";
  if (has(["rage", "error", "404", "search"]) || pages.length > 10) return "frustrated_visitor";
  return null;
}
