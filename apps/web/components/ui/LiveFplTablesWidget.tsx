import Card from "./Card";
import SectionHeader from "./SectionHeader";

const TARGET_URL = "https://livefpltables.com/my-leagues";

export default function LiveFplTablesWidget() {
  return (
    <Card>
      <SectionHeader
        title="Live FPL Tables"
        description="Your Live FPL Tables leagues view"
      />
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <iframe
          src={TARGET_URL}
          title="Live FPL Tables"
          className="w-full"
          style={{ minHeight: "70vh", border: 0 }}
          loading="lazy"
        />
      </div>
      {/*
        This fallback card is ALWAYS rendered, not conditionally shown on an
        error. livefpltables.com is a third-party site we don't control, and
        most sites like it send X-Frame-Options / frame-ancestors headers
        that block iframing outright. A blocked iframe just renders blank —
        cross-origin restrictions mean we can't detect that failure from JS
        in this sandbox (no headless browser available here to check
        response headers). So rather than guess, we always show a working
        link alongside the embed attempt. Do not remove this thinking it's
        dead/redundant markup — it's the only guaranteed-working path if the
        iframe above renders blank.
      */}
      <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-border bg-canvas p-4">
        <div>
          <p className="text-sm font-medium text-ink-primary">livefpltables.com</p>
          <p className="mt-0.5 text-xs text-ink-muted">Your Live FPL Tables leagues view</p>
        </div>
        <a
          href={TARGET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-sm font-medium text-accent underline underline-offset-2 hover:text-accent-dim"
        >
          Open livefpltables.com ↗
        </a>
      </div>
    </Card>
  );
}
