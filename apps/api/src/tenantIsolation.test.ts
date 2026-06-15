import { describe, expect, it } from "vitest";
import { makeId } from "./utils/crypto.js";
import {
  addTenantMember,
  createTenant,
  createWebhook,
  createWorkspace,
  getWorkspace,
  getWorkspaceMembership,
  listWebhooks
} from "./services/membershipService.js";
import { listClientWorkspaces } from "./services/agencyService.js";

function uniqueSlug(prefix: string) {
  return `${prefix}-${makeId("t").slice(2, 10)}`;
}

describe("tenant isolation", () => {
  it("workspaces created in tenant A are not visible in tenant B's agency dashboard", async () => {
    const slugA = uniqueSlug("iso-a");
    const slugB = uniqueSlug("iso-b");
    const userIdA = makeId("usr");
    const userIdB = makeId("usr");

    const { tenant: tenantA } = await createTenant(slugA, "Tenant A", userIdA);
    const { tenant: tenantB } = await createTenant(slugB, "Tenant B", userIdB);

    // Create two workspaces in tenant A, one in tenant B
    await createWorkspace(tenantA._id, slugA, userIdA, "https://tenant-a.example.com/site1");
    await createWorkspace(tenantA._id, slugA, userIdA, "https://tenant-a.example.com/site2");
    await createWorkspace(tenantB._id, slugB, userIdB, "https://tenant-b.example.com/site1");

    const wsA = await listClientWorkspaces(slugA);
    const wsB = await listClientWorkspaces(slugB);

    expect(wsA.every((w) => w.tenantSlug === slugA)).toBe(true);
    expect(wsB.every((w) => w.tenantSlug === slugB)).toBe(true);
    expect(wsA.some((w) => w.tenantSlug === slugB)).toBe(false);
    expect(wsB.some((w) => w.tenantSlug === slugA)).toBe(false);
  });

  it("workspace membership check returns null when userId belongs to a different tenant", async () => {
    const slugA = uniqueSlug("wmiso-a");
    const slugB = uniqueSlug("wmiso-b");
    const userA = makeId("usr");
    const userB = makeId("usr");

    const { tenant: tA } = await createTenant(slugA, "WM Tenant A", userA);
    await createTenant(slugB, "WM Tenant B", userB);

    const { workspace } = await createWorkspace(tA._id, slugA, userA, "https://workspace-iso.example.com");

    // userB (from tenant B) should have no membership in tenant A's workspace
    const membership = await getWorkspaceMembership(userB, workspace.workspaceId);
    expect(membership).toBeNull();
  });

  it("webhooks from tenant A are not retrievable by querying tenant B's webhooks", async () => {
    const slugA = uniqueSlug("wh-iso-a");
    const slugB = uniqueSlug("wh-iso-b");
    const userA = makeId("usr");
    const userB = makeId("usr");

    const { tenant: tA } = await createTenant(slugA, "WH Tenant A", userA);
    const { tenant: tB } = await createTenant(slugB, "WH Tenant B", userB);

    await createWebhook(tA._id, slugA, "https://hooks.example.com/a", ["scan.completed"], userA);
    await createWebhook(tB._id, slugB, "https://hooks.example.com/b", ["scan.completed"], userB);

    const hooksA = await listWebhooks(tA._id);
    const hooksB = await listWebhooks(tB._id);

    expect(hooksA.every((h) => h.tenantSlug === slugA)).toBe(true);
    expect(hooksB.every((h) => h.tenantSlug === slugB)).toBe(true);
    expect(hooksA.length).toBe(1);
    expect(hooksB.length).toBe(1);
  });

  it("adding a member to tenant A does not grant them membership in tenant B", async () => {
    const slugA = uniqueSlug("mem-iso-a");
    const slugB = uniqueSlug("mem-iso-b");
    const owner = makeId("usr");
    const guest = makeId("usr");

    const { tenant: tA } = await createTenant(slugA, "Mem Tenant A", owner);
    const { tenant: tB } = await createTenant(slugB, "Mem Tenant B", owner);

    // Add guest to tenant A only
    await addTenantMember(tA._id, slugA, guest, "member");

    // listTenantMembers for B should not include the guest
    const { _findTenantMembershipInMemory } = await import("./services/membershipService.js");
    const membershipInB = _findTenantMembershipInMemory(guest, tB._id.toString());
    expect(membershipInB).toBeNull();
  });

  it("getWorkspace by workspaceId does not enforce tenant scope — service caller must scope queries", async () => {
    const slug = uniqueSlug("ws-raw");
    const user = makeId("usr");
    const { tenant } = await createTenant(slug, "Raw WS Tenant", user);
    const { workspace } = await createWorkspace(tenant._id, slug, user, "https://raw-ws.example.com");

    // getWorkspace itself is an unscoped lookup by ID — caller must enforce tenant context
    const found = await getWorkspace(workspace.workspaceId);
    expect(found?.workspaceId).toBe(workspace.workspaceId);
    // The scoping is enforced at the route/middleware layer via requireTenantMember + tenantCtx
  });
});
