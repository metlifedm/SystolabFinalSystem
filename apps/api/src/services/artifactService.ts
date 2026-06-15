import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { isMongoConnected } from "../db/mongoose.js";
import { Artifact, type ArtifactDocument, type ArtifactType } from "../models/Artifact.js";
import { makeId } from "../utils/crypto.js";

interface MemoryArtifactDoc {
  artifactId: string;
  snapshotId?: string;
  workspaceId?: string;
  pageUrl: string;
  artifactType: ArtifactType;
  mimeType: "image/png";
  sizeBytes: number;
  filePath?: string;
  createdAt: Date;
}

const memoryArtifacts = new Map<string, { doc: MemoryArtifactDoc; buffer: Buffer }>();

export interface SavedArtifact {
  artifactId: string;
  signedUrl: string;
  sizeBytes: number;
}

export async function saveArtifact(
  buffer: Buffer,
  meta: { pageUrl: string; artifactType: ArtifactType; snapshotId?: string; workspaceId?: string }
): Promise<SavedArtifact> {
  const artifactId = makeId("art");
  const sizeBytes = buffer.byteLength;

  if (!isMongoConnected() && !env.artifactDir) {
    memoryArtifacts.set(artifactId, {
      doc: { artifactId, ...meta, mimeType: "image/png", sizeBytes, createdAt: new Date() },
      buffer
    });
    return { artifactId, signedUrl: buildSignedUrl(artifactId), sizeBytes };
  }

  if (env.artifactDir) {
    await fs.mkdir(env.artifactDir, { recursive: true });
    const filePath = path.join(env.artifactDir, `${artifactId}.png`);
    await fs.writeFile(filePath, buffer);
    if (isMongoConnected()) {
      await Artifact.create({ artifactId, ...meta, mimeType: "image/png", sizeBytes, filePath });
    } else {
      memoryArtifacts.set(artifactId, { doc: { artifactId, ...meta, mimeType: "image/png", sizeBytes, filePath, createdAt: new Date() }, buffer });
    }
  } else {
    const data = buffer.toString("base64");
    await Artifact.create({ artifactId, ...meta, mimeType: "image/png", sizeBytes, data });
  }

  return { artifactId, signedUrl: buildSignedUrl(artifactId), sizeBytes };
}

export async function resolveArtifactBuffer(artifactId: string): Promise<Buffer | null> {
  const mem = memoryArtifacts.get(artifactId);
  if (mem) return mem.buffer;

  if (!isMongoConnected()) return null;
  const doc = await Artifact.findOne({ artifactId });
  if (!doc) return null;

  if (doc.filePath) {
    try {
      return await fs.readFile(doc.filePath);
    } catch {
      return null;
    }
  }
  if (doc.data) return Buffer.from(doc.data, "base64");
  return null;
}

export async function getArtifactMeta(artifactId: string): Promise<ArtifactDocument | null> {
  if (!isMongoConnected()) {
    const mem = memoryArtifacts.get(artifactId);
    return mem ? (mem.doc as unknown as ArtifactDocument) : null;
  }
  return Artifact.findOne({ artifactId });
}

export async function listArtifactsForSnapshot(snapshotId: string): Promise<ArtifactDocument[]> {
  if (!isMongoConnected()) {
    return [...memoryArtifacts.values()]
      .filter((a) => a.doc.snapshotId === snapshotId)
      .map((a) => a.doc as unknown as ArtifactDocument);
  }
  return Artifact.find({ snapshotId }).sort({ createdAt: -1 });
}

// ── Signed tokens ──────────────────────────────────────────────────────────────

export function buildSignedUrl(artifactId: string): string {
  const expires = Date.now() + env.artifactSignedTokenTtlMs;
  const token = signArtifact(artifactId, expires);
  return `/api/artifacts/${artifactId}?token=${token}&expires=${expires}`;
}

export function signArtifact(artifactId: string, expiresAt: number): string {
  const secret = env.artifactSecret || "systolab-artifact-dev-secret";
  return createHmac("sha256", secret).update(`${artifactId}:${expiresAt}`).digest("hex");
}

export function verifyArtifactToken(artifactId: string, token: string, expiresAt: number): boolean {
  if (Date.now() > expiresAt) return false;
  const expected = signArtifact(artifactId, expiresAt);
  if (expected.length !== token.length) return false;
  // Timing-safe comparison
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export { randomBytes };
