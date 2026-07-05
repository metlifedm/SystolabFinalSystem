import mongoose, { Schema } from "mongoose";
import type { TenantBranding } from "@systolab/shared";

export type TenantAttributionMode = "systolab" | "partner" | "hidden";

export interface TenantDocument extends mongoose.Document {
  slug: string;
  publicName: string;
  logoUrl?: string;
  faviconUrl?: string;
  consultantPhotoUrl?: string;
  consultantEmail?: string;
  websiteUrl?: string;
  phoneNumber?: string;
  officeAddress?: string;
  businessRegistration?: string;
  licenseNumber?: string;
  socialLinks?: string[];
  consultantName?: string;
  disclaimerText?: string;
  coverPageDesign?: TenantBranding["coverPageDesign"];
  reportIntroduction?: string;
  reportHeaderText?: string;
  thankYouPageTitle?: string;
  thankYouPageMessage?: string;
  iconStyle?: TenantBranding["iconStyle"];
  qrCodeUrl?: string;
  whatsappLink?: string;
  calendarBookingLink?: string;
  digitalSignature?: string;
  primaryCtaLabel?: string;
  primaryCtaUrl?: string;
  secondaryCtaLabel?: string;
  secondaryCtaUrl?: string;
  reportValidityDays?: number;
  validityStatement?: string;
  proposalModeEnabled?: boolean;
  proposalTimeline?: string;
  proposalInvestmentRange?: string;
  proposalDeliverables?: string[];
  proposalExpectedImpact?: string;
  crmIntegration?: TenantBranding["crmIntegration"];
  pdfSecurity?: TenantBranding["pdfSecurity"];
  reportLanguage?: TenantBranding["reportLanguage"];
  industryTemplate?: TenantBranding["industryTemplate"];
  followUpAssets?: TenantBranding["followUpAssets"];
  agencySuccessCenter?: TenantBranding["agencySuccessCenter"];
  serviceOfferings?: string[];
  poweredByMode?: TenantBranding["poweredByMode"];
  customDomain?: string;
  customDomains?: string[];
  customDomainStatus?: TenantBranding["customDomainStatus"];
  customDomainVerificationTarget?: string;
  primaryColor: string;
  secondaryColor?: string;
  accentColor: string;
  typography?: string;
  loginBackgroundUrl?: string;
  dashboardWelcomeMessage?: string;
  emailSenderName?: string;
  supportEmail?: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
  attributionMode?: TenantAttributionMode;
  assistantName?: string;
  reportTitle: string;
  reportFooter?: string;
  customReportLabels?: Record<string, string>;
  poweredByLabel: string;
  footerLabel: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TenantSchema = new Schema<TenantDocument>(
  {
    slug: { type: String, required: true, unique: true, index: true },
    publicName: { type: String, required: true },
    logoUrl: { type: String },
    faviconUrl: { type: String },
    consultantPhotoUrl: { type: String },
    consultantEmail: { type: String },
    websiteUrl: { type: String },
    phoneNumber: { type: String },
    officeAddress: { type: String },
    businessRegistration: { type: String },
    licenseNumber: { type: String },
    socialLinks: { type: [String], default: [] },
    consultantName: { type: String },
    disclaimerText: { type: String },
    coverPageDesign: { type: String, enum: ["classic", "executive", "minimal"], default: "executive" },
    reportIntroduction: { type: String },
    reportHeaderText: { type: String },
    thankYouPageTitle: { type: String },
    thankYouPageMessage: { type: String },
    iconStyle: { type: String, enum: ["line", "solid", "minimal"], default: "line" },
    qrCodeUrl: { type: String },
    whatsappLink: { type: String },
    calendarBookingLink: { type: String },
    digitalSignature: { type: String },
    primaryCtaLabel: { type: String, default: "Book a Strategy Call" },
    primaryCtaUrl: { type: String },
    secondaryCtaLabel: { type: String },
    secondaryCtaUrl: { type: String },
    reportValidityDays: { type: Number, default: 30 },
    validityStatement: { type: String, default: "Recommendations are based on the scan date and should be reviewed within the stated validity window." },
    proposalModeEnabled: { type: Boolean, default: false },
    proposalTimeline: { type: String },
    proposalInvestmentRange: { type: String },
    proposalDeliverables: { type: [String], default: [] },
    proposalExpectedImpact: { type: String },
    crmIntegration: { type: Schema.Types.Mixed },
    pdfSecurity: { type: Schema.Types.Mixed },
    reportLanguage: { type: String, enum: ["en", "ar", "fr", "de", "es", "hi"], default: "en" },
    industryTemplate: { type: String, enum: ["general", "dentists", "lawyers", "interior_designers", "real_estate", "saas", "hotels", "ecommerce", "healthcare", "manufacturing"], default: "general" },
    followUpAssets: { type: Schema.Types.Mixed },
    agencySuccessCenter: { type: Schema.Types.Mixed },
    serviceOfferings: { type: [String], default: ["SEO", "Website Development", "Google Ads", "CRO", "Local SEO", "AI Search Optimization"] },
    poweredByMode: { type: String, enum: ["full_white_label", "co_branded", "systolab_standard"], default: "systolab_standard" },
    customDomain: { type: String, index: true },
    customDomains: { type: [String], default: [], index: true },
    customDomainStatus: { type: String, enum: ["not_configured", "pending_dns", "verified", "failed"], default: "not_configured" },
    customDomainVerificationTarget: { type: String },
    primaryColor: { type: String, default: "#246b5b" },
    secondaryColor: { type: String },
    accentColor: { type: String, default: "#c27a2c" },
    typography: { type: String },
    loginBackgroundUrl: { type: String },
    dashboardWelcomeMessage: { type: String },
    emailSenderName: { type: String },
    supportEmail: { type: String },
    privacyPolicyUrl: { type: String },
    termsOfServiceUrl: { type: String },
    attributionMode: { type: String, enum: ["systolab", "partner", "hidden"], default: "systolab" },
    assistantName: { type: String },
    reportTitle: { type: String, default: "Website Growth & Decision Intelligence Report" },
    reportFooter: { type: String },
    customReportLabels: { type: Schema.Types.Mixed },
    poweredByLabel: { type: String, default: "Powered by SYSTOLAB Revenue Intelligence Engine" },
    footerLabel: { type: String, default: "Generated by SYSTOLAB Revenue Intelligence Platform" },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true, minimize: false }
);

export const Tenant = mongoose.model<TenantDocument>("Tenant", TenantSchema);

export function tenantToBranding(tenant: TenantDocument): TenantBranding {
  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    publicName: tenant.publicName,
    logoUrl: tenant.logoUrl,
    faviconUrl: tenant.faviconUrl,
    consultantPhotoUrl: tenant.consultantPhotoUrl,
    consultantEmail: tenant.consultantEmail,
    websiteUrl: tenant.websiteUrl,
    phoneNumber: tenant.phoneNumber,
    officeAddress: tenant.officeAddress,
    businessRegistration: tenant.businessRegistration,
    licenseNumber: tenant.licenseNumber,
    socialLinks: tenant.socialLinks ?? [],
    consultantName: tenant.consultantName,
    disclaimerText: tenant.disclaimerText,
    coverPageDesign: tenant.coverPageDesign,
    reportIntroduction: tenant.reportIntroduction,
    reportHeaderText: tenant.reportHeaderText,
    thankYouPageTitle: tenant.thankYouPageTitle,
    thankYouPageMessage: tenant.thankYouPageMessage,
    iconStyle: tenant.iconStyle,
    qrCodeUrl: tenant.qrCodeUrl,
    whatsappLink: tenant.whatsappLink,
    calendarBookingLink: tenant.calendarBookingLink,
    digitalSignature: tenant.digitalSignature,
    primaryCtaLabel: tenant.primaryCtaLabel,
    primaryCtaUrl: tenant.primaryCtaUrl,
    secondaryCtaLabel: tenant.secondaryCtaLabel,
    secondaryCtaUrl: tenant.secondaryCtaUrl,
    reportValidityDays: tenant.reportValidityDays,
    validityStatement: tenant.validityStatement,
    proposalModeEnabled: tenant.proposalModeEnabled,
    proposalTimeline: tenant.proposalTimeline,
    proposalInvestmentRange: tenant.proposalInvestmentRange,
    proposalDeliverables: tenant.proposalDeliverables ?? [],
    proposalExpectedImpact: tenant.proposalExpectedImpact,
    crmIntegration: tenant.crmIntegration,
    pdfSecurity: tenant.pdfSecurity,
    reportLanguage: tenant.reportLanguage,
    industryTemplate: tenant.industryTemplate,
    followUpAssets: tenant.followUpAssets,
    agencySuccessCenter: tenant.agencySuccessCenter,
    serviceOfferings: tenant.serviceOfferings ?? [],
    poweredByMode: tenant.poweredByMode,
    primaryColor: tenant.primaryColor,
    secondaryColor: tenant.secondaryColor,
    accentColor: tenant.accentColor,
    typography: tenant.typography,
    loginBackgroundUrl: tenant.loginBackgroundUrl,
    dashboardWelcomeMessage: tenant.dashboardWelcomeMessage,
    emailSenderName: tenant.emailSenderName,
    supportEmail: tenant.supportEmail,
    privacyPolicyUrl: tenant.privacyPolicyUrl,
    termsOfServiceUrl: tenant.termsOfServiceUrl,
    attributionMode: tenant.attributionMode,
    assistantName: tenant.assistantName,
    reportTitle: tenant.reportTitle || "Website Growth & Decision Intelligence Report",
    reportFooter: tenant.reportFooter,
    customReportLabels: tenant.customReportLabels,
    poweredByLabel: tenant.poweredByLabel,
    footerLabel: tenant.footerLabel,
    customDomain: tenant.customDomain,
    customDomains: tenant.customDomains ?? [],
    customDomainStatus: tenant.customDomainStatus,
    customDomainVerificationTarget: tenant.customDomainVerificationTarget
  };
}

export function defaultBranding(): TenantBranding {
  return {
    tenantId: "default",
    slug: "systolab",
    publicName: "SYSTOLAB",
    primaryColor: "#246b5b",
    accentColor: "#c27a2c",
    attributionMode: "systolab",
    assistantName: "SYSTOLAB Intelligence Assistant",
    websiteUrl: "https://systolab.com",
    reportValidityDays: 30,
    validityStatement: "Recommendations are based on the scan date and should be reviewed within the stated validity window.",
    primaryCtaLabel: "Book a Strategy Call",
    proposalModeEnabled: false,
    reportLanguage: "en",
    industryTemplate: "general",
    customDomains: [],
    customDomainStatus: "not_configured",
    serviceOfferings: ["SEO", "Website Development", "Google Ads", "CRO", "Local SEO", "AI Search Optimization"],
    poweredByMode: "systolab_standard",
    reportTitle: "Website Growth & Decision Intelligence Report",
    poweredByLabel: "Powered by SYSTOLAB Revenue Intelligence Engine",
    footerLabel: "Generated by SYSTOLAB Revenue Intelligence Platform"
  };
}
