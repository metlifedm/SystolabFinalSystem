import { Router, type Request, type Response } from "express";
import { resolveArtifactBuffer, verifyArtifactToken } from "../services/artifactService.js";

const router = Router();

// GET /api/artifacts/:artifactId?token=TOKEN&expires=EPOCH
router.get("/:artifactId", async (req: Request, res: Response): Promise<void> => {
  const { artifactId } = req.params;
  const { token, expires } = req.query as Record<string, string | undefined>;

  if (!artifactId) {
    res.status(400).json({ code: "MISSING_ARTIFACT_ID", message: "artifactId is required." });
    return;
  }

  if (!token || !expires) {
    res.status(401).json({ code: "MISSING_TOKEN", message: "Artifact access requires a signed token." });
    return;
  }

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt)) {
    res.status(400).json({ code: "INVALID_EXPIRES", message: "expires must be a numeric epoch milliseconds value." });
    return;
  }

  if (!verifyArtifactToken(artifactId, token, expiresAt)) {
    res.status(403).json({ code: "TOKEN_INVALID_OR_EXPIRED", message: "The artifact token is invalid or has expired." });
    return;
  }

  const buffer = await resolveArtifactBuffer(artifactId);
  if (!buffer) {
    res.status(404).json({ code: "ARTIFACT_NOT_FOUND", message: "Artifact not found." });
    return;
  }

  res.set("Content-Type", "image/png");
  res.set("Content-Length", String(buffer.byteLength));
  res.set("Cache-Control", "private, max-age=3600");
  res.set("X-Content-Type-Options", "nosniff");
  res.send(buffer);
});

export default router;
