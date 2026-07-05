import dns from "node:dns/promises";
import { Tenant } from "../models/Tenant.js";
import { logger } from "../utils/logger.js";

export interface DomainVerificationResult {
  domain: string;
  verified: boolean;
  cname?: string;
  expected?: string;
  error?: string;
}

export async function verifyCustomDomain(
  tenantSlug: string,
  domain: string
): Promise<DomainVerificationResult> {
  const expectedCname = `${tenantSlug}.systolab.app`;
  const normalized = domain.toLowerCase().trim();

  try {
    const addresses = await dns.resolveCname(normalized);
    const matched = addresses.some((a) => a.toLowerCase() === expectedCname.toLowerCase());

    logger.info("custom_domain.verify", { tenantSlug, domain: normalized, matched, addresses });

    return {
      domain: normalized,
      verified: matched,
      cname: addresses[0],
      expected: expectedCname
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn("custom_domain.verify_failed", { tenantSlug, domain: normalized, error });
    return { domain: normalized, verified: false, expected: expectedCname, error };
  }
}

export async function lookupTenantByDomain(domain: string): Promise<{ tenantSlug: string } | null> {
  const normalized = domain.toLowerCase().trim();
  const tenant = await Tenant.findOne({ customDomain: normalized, isActive: true }).select("slug");
  if (!tenant) return null;
  return { tenantSlug: tenant.slug };
}

export async function setVerifiedDomain(tenantSlug: string, domain: string): Promise<void> {
  const normalized = domain.toLowerCase().trim();
  await Tenant.updateOne(
    { slug: tenantSlug },
    {
      $set: {
        customDomain: normalized,
        customDomainStatus: "verified",
        customDomainVerificationTarget: `${tenantSlug}.systolab.app`
      },
      $addToSet: { customDomains: normalized }
    }
  );
}
