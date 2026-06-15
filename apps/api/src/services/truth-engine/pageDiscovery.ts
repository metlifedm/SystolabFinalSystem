import * as cheerio from "cheerio";

export interface DiscoveredLink {
  url: string;
  role: string;
  priority: number;
}

const ROLE_PATTERNS: Array<{ role: string; pattern: RegExp; priority: number }> = [
  { role: "contact", pattern: /contact|location|book|appointment|quote|get-in-touch/i, priority: 100 },
  { role: "services", pattern: /service|solution|product|treatment|offering/i, priority: 90 },
  { role: "pricing", pattern: /pricing|plans|fees|packages/i, priority: 80 },
  { role: "about", pattern: /about|team|company|clinic|profile/i, priority: 75 },
  { role: "portfolio", pattern: /case|work|portfolio|result|gallery/i, priority: 70 },
  { role: "content", pattern: /blog|article|guide|resource|faq|help/i, priority: 60 },
  { role: "legal", pattern: /privacy|terms|policy/i, priority: 40 }
];

export function discoverInternalLinks(html: string, baseUrl: URL, limit: number): DiscoveredLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const links: DiscoveredLink[] = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;

    let parsed: URL;
    try {
      parsed = new URL(href, baseUrl);
    } catch {
      return;
    }

    if (parsed.origin !== baseUrl.origin) return;
    parsed.hash = "";
    const key = parsed.toString();
    if (seen.has(key) || parsed.pathname === baseUrl.pathname) return;
    seen.add(key);

    const path = `${parsed.pathname} ${$(element).text()}`;
    const match = ROLE_PATTERNS.find((candidate) => candidate.pattern.test(path));
    links.push({
      url: key,
      role: match?.role ?? "general",
      priority: match?.priority ?? 20
    });
  });

  return links
    .sort((a, b) => b.priority - a.priority || a.url.localeCompare(b.url))
    .slice(0, limit);
}
