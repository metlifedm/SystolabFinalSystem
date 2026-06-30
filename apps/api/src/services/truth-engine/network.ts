import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import { env } from "../../config/env.js";
import { recordCrawlOutcome } from "../crawlerHealthService.js";

// â”€â”€ User-agent pool â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 SYSTOLABDiagnostic/1.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 SYSTOLABDiagnostic/1.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 SYSTOLABDiagnostic/1.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0 SYSTOLABDiagnostic/1.0"
];
let _uaIndex = 0;

function selectUserAgent(): string {
  if (!env.crawlUaRotation) return UA_POOL[0]!;
  const ua = UA_POOL[_uaIndex % UA_POOL.length]!;
  _uaIndex++;
  return ua;
}

// â”€â”€ Soft-block detection patterns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SOFT_BLOCK_PATTERNS = [
  /access\s+denied/i,
  /403\s+forbidden/i,
  /blocked\s+by/i,
  /please\s+verify\s+you(?:'re| are)\s+(?:a\s+)?human/i,
  /are\s+you\s+a\s+robot/i,
  /cf[-_]mitigated/i,
  /challenge[-_]platform/i,
  /rate\s+limit(?:ed)?/i,
  /too\s+many\s+requests/i,
  /bot\s+detected/i,
  /automated\s+(?:access|traffic)/i,
  /captcha|recaptcha/i,
  /security\s+check/i,
  /ddos\s+protection/i,
  /enable\s+javascript\s+and\s+cookies/i
];

function detectSoftBlock(body: string, status: number): boolean {
  if (!env.crawlSoftBlockDetection) return false;
  if (status >= 400) return false;
  if (body.length < 50 || body.length > 100_000) return false;
  return SOFT_BLOCK_PATTERNS.some((pattern) => pattern.test(body));
}

// â”€â”€ Error categorisation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type ErrorCategory = "dns" | "tls" | "timeout" | "tcp" | "redirect" | "content" | "blocked" | "soft_block" | "unknown";

export class NetworkValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "NetworkValidationError";
  }
}

function categorizeError(err: unknown): ErrorCategory {
  if (!(err instanceof Error)) return "unknown";
  const code = (err as NodeJS.ErrnoException).code;
  const msg = err.message;
  if (err.name === "AbortError" || code === "ETIMEDOUT" || msg.includes("timed out")) return "timeout";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NONAME" || msg.includes("Unable to resolve hostname")) return "dns";
  if (msg.includes("certificate") || msg.includes("SSL") || msg.includes("CERT_") || (code === "ECONNRESET" && msg.includes("TLS"))) return "tls";
  if (
    code === "ECONNRESET" ||
    code === "ECONNABORTED" ||
    code === "EPIPE" ||
    code === "ECONNREFUSED" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH" ||
    msg.includes("socket hang up")
  ) return "tcp";
  if (msg.includes("Redirect limit") || msg.includes("HTTPS to HTTP")) return "redirect";
  if (msg.includes("Private") || msg.includes("reserved") || msg.includes("internal")) return "blocked";
  return "unknown";
}

function isDnsLookupFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NONAME" || code === "ENODATA";
}
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ECONNRESET" || code === "ECONNABORTED" || code === "EPIPE" || code === "ETIMEDOUT" || code === "ENETUNREACH" || code === "EHOSTUNREACH") return true;
  if (err.message.includes("socket hang up")) return true;
  return false;
}

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface PublicAddress {
  address: string;
  family: 4 | 6;
}

interface PublicUrlResolution {
  url: URL;
  addresses: PublicAddress[];
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  bytesRead: number;
  durationMs: number;
  softBlocked?: boolean;
  retryCount?: number;
  errorCategory?: ErrorCategory;
}

// â”€â”€ URL normalisation & validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function normalizeUrl(input: string | URL): URL {
  const trimmed = String(input).trim();
  const schemeLike = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  const explicitScheme = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase();
  if (explicitScheme && !["http", "https"].includes(explicitScheme)) {
    throw new Error("Only HTTP and HTTPS website URLs can be scanned.");
  }
  if (schemeLike && !explicitScheme && !schemeLike.includes(".") && !["http", "https"].includes(schemeLike)) {
    throw new Error("Only HTTP and HTTPS website URLs can be scanned.");
  }

  const withProtocol = explicitScheme ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS website URLs can be scanned.");
  }
  if (url.username || url.password) {
    throw new Error("Website scan URLs must not contain embedded credentials.");
  }
  if (!url.hostname) {
    throw new Error("Website scan URL must include a hostname.");
  }
  url.hash = "";
  return url;
}

export async function assertPublicHttpUrl(input: string): Promise<URL> {
  return (await resolvePublicHttpUrl(input)).url;
}

export async function resolvePublicHttpUrl(input: string | URL): Promise<PublicUrlResolution> {
  const url = normalizeUrl(input);
  const hostname = normalizedHostname(url);

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new Error("Local and internal hostnames are not allowed for website scans.");
  }

  if (net.isIP(hostname)) {
    if (isBlockedNetworkAddress(hostname)) {
      throw new Error("Private, local, metadata, and reserved network addresses are not allowed for website scans.");
    }
    return { url, addresses: [{ address: hostname, family: net.isIP(hostname) as 4 | 6 }] };
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    if (isDnsLookupFailure(error)) {
      throw new NetworkValidationError(`Unable to resolve hostname: ${hostname}`);
    }
    throw error;
  }
  if (records.length === 0) {
    throw new NetworkValidationError(`Unable to resolve hostname: ${hostname}`);
  }
  const addresses: PublicAddress[] = [];
  for (const record of records) {
    const address = typeof record.address === "string" ? record.address : "";
    const family = record.family;
    if (address.length > 0 && (family === 4 || family === 6) && net.isIP(address) === family) {
      addresses.push({ address, family });
    }
  }

  if (addresses.length === 0) {
    throw new Error(`Unable to resolve usable public address for hostname: ${hostname}`);
  }

  for (const record of addresses) {
    if (isBlockedNetworkAddress(record.address)) {
      throw new Error("Private, local, metadata, and reserved network addresses are not allowed for website scans.");
    }
  }

  return { url, addresses };
}

// â”€â”€ Core fetch with retry + telemetry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function fetchText(
  url: URL,
  timeoutMs = env.crawlTimeoutMs,
  maxBytes = env.crawlMaxBytes,
  options?: { retryAttempts?: number; retryBaseMs?: number }
): Promise<FetchResult> {
  const maxAttempts = 1 + Math.max(0, options?.retryAttempts ?? 0);
  const baseMs = options?.retryBaseMs ?? env.crawlRetryBaseMs;
  const startedAt = Date.now();

  let lastError: unknown = null;
  let retryCount = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = baseMs * Math.pow(2, attempt - 1);
      await sleep(delay);
      retryCount++;
    }

    try {
      const originalUrl = url.toString();
      let current = await resolvePublicHttpUrl(url);

      for (let redirectCount = 0; redirectCount <= env.crawlMaxRedirects; redirectCount += 1) {
        const response = await fetchOnce(current, timeoutMs, maxBytes, startedAt, originalUrl);
        const location = response.headers.location;
        if (!isRedirectStatus(response.status) || !location) {
          const softBlocked = detectSoftBlock(response.body, response.status);
          const errorCategory: ErrorCategory | undefined = softBlocked ? "soft_block" : undefined;
          const result: FetchResult = { ...response, softBlocked, retryCount, errorCategory };
          recordCrawlOutcome({
            url: originalUrl,
            success: result.ok && !softBlocked,
            statusCode: result.status,
            durationMs: result.durationMs,
            softBlocked,
            retryCount,
            recordedAt: new Date()
          });
          return result;
        }
        if (redirectCount >= env.crawlMaxRedirects) {
          throw new Error(`Redirect limit exceeded after ${env.crawlMaxRedirects} hop(s).`);
        }
        const next = normalizeUrl(new URL(location, current.url));
        if (current.url.protocol === "https:" && next.protocol === "http:") {
          throw new Error("Unsafe redirect from HTTPS to HTTP is not allowed for website scans.");
        }
        current = await resolvePublicHttpUrl(next);
      }

      throw new Error("Redirect limit exceeded.");
    } catch (err) {
      lastError = err;
      if (attempt + 1 < maxAttempts && isRetryableError(err)) {
        continue;
      }
      break;
    }
  }

  // All attempts exhausted â€” record failure and rethrow
  const errorCategory = categorizeError(lastError);
  const durationMs = Date.now() - startedAt;
  recordCrawlOutcome({
    url: url.toString(),
    success: false,
    durationMs,
    errorCategory,
    retryCount,
    recordedAt: new Date()
  });
  throw lastError;
}

// â”€â”€ Network address guards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function isBlockedNetworkAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
}

// â”€â”€ Internal helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function fetchOnce(
  resolution: PublicUrlResolution,
  timeoutMs: number,
  maxBytes: number,
  startedAt: number,
  originalUrl: string
): Promise<FetchResult> {
  let lastError: unknown = null;
  for (const pinned of resolution.addresses) {
    try {
      return await fetchPinnedOnce(resolution, pinned, timeoutMs, maxBytes, startedAt, originalUrl);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) break;
    }
  }
  throw lastError;
}

function fetchPinnedOnce(
  resolution: PublicUrlResolution,
  pinned: PublicAddress,
  timeoutMs: number,
  maxBytes: number,
  startedAt: number,
  originalUrl: string
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const transport = resolution.url.protocol === "https:" ? https : http;
    let settled = false;
    const userAgent = selectUserAgent();
    const request = transport.request(
      resolution.url,
      {
        signal: AbortSignal.timeout(timeoutMs),
        lookup: (_hostname, lookupOptions, maybeCallback) => {
          const callback = (typeof lookupOptions === "function" ? lookupOptions : maybeCallback) as
            | ((error: NodeJS.ErrnoException | null, address: string, family: number) => void)
            | ((error: NodeJS.ErrnoException | null, addresses: PublicAddress[]) => void)
            | undefined;
          if (!callback) return;
          const all = typeof lookupOptions === "object" && lookupOptions !== null && Boolean((lookupOptions as { all?: boolean }).all);
          if (all) {
            (callback as (error: NodeJS.ErrnoException | null, addresses: PublicAddress[]) => void)(null, [pinned]);
            return;
          }
          (callback as (error: NodeJS.ErrnoException | null, address: string, family: number) => void)(null, pinned.address, pinned.family);
        },
        headers: {
          "user-agent": userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.2",
          "accept-language": "en-US,en;q=0.9",
          "accept-encoding": "gzip, deflate, br",
          "cache-control": "no-cache",
          pragma: "no-cache"
        }
      },
      (response) => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(", ");
          else if (value !== undefined) headers[key.toLowerCase()] = String(value);
        }

        const bytes: Buffer[] = [];
        let bytesRead = 0;

        const finish = () => {
          if (settled) return;
          settled = true;
          const rawBody = Buffer.concat(bytes);
          resolve({
            url: originalUrl,
            finalUrl: resolution.url.toString(),
            status: response.statusCode ?? 0,
            ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300),
            headers,
            body: decodeResponseBody(rawBody, headers["content-encoding"]),
            bytesRead,
            durationMs: Date.now() - startedAt
          });
        };

        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          const remaining = maxBytes - bytesRead;
          if (remaining <= 0) {
            response.destroy();
            finish();
            return;
          }
          const accepted = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
          bytes.push(accepted);
          bytesRead += accepted.byteLength;
          if (bytesRead >= maxBytes) {
            response.destroy();
            finish();
          }
        });
        response.on("end", finish);
        response.on("error", (error) => {
          if (!settled) reject(error);
        });
      }
    );

    request.on("error", (error) => {
      if (!settled) reject(error);
    });
    request.end();
  });
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

export function decodeResponseBody(buffer: Buffer, contentEncoding?: string): string {
  const encoding = (contentEncoding ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  try {
    if (encoding === "gzip" || encoding === "x-gzip") return zlib.gunzipSync(buffer).toString("utf8");
    if (encoding === "br") return zlib.brotliDecompressSync(buffer).toString("utf8");
    if (encoding === "deflate") return zlib.inflateSync(buffer).toString("utf8");
  } catch {
    return buffer.toString("utf8");
  }
  return buffer.toString("utf8");
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [a, b, c, d] = parts;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 169 && b === 254 && c === 169 && d === 254) return true;
  if (a === 169 && b === 254 && c === 170 && d === 2) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a === 100 && b === 100 && c === 100 && d === 200) return true;
  if (a === 0) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) return isBlockedIpv4(mapped);
  }
  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80") ||
    value.startsWith("ff") ||
    value.startsWith("2001:db8") ||
    value.startsWith("2002:")
  );
}
