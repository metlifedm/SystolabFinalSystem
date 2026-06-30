import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>;

export function asyncHandler(handler: AsyncRoute): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
