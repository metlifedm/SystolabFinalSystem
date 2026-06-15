import { Router } from "express";
import { authRequired } from "../middleware/authRequired.js";
import {
  buildAuthContext,
  forgotPassword,
  googleLogin,
  listSessions,
  logout,
  passwordLogin,
  refreshSession,
  registerPassword,
  requestOtp,
  resetPassword,
  revokeSession,
  verifyOtp
} from "../services/authService.js";

export const authRouter = Router();

authRouter.post("/google", async (req, res, next) => {
  try {
    const context = buildAuthContext(req, req.body?.deviceId, req.body?.deviceLabel);
    res.json(await googleLogin(req.body, context));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/otp/request", async (req, res, next) => {
  try {
    const context = buildAuthContext(req, req.body?.deviceId);
    res.json(await requestOtp(req.body, context));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/otp/verify", async (req, res, next) => {
  try {
    const context = buildAuthContext(req, req.body?.deviceId, req.body?.deviceLabel);
    res.json(await verifyOtp(req.body, context));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/password/register", async (req, res, next) => {
  try {
    const context = buildAuthContext(req, req.body?.deviceId);
    res.status(201).json(await registerPassword(req.body, context));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/password/login", async (req, res, next) => {
  try {
    const context = buildAuthContext(req, req.body?.deviceId, req.body?.deviceLabel);
    res.json(await passwordLogin(req.body, context));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/password/forgot", async (req, res, next) => {
  try {
    const context = buildAuthContext(req, req.body?.deviceId);
    res.json(await forgotPassword(req.body, context));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/password/reset", async (req, res, next) => {
  try {
    const context = buildAuthContext(req, req.body?.deviceId);
    res.json(await resetPassword(req.body, context));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const context = buildAuthContext(req, req.body?.deviceId);
    res.json(await refreshSession(req.body, context));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", authRequired, async (req, res, next) => {
  try {
    const context = buildAuthContext(req);
    res.json(await logout(req.body, context, req.auth?.user.userId));
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", authRequired, (req, res) => {
  res.json(req.auth);
});

authRouter.get("/sessions", authRequired, async (req, res, next) => {
  try {
    res.json({ sessions: await listSessions(req.auth!.user.userId) });
  } catch (error) {
    next(error);
  }
});

authRouter.delete("/sessions/:sessionId", authRequired, async (req, res, next) => {
  try {
    const context = buildAuthContext(req);
    const sessionId = req.params.sessionId;
    if (!sessionId) throw new Error("sessionId is required.");
    res.json(await revokeSession(req.auth!.user.userId, sessionId, context));
  } catch (error) {
    next(error);
  }
});
