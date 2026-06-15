import type { NextFunction, Request, Response } from "express";
import type { TenantMembershipDocument, TenantRole } from "../models/TenantMembership.js";
import type { WorkspaceMembershipDocument, WorkspaceRole } from "../models/WorkspaceMembership.js";
import {
  getTenantBySlug,
  getTenantMembershipBySlug,
  getWorkspace,
  getWorkspaceMembership
} from "../services/membershipService.js";

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  role: TenantRole;
  membership: TenantMembershipDocument;
}

export interface WorkspaceContext {
  workspaceId: string;
  tenantId: string;
  tenantSlug: string;
  role: WorkspaceRole;
  membership: WorkspaceMembershipDocument;
}

declare global {
  namespace Express {
    interface Request {
      tenantCtx?: TenantContext;
      workspaceCtx?: WorkspaceContext;
    }
  }
}

export function requireTenantMember(roles?: TenantRole[]): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next) => {
    try {
      if (!req.auth?.user) {
        res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } });
        return;
      }
      const slug = req.params["slug"] ?? req.params["tenantSlug"];
      if (!slug) {
        res.status(400).json({ error: { code: "MISSING_PARAM", message: "Tenant slug is required." } });
        return;
      }
      const tenant = await getTenantBySlug(slug);
      if (!tenant) {
        res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Tenant not found." } });
        return;
      }
      const membership = await getTenantMembershipBySlug(req.auth.user.userId, slug);
      if (!membership) {
        res.status(403).json({ error: { code: "NOT_TENANT_MEMBER", message: "You are not a member of this tenant." } });
        return;
      }
      if (roles && roles.length > 0 && !roles.includes(membership.role)) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_TENANT_ROLE",
            message: `This action requires one of the following roles: ${roles.join(", ")}.`
          }
        });
        return;
      }
      req.tenantCtx = {
        tenantId: String(tenant._id),
        tenantSlug: tenant.slug,
        role: membership.role,
        membership
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireWorkspaceMember(roles?: WorkspaceRole[]): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next) => {
    try {
      if (!req.auth?.user) {
        res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } });
        return;
      }
      const workspaceId = req.params["workspaceId"];
      if (!workspaceId) {
        res.status(400).json({ error: { code: "MISSING_PARAM", message: "workspaceId is required." } });
        return;
      }
      const workspace = await getWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found." } });
        return;
      }
      const membership = await getWorkspaceMembership(req.auth.user.userId, workspaceId);
      if (!membership) {
        res.status(403).json({ error: { code: "NOT_WORKSPACE_MEMBER", message: "You are not a member of this workspace." } });
        return;
      }
      if (roles && roles.length > 0 && !roles.includes(membership.role)) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_WORKSPACE_ROLE",
            message: `This action requires one of the following roles: ${roles.join(", ")}.`
          }
        });
        return;
      }
      req.workspaceCtx = {
        workspaceId: workspace.workspaceId,
        tenantId: String(membership.tenantId),
        tenantSlug: membership.tenantSlug,
        role: membership.role,
        membership
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
