import type { ScanCoverage } from "@systolab/shared";
import { fetchText } from "./network.js";

export interface RobotsDecision {
  status: ScanCoverage["robotsTxtStatus"];
  isAllowed: boolean;
  matchedRule?: string;
}

interface Rule {
  directive: "allow" | "disallow";
  path: string;
}

export async function checkRobots(url: URL): Promise<RobotsDecision> {
  const robotsUrl = new URL("/robots.txt", url.origin);
  try {
    const response = await fetchText(robotsUrl, 6000, 250_000);
    if (response.status >= 400) {
      return { status: "unavailable", isAllowed: true };
    }

    const rules = parseRobots(response.body);
    const path = `${url.pathname}${url.search}`;
    const matched = selectRule(rules, path);
    if (!matched) return { status: "allowed", isAllowed: true };
    if (matched.directive === "allow") return { status: "allowed", isAllowed: true, matchedRule: matched.path };
    return { status: "blocked", isAllowed: false, matchedRule: matched.path };
  } catch {
    return { status: "unavailable", isAllowed: true };
  }
}

function parseRobots(body: string): Rule[] {
  const lines = body.split(/\r?\n/);
  const rules: Rule[] = [];
  let applies = false;

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      const agent = value.toLowerCase();
      applies = agent === "*" || agent.includes("systolabbot");
      continue;
    }

    if (!applies) continue;
    if ((key === "allow" || key === "disallow") && value) {
      rules.push({ directive: key, path: value });
    }
  }

  return rules;
}

function selectRule(rules: Rule[], path: string): Rule | undefined {
  const matches = rules.filter((rule) => pathMatches(rule.path, path));
  matches.sort((a, b) => b.path.length - a.path.length);
  return matches[0];
}

function pathMatches(pattern: string, path: string): boolean {
  if (pattern === "/") return true;
  if (pattern.endsWith("*")) return path.startsWith(pattern.slice(0, -1));
  return path.startsWith(pattern);
}
