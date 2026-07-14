import { describe, expect, it } from "vitest";
import { makeId, sha256 } from "./utils/crypto.js";
import {
  AdminAuthError,
  adminOwnerExists,
  bootstrapOwner,
  createAdminUser,
  deactivateAdminUser,
  getAdminAuthStorageMode,
  listAdminSessions,
  listAdminUsers,
  loginAdmin,
  logoutAdmin,
  verifyAdminToken
} from "./services/adminAuthService.js";
import { AdminSession } from "./models/AdminSession.js";

const TEST_IP = sha256("test-admin-ip");
const TEST_UA = "vitest/admin";

async function createAdmin(email: string, password: string, role: "owner" | "manager" | "viewer" = "viewer") {
  // Bootstrap an owner first so we have admin context
  const owner = await bootstrapOwner("OwnerPassword!Secure123").catch(() => null);
  if (role === "owner") return owner!;
  return createAdminUser(email, password, role);
}

describe("admin auth — login and session", () => {
  it("bootstrapOwner creates the owner admin user", async () => {
    const owner = await bootstrapOwner("OwnerPassword!Secure123");
    expect(owner.role).toBe("owner");
    expect(owner.isActive).toBe(true);
  });

  it("rejects an invalid first-owner bootstrap key even when an owner already exists", async () => {
    await bootstrapOwner("OwnerPassword!Secure123");
    await expect(
      bootstrapOwner("InvalidOwnerKey!123", "other-owner@systolab.local", "OtherOwner!Secure123")
    ).rejects.toMatchObject({ status: 403 });
  });

  it("reports volatile storage during isolated tests", () => {
    expect(getAdminAuthStorageMode()).toBe("memory");
  });

  it("adminOwnerExists reports active owner availability", async () => {
    await bootstrapOwner("OwnerPassword!Secure123");
    await expect(adminOwnerExists()).resolves.toBe(true);
  });

  it("bootstrapOwner is idempotent — calling twice returns the existing owner", async () => {
    const a = await bootstrapOwner("OwnerPassword!Secure123");
    const b = await bootstrapOwner("OwnerPassword!Secure123");
    expect(a._id.toString()).toBe(b._id.toString());
  });

  it("loginAdmin returns a signed token for valid credentials", async () => {
    const email = `admin-login-${makeId("u")}@systolab.local`;
    const password = "AdminPass!Secure123";
    await bootstrapOwner("OwnerPassword!Secure123");
    await createAdminUser(email, password, "viewer");

    const result = await loginAdmin(email, password, TEST_IP, TEST_UA);
    expect(result.token).toBeTruthy();
    expect(result.sessionId).toBeTruthy();
    const sessions = await listAdminSessions(result.user.adminUserId);
    expect(sessions.some((session) => session.sessionId === result.sessionId)).toBe(true);
  });

  it("verifyAdminToken resolves a valid token to a verified payload", async () => {
    const email = `admin-verify-${makeId("u")}@systolab.local`;
    const password = "VerifyPass!Secure123";
    await bootstrapOwner("OwnerPassword!Secure123");
    await createAdminUser(email, password, "manager");
    const { token } = await loginAdmin(email, password, TEST_IP, TEST_UA);

    const verified = await verifyAdminToken(token);
    expect(verified.email).toBe(email);
    expect(verified.role).toBe("manager");
  });

  it("listAdminUsers returns at least the owner", async () => {
    await bootstrapOwner("OwnerPassword!Secure123");
    const users = await listAdminUsers();
    expect(users.some((u) => u.role === "owner")).toBe(true);
  });
});

describe("admin auth — abuse and lockout", () => {
  it("loginAdmin throws AdminAuthError for wrong password", async () => {
    const email = `admin-wrong-${makeId("u")}@systolab.local`;
    await bootstrapOwner("OwnerPassword!Secure123");
    await createAdminUser(email, "Correct!Pass123", "viewer");

    await expect(loginAdmin(email, "WrongPassword!", TEST_IP, TEST_UA)).rejects.toThrow(AdminAuthError);
  });

  it("loginAdmin throws for a non-existent admin account", async () => {
    await expect(loginAdmin("nobody@nowhere.example", "Any!Pass123", TEST_IP, TEST_UA)).rejects.toThrow(AdminAuthError);
  });

  it("verifyAdminToken throws for a tampered token", async () => {
    const email = `admin-tamper-${makeId("u")}@systolab.local`;
    const password = "TamperPass!123";
    await bootstrapOwner("OwnerPassword!Secure123");
    await createAdminUser(email, password, "viewer");
    const { token } = await loginAdmin(email, password, TEST_IP, TEST_UA);

    // Tamper with the payload portion
    const [header, body, sig] = token.split(".");
    const decoded = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as Record<string, unknown>;
    decoded["role"] = "owner"; // Privilege escalation attempt
    const tampered = `${header}.${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;

    await expect(verifyAdminToken(tampered)).rejects.toThrow();
  });

  it("logoutAdmin revokes the session so subsequent verifyAdminToken calls fail", async () => {
    const email = `admin-logout-${makeId("u")}@systolab.local`;
    const password = "LogoutPass!123";
    await bootstrapOwner("OwnerPassword!Secure123");
    await createAdminUser(email, password, "viewer");
    const { token } = await loginAdmin(email, password, TEST_IP, TEST_UA);
    const verified = await verifyAdminToken(token);

    await logoutAdmin(verified.jti, email, "viewer", TEST_IP, TEST_UA);

    await expect(verifyAdminToken(token)).rejects.toThrow();
  });

  it("account lockout blocks login after repeated wrong-password attempts", async () => {
    const email = `admin-lockout-${makeId("u")}@systolab.local`;
    const password = "LockoutPass!123";
    await bootstrapOwner("OwnerPassword!Secure123");
    await createAdminUser(email, password, "viewer");

    // Exhaust max attempts
    for (let i = 0; i < 5; i++) {
      await loginAdmin(email, "WrongPass!", TEST_IP, TEST_UA).catch(() => undefined);
    }

    // Even correct password should fail now (locked)
    await expect(loginAdmin(email, password, TEST_IP, TEST_UA)).rejects.toThrow();
  });
});

describe("admin auth — user management", () => {
  it("createAdminUser creates an active admin with the specified role", async () => {
    await bootstrapOwner("OwnerPassword!Secure123");
    const user = await createAdminUser(`mgr-${makeId("u")}@systolab.local`, "MgrPass!1234", "manager");
    expect(user.role).toBe("manager");
    expect(user.isActive).toBe(true);
  });

  it("deactivateAdminUser sets isActive to false", async () => {
    await bootstrapOwner("OwnerPassword!Secure123");
    const user = await createAdminUser(`deact-${makeId("u")}@systolab.local`, "DeactPass!123", "viewer");
    await deactivateAdminUser(user._id.toString());

    const users = await listAdminUsers();
    const found = users.find((u) => u._id.toString() === user._id.toString());
    expect(found?.isActive).toBe(false);
  });
});
