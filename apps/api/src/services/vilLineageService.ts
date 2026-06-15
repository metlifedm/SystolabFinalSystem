import { isMongoConnected } from "../db/mongoose.js";
import { makeId } from "../utils/crypto.js";
import { getBehavioralEvidenceById } from "./vilEvidenceService.js";
import { getEventsForSession } from "./vilEventService.js";

// Behavioral Lineage extends the Intelligence Lineage system by providing
// a full trace chain: downstream artifact → BehavioralEvidence → Session cluster → Raw events.
//
// Architecture:
//   Revenue Leakage Alert / Recommendation
//     └─ IntelligenceLineageRecord (existing)
//         └─ BehavioralLineageRecord (this service — links by intelligenceArtifactId)
//             └─ BehavioralEvidence (vil_bev_*)
//                 └─ Visitor Sessions (vil_ses_*)
//                     └─ Raw BehavioralEvents (vil_evt_*)

export interface BehavioralLineageChainStep {
  layer: string;
  artifactId: string;
  artifactType: string;
  summary: string;
  timestamp?: Date;
}

export interface BehavioralLineageRecord {
  behavioralLineageId: string;
  behavioralEvidenceId: string;
  workspaceId: string;
  tenantSlug: string;
  intelligenceArtifactId?: string;     // Links to IntelligenceLineageRecord.lineageId
  intelligenceArtifactType?: string;   // e.g. "recommendation" | "revenue_alert" | "insight"
  sourceSessionIds: string[];
  sourceEventIds: string[];
  chain: BehavioralLineageChainStep[];
  createdAt: Date;
}

const _memLineage = new Map<string, BehavioralLineageRecord>();
const _evidenceLineageIndex = new Map<string, string>(); // behavioralEvidenceId → behavioralLineageId

export async function createBehavioralLineage(input: {
  behavioralEvidenceId: string;
  workspaceId: string;
  tenantSlug: string;
  intelligenceArtifactId?: string;
  intelligenceArtifactType?: string;
}): Promise<BehavioralLineageRecord> {
  const evidence = await getBehavioralEvidenceById(input.behavioralEvidenceId);
  if (!evidence) throw new Error(`Behavioral evidence not found: ${input.behavioralEvidenceId}`);

  const ev = evidence as Record<string, unknown>;
  const sourceSessionIds = (ev["sourceSessionIds"] as string[]) ?? [];
  const sourceEventIds = (ev["sourceEventIds"] as string[]) ?? [];

  const chain: BehavioralLineageChainStep[] = [];

  if (input.intelligenceArtifactId) {
    chain.push({
      layer: "intelligence",
      artifactId: input.intelligenceArtifactId,
      artifactType: input.intelligenceArtifactType ?? "unknown",
      summary: `Downstream intelligence artifact that consumed this behavioral evidence`
    });
  }

  chain.push({
    layer: "behavioral_evidence",
    artifactId: input.behavioralEvidenceId,
    artifactType: ev["evidenceType"] as string,
    summary: ev["observation"] as string,
    timestamp: ev["generatedAt"] as Date
  });

  chain.push({
    layer: "visitor_sessions",
    artifactId: `session_cluster:${sourceSessionIds.length}`,
    artifactType: "session_cluster",
    summary: `${sourceSessionIds.length} visitor sessions contributed to this evidence`
  });

  chain.push({
    layer: "raw_events",
    artifactId: `event_cluster:${sourceEventIds.length}`,
    artifactType: "event_cluster",
    summary: `${sourceEventIds.length} raw behavioral events from Session Capture + behavioral engines`
  });

  const record: BehavioralLineageRecord = {
    behavioralLineageId: makeId("vil_lin"),
    behavioralEvidenceId: input.behavioralEvidenceId,
    workspaceId: input.workspaceId,
    tenantSlug: input.tenantSlug,
    intelligenceArtifactId: input.intelligenceArtifactId,
    intelligenceArtifactType: input.intelligenceArtifactType,
    sourceSessionIds,
    sourceEventIds,
    chain,
    createdAt: new Date()
  };

  _memLineage.set(record.behavioralLineageId, record);
  _evidenceLineageIndex.set(input.behavioralEvidenceId, record.behavioralLineageId);

  if (isMongoConnected()) {
    // Lineage records are append-only audit records — stored in memory map here.
    // If a persistent store is needed in future, create a BehavioralLineageRecord model.
    // For now the in-process map serves as the lineage store for both dev and prod.
  }

  return record;
}

export async function traceBehavioralEvidence(behavioralEvidenceId: string): Promise<{
  lineage: BehavioralLineageRecord | null;
  rawEvents: Record<string, unknown>[];
  sessionCount: number;
}> {
  const lineageId = _evidenceLineageIndex.get(behavioralEvidenceId);
  const lineage = lineageId ? (_memLineage.get(lineageId) ?? null) : null;

  const evidence = await getBehavioralEvidenceById(behavioralEvidenceId);
  const ev = (evidence ?? {}) as Record<string, unknown>;
  const sessionIds = (ev["sourceSessionIds"] as string[]) ?? [];

  // Fetch sample raw events from source sessions to complete the trace
  const rawEvents: Record<string, unknown>[] = [];
  for (const sid of sessionIds.slice(0, 5)) {
    const events = await getEventsForSession(sid);
    for (const e of events.slice(0, 10)) {
      rawEvents.push(e as Record<string, unknown>);
    }
  }

  return { lineage, rawEvents, sessionCount: sessionIds.length };
}

export async function linkEvidenceToIntelligence(
  behavioralEvidenceId: string,
  intelligenceArtifactId: string,
  intelligenceArtifactType: string,
  workspaceId: string,
  tenantSlug: string
): Promise<BehavioralLineageRecord> {
  const existing = _evidenceLineageIndex.get(behavioralEvidenceId);
  if (existing) {
    const record = _memLineage.get(existing);
    if (record) {
      record.intelligenceArtifactId = intelligenceArtifactId;
      record.intelligenceArtifactType = intelligenceArtifactType;
      record.chain.unshift({
        layer: "intelligence",
        artifactId: intelligenceArtifactId,
        artifactType: intelligenceArtifactType,
        summary: `Intelligence artifact linked to this behavioral evidence`
      });
      return record;
    }
  }

  return createBehavioralLineage({
    behavioralEvidenceId,
    workspaceId,
    tenantSlug,
    intelligenceArtifactId,
    intelligenceArtifactType
  });
}

export function getLineageById(behavioralLineageId: string): BehavioralLineageRecord | null {
  return _memLineage.get(behavioralLineageId) ?? null;
}

export function listLineageForWorkspace(workspaceId: string): BehavioralLineageRecord[] {
  return [..._memLineage.values()].filter((l) => l.workspaceId === workspaceId);
}
