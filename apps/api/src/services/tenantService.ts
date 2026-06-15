import { defaultBranding, tenantToBranding, Tenant } from "../models/Tenant.js";
import type { TenantBranding } from "@systolab/shared";
import { isMongoConnected } from "../db/mongoose.js";

export async function getTenantBranding(slug?: string): Promise<TenantBranding> {
  const tenantSlug = slug || "systolab";
  if (!isMongoConnected()) {
    if (tenantSlug === "systolab") return defaultBranding();
    return { ...defaultBranding(), slug: tenantSlug, publicName: tenantSlug };
  }

  const tenant = await Tenant.findOne({ slug: tenantSlug, isActive: true });
  if (!tenant) {
    if (tenantSlug === "systolab") return defaultBranding();
    return { ...defaultBranding(), slug: tenantSlug, publicName: tenantSlug };
  }
  return tenantToBranding(tenant);
}
