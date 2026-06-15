import { env } from "../../config/env.js";
import { saveArtifact } from "../artifactService.js";

export interface RenderedPage {
  renderedHtml: string;
  screenshotArtifactId: string | null;
  viewportArtifactId: string | null;
  ctaAboveFold: boolean;
  jsInjected: boolean;
  interactiveElementCount: number;
  renderTimeMs: number;
}

export interface Renderer {
  renderPage(url: string, options?: { snapshotId?: string; workspaceId?: string }): Promise<RenderedPage | null>;
  close(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightBrowser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightModule = any;

let playwrightMod: PlaywrightModule | null | undefined = undefined;

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  if (playwrightMod !== undefined) return playwrightMod;
  try {
    // Dynamic import so the server doesn't crash if playwright isn't installed
    playwrightMod = await import("playwright");
    return playwrightMod;
  } catch {
    playwrightMod = null;
    return null;
  }
}

export async function createRenderer(): Promise<Renderer | null> {
  if (!env.playwrightEnabled) return null;

  const pw = await loadPlaywright();
  if (!pw) {
    console.warn("[renderer] playwright not installed — headless rendering disabled");
    return null;
  }

  let browser: PlaywrightBrowser;
  try {
    browser = await pw.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[renderer] browser launch failed: ${message}`);
    return null;
  }

  return {
    async renderPage(url: string, options: { snapshotId?: string; workspaceId?: string } = {}): Promise<RenderedPage | null> {
      const t0 = Date.now();
      const context = await browser.newContext({
        viewport: { width: env.playwrightViewportWidth, height: env.playwrightViewportHeight },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 SYSTOLABDiagnostic/1.0",
        locale: "en-US",
        extraHTTPHeaders: {
          "accept-language": "en-US,en;q=0.9"
        }
      });
      const page = await context.newPage();

      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: env.playwrightTimeoutMs });
      } catch {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: env.playwrightTimeoutMs });
        } catch (err2) {
          const message = err2 instanceof Error ? err2.message : String(err2);
          console.warn(`[renderer] page load failed for ${url}: ${message}`);
          await context.close().catch(() => {});
          return null;
        }
      }

      // Collect rendering signals before screenshots
      const jsInjected = await page.evaluate((): boolean => {
        return typeof window !== "undefined" && typeof document !== "undefined" && document.querySelectorAll("script").length > 0;
      }).catch(() => false);

      const interactiveElementCount = await page.evaluate((): number => {
        return document.querySelectorAll("a, button, input, select, textarea, [role='button'], [tabindex]").length;
      }).catch(() => 0);

      // Detect CTA above fold using actual viewport — more reliable than HTML offset heuristic
      const ctaAboveFold = await page.evaluate((viewportHeight: number): boolean => {
        const ctaPatterns = /contact|call|book|quote|start|schedule|buy|demo|appointment|get started/i;
        const candidates = Array.from(document.querySelectorAll("a, button, input[type='submit']"));
        for (const el of candidates) {
          const text = el.textContent ?? "";
          const value = (el as HTMLInputElement).value ?? "";
          const href = (el as HTMLAnchorElement).href ?? "";
          if (!ctaPatterns.test(`${text} ${value} ${href}`)) continue;
          const rect = el.getBoundingClientRect();
          if (rect.top < viewportHeight && rect.bottom > 0) return true;
        }
        return false;
      }, env.playwrightViewportHeight).catch(() => false);

      const renderedHtml = await page.content().catch(() => "");

      // Viewport screenshot (shows above-fold, used for CTA evidence)
      let viewportArtifactId: string | null = null;
      try {
        const viewportBuffer = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: env.playwrightViewportWidth, height: env.playwrightViewportHeight } });
        const saved = await saveArtifact(Buffer.from(viewportBuffer), {
          pageUrl: url,
          artifactType: "screenshot_viewport",
          snapshotId: options.snapshotId,
          workspaceId: options.workspaceId
        });
        viewportArtifactId = saved.artifactId;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[renderer] viewport screenshot failed for ${url}: ${message}`);
      }

      // Full-page screenshot (optional — only if configured)
      let screenshotArtifactId: string | null = null;
      if (env.playwrightScreenshotAllPages) {
        try {
          const fullBuffer = await page.screenshot({ type: "png", fullPage: true });
          const saved = await saveArtifact(Buffer.from(fullBuffer), {
            pageUrl: url,
            artifactType: "screenshot_full",
            snapshotId: options.snapshotId,
            workspaceId: options.workspaceId
          });
          screenshotArtifactId = saved.artifactId;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[renderer] full-page screenshot failed for ${url}: ${message}`);
        }
      }

      await context.close().catch(() => {});

      return {
        renderedHtml,
        screenshotArtifactId,
        viewportArtifactId,
        ctaAboveFold,
        jsInjected,
        interactiveElementCount,
        renderTimeMs: Date.now() - t0
      };
    },

    async close(): Promise<void> {
      await browser.close().catch(() => {});
    }
  };
}
