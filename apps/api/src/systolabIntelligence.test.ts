import { describe, expect, it } from "vitest";
import { buildDimensionScores } from "./services/truth-engine/scoring.js";
import { EvidenceBuilder } from "./services/truth-engine/evidence.js";
import { buildCompetitorContentGapEvidence, extractSystolabIntelligenceEvidence } from "./services/truth-engine/systolabIntelligence.js";

describe("native SYSTOLAB intelligence evidence contributors", () => {
  it("generates native SEO, schema, question coverage, decision confidence, trust proof, and journey evidence", () => {
    const evidence = extractSystolabIntelligenceEvidence([fixturePage()], new URL("https://acme-dental.example"), new EvidenceBuilder("native-intel"));
    const keys = evidence.map((item) => String(item.normalizedInput.signalKey));

    expect(keys).toContain("native_seo_technical_foundation_score");
    expect(keys).toContain("native_schema_coverage_score");
    expect(keys).toContain("native_geo_ai_readiness_score");
    expect(keys).toContain("native_topic_authority_coverage_score");
    expect(keys).toContain("native_customer_question_coverage_score");
    expect(keys).toContain("native_decision_confidence_score");
    expect(keys).toContain("native_trust_proof_coverage_score");
    expect(keys).toContain("native_entity_clarity_score");
    expect(keys).toContain("native_citation_credibility_score");
    expect(keys).toContain("native_content_freshness_score");
    expect(keys).toContain("native_customer_journey_continuity_score");
    expect(keys).toContain("native_search_to_sale_support_score");
    expect(keys).toContain("native_business_type_detection");
    expect(keys).toContain("native_local_business_readiness_score");

    const schema = evidence.find((item) => item.normalizedInput.signalKey === "native_schema_coverage_score");
    expect(schema?.rawValue).toMatch(/Dentist|LocalBusiness|FAQPage/);
    expect(JSON.stringify(evidence)).not.toMatch(/Claude|third-party repository|command workflow/i);
  });

  it("routes native evidence through existing SYSTOLAB dimension scoring", () => {
    const evidence = extractSystolabIntelligenceEvidence([fixturePage()], new URL("https://acme-dental.example"), new EvidenceBuilder("native-scoring"));
    const dimensions = buildDimensionScores(evidence);
    const conversion = dimensions.find((dimension) => dimension.key === "conversionReadiness");
    const trust = dimensions.find((dimension) => dimension.key === "trust");
    const clarity = dimensions.find((dimension) => dimension.key === "informationClarity");

    expect(conversion?.trace.some((factor) => factor.factorId === "conversion_questions")).toBe(true);
    expect(conversion?.trace.some((factor) => factor.factorId === "conversion_decision_confidence")).toBe(true);
    expect(trust?.trace.some((factor) => factor.factorId === "trust_native_proof")).toBe(true);
    expect(clarity?.trace.some((factor) => factor.factorId === "clarity_questions")).toBe(true);
  });

  it("detects e-commerce purchase confidence as a native contributor without external APIs", () => {
    const evidence = extractSystolabIntelligenceEvidence([ecommerceFixturePage()], new URL("https://store.example"), new EvidenceBuilder("native-ecom"));
    const ecommerce = evidence.find((item) => item.normalizedInput.signalKey === "native_ecommerce_purchase_confidence_score");

    expect(ecommerce).toBeTruthy();
    expect(ecommerce?.normalizedInput.sourceModule).toBe("systolab_ecommerce_intelligence");
    expect(Number(ecommerce?.normalizedInput.value)).toBeGreaterThan(50);
  });

  it("creates competitor content gap evidence without exposing third-party methodology", () => {
    const primary = extractSystolabIntelligenceEvidence([weakFixturePage()], new URL("https://primary.example"), new EvidenceBuilder("primary-gap"));
    const competitor = extractSystolabIntelligenceEvidence([fixturePage()], new URL("https://acme-dental.example"), new EvidenceBuilder("competitor-gap"));
    const gaps = buildCompetitorContentGapEvidence(
      new URL("https://primary.example"),
      primary,
      [{ requestedUrl: "https://acme-dental.example", analysis: { evidenceObjects: competitor } }],
      new EvidenceBuilder("gap-evidence")
    );

    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0]?.normalizedInput.signalKey).toBe("native_competitor_content_gap_score");
    expect(gaps[0]?.normalizedInput.sourceModule).toBe("systolab_competitor_content_gap_intelligence");
    expect(JSON.stringify(gaps)).not.toMatch(/Claude|rankings?|crawler telemetry/i);
  });
});

function fixturePage() {
  return {
    finalUrl: "https://acme-dental.example/",
    role: "homepage",
    html: `<!doctype html>
      <html lang="en">
        <head>
          <title>Acme Dental Clinic Appointment Care In Austin</title>
          <meta name="description" content="Book a dental appointment with licensed dentists, transparent treatment steps, insurance guidance, patient reviews, and emergency care options.">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <link rel="canonical" href="https://acme-dental.example/">
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                { "@type": "Dentist", "name": "Acme Dental Clinic", "telephone": "555-111-2222", "address": "100 Main Street" },
                { "@type": "LocalBusiness", "name": "Acme Dental Clinic" },
                { "@type": "FAQPage", "mainEntity": [] }
              ]
            }
          </script>
        </head>
        <body>
          <nav><a href="/services">Services</a><a href="/pricing">Pricing</a><a href="/reviews">Reviews</a><a href="/contact">Contact</a><a href="/faq">FAQ</a></nav>
          <main>
            <h1>Dental appointments with clear pricing and trusted care</h1>
            <h2>What should patients expect during treatment?</h2>
            <p>Our process explains consultation, treatment options, insurance, estimated cost, and after-care support.</p>
            <h2>Why choose Acme Dental?</h2>
            <p>Licensed dentists, patient testimonials, five-star reviews, emergency appointments, and a satisfaction guarantee help patients decide confidently.</p>
            <p>Call 555-111-2222 or book an appointment. We serve Austin and nearby local service areas. Open Mon Fri.</p>
            <a href="/appointment">Book Appointment</a>
            <img src="/team.jpg" alt="Acme Dental care team">
          </main>
        </body>
      </html>`
  };
}

function ecommerceFixturePage() {
  return {
    finalUrl: "https://store.example/",
    role: "homepage",
    html: `<!doctype html>
      <html lang="en">
        <head>
          <title>Buy Secure Skincare Products With Fast Shipping</title>
          <meta name="description" content="Shop skincare products with customer reviews, secure checkout, fast shipping, easy returns, refund support, and helpful product guidance.">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <link rel="canonical" href="https://store.example/">
          <script type="application/ld+json">{ "@context": "https://schema.org", "@type": "Product", "name": "Hydrating Serum" }</script>
        </head>
        <body>
          <h1>Hydrating serum with reviews, secure payment, and clear returns</h1>
          <p>View product reviews, shipping details, refund policy, payment security, support, and product ingredients before checkout.</p>
          <a href="/product/hydrating-serum">Product Details</a>
          <button>Add to cart</button>
          <a href="/checkout">Checkout</a>
        </body>
      </html>`
  };
}

function weakFixturePage() {
  return {
    finalUrl: "https://primary.example/",
    role: "homepage",
    html: `<!doctype html>
      <html>
        <head><title>Primary Business</title></head>
        <body>
          <h1>Primary Business</h1>
          <p>We provide services. Contact us.</p>
          <a href="/contact">Contact</a>
        </body>
      </html>`
  };
}
