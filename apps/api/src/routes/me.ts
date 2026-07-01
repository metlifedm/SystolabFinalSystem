import { Router } from "express";
import { authRequired } from "../middleware/authRequired.js";
import { getPortalMe } from "../services/portalService.js";

export const meRouter = Router();

meRouter.get("/", authRequired, async (req, res, next) => {
  try {
    res.json(await getPortalMe(req.auth!.user));
  } catch (error) {
    next(error);
  }
});
