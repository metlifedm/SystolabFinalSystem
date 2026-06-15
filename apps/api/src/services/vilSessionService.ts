import { isMongoConnected } from "../db/mongoose.js";
import { makeId } from "../utils/crypto.js";
import { DeviceType, SessionStatus, VisitorSession, VisitorSessionDocument } from "../models/VisitorSession.js";

export interface CreateSessionInput {
  workspaceId: string;
  tenantSlug: string;
  visitorId?: string;
  consentId?: string;
  consentVersion?: string;
  deviceType?: DeviceType;
  browserName?: string;
  browserVersion?: string;
  os?: string;
  screenWidth?: number;
  screenHeight?: number;
  country?: string;
  region?: string;
  city?: string;
  landingPage: string;
  referralSource?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}

export type MemSession = {
  sessionId: string;
  workspaceId: string;
  tenantSlug: string;
  visitorId: string;
  consentId?: string;
  consentVersion?: string;
  startedAt: Date;
  lastSeenAt: Date;
  endedAt?: Date;
  deviceType: DeviceType;
  browserName: string;
  browserVersion: string;
  os: string;
  screenWidth: number;
  screenHeight: number;
  country: string;
  region?: string;
  city?: string;
  landingPage: string;
  referralSource?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  pagesVisited: string[];
  journeyFingerprintId?: string;
  visitorFrustrationScore?: number;
  engagementScore?: number;
  visitorArchetype?: string;
  status: SessionStatus;
};

export const _memVisitorSessions = new Map<string, MemSession>();

export async function createVisitorSession(
  input: CreateSessionInput
): Promise<{ session: MemSession | VisitorSessionDocument }> {
  const sessionId = makeId("vil_ses");
  const visitorId = input.visitorId ?? makeId("vil_vis");
  const now = new Date();

  const data: MemSession = {
    sessionId,
    workspaceId: input.workspaceId,
    tenantSlug: input.tenantSlug,
    visitorId,
    consentId: input.consentId,
    consentVersion: input.consentVersion,
    startedAt: now,
    lastSeenAt: now,
    deviceType: input.deviceType ?? "desktop",
    browserName: input.browserName ?? "unknown",
    browserVersion: input.browserVersion ?? "unknown",
    os: input.os ?? "unknown",
    screenWidth: input.screenWidth ?? 0,
    screenHeight: input.screenHeight ?? 0,
    country: input.country ?? "unknown",
    region: input.region,
    city: input.city,
    landingPage: input.landingPage,
    referralSource: input.referralSource,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    utmContent: input.utmContent,
    utmTerm: input.utmTerm,
    pagesVisited: [input.landingPage],
    status: "active"
  };

  if (!isMongoConnected()) {
    _memVisitorSessions.set(sessionId, data);
    return { session: data };
  }

  const session = await VisitorSession.create(data);
  return { session };
}

export async function updateVisitorSession(
  sessionId: string,
  updates: Partial<
    Pick<
      MemSession,
      | "lastSeenAt"
      | "pagesVisited"
      | "journeyFingerprintId"
      | "visitorFrustrationScore"
      | "engagementScore"
      | "visitorArchetype"
      | "status"
      | "endedAt"
    >
  >
): Promise<void> {
  if (!isMongoConnected()) {
    const mem = _memVisitorSessions.get(sessionId);
    if (mem) Object.assign(mem, updates);
    return;
  }
  await VisitorSession.updateOne({ sessionId }, { $set: updates });
}

export async function addPageToSession(sessionId: string, page: string): Promise<void> {
  const now = new Date();
  if (!isMongoConnected()) {
    const mem = _memVisitorSessions.get(sessionId);
    if (mem) {
      if (!mem.pagesVisited.includes(page)) mem.pagesVisited.push(page);
      mem.lastSeenAt = now;
    }
    return;
  }
  await VisitorSession.updateOne(
    { sessionId },
    { $addToSet: { pagesVisited: page }, $set: { lastSeenAt: now } }
  );
}

export async function endVisitorSession(sessionId: string): Promise<void> {
  await updateVisitorSession(sessionId, { status: "ended", endedAt: new Date() });
}

export async function getVisitorSession(
  sessionId: string
): Promise<MemSession | VisitorSessionDocument | null> {
  if (!isMongoConnected()) {
    return _memVisitorSessions.get(sessionId) ?? null;
  }
  return VisitorSession.findOne({ sessionId }).lean();
}

export async function listSessionsForWorkspace(
  workspaceId: string,
  opts: { status?: SessionStatus; limit?: number; skip?: number } = {}
): Promise<{ sessions: (MemSession | VisitorSessionDocument)[]; total: number }> {
  const limit = opts.limit ?? 50;
  const skip = opts.skip ?? 0;

  if (!isMongoConnected()) {
    const all = [..._memVisitorSessions.values()].filter(
      (s) => s.workspaceId === workspaceId && (!opts.status || s.status === opts.status)
    );
    return { sessions: all.slice(skip, skip + limit), total: all.length };
  }

  const query: Record<string, unknown> = { workspaceId };
  if (opts.status) query["status"] = opts.status;
  const [sessions, total] = await Promise.all([
    VisitorSession.find(query).sort({ startedAt: -1 }).skip(skip).limit(limit).lean(),
    VisitorSession.countDocuments(query)
  ]);
  return { sessions, total };
}

export async function expireOldSessions(maxIdleMs = 30 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxIdleMs);

  if (!isMongoConnected()) {
    let count = 0;
    for (const s of _memVisitorSessions.values()) {
      if (s.status === "active" && s.lastSeenAt < cutoff) {
        s.status = "expired";
        count++;
      }
    }
    return count;
  }

  const result = await VisitorSession.updateMany(
    { status: "active", lastSeenAt: { $lt: cutoff } },
    { $set: { status: "expired" } }
  );
  return result.modifiedCount;
}

export async function getSessionsReadyForJourneyReconstruction(): Promise<string[]> {
  if (!isMongoConnected()) {
    return [..._memVisitorSessions.values()]
      .filter((s) => (s.status === "ended" || s.status === "expired") && !s.journeyFingerprintId)
      .map((s) => s.sessionId);
  }

  const docs = await VisitorSession.find(
    { status: { $in: ["ended", "expired"] }, journeyFingerprintId: { $exists: false } },
    { sessionId: 1, _id: 0 }
  )
    .limit(50)
    .lean();
  return docs.map((d) => d.sessionId);
}
