import Card from "./Card";
import SectionHeader from "./SectionHeader";

const SHEET_ID = "1HcQsj3aVbvlak135JK_akFxQ68hG6ioV2HRtOpr-6JM";
const SHEET_GID = "978454946";

// The publish-to-web "pubhtml" endpoint renders the live sheet with its tab
// bar intact (all tabs stay clickable, exactly like the real Sheets UI).
// `gid` just lands the initial view on a specific tab.
const EMBED_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/pubhtml?widget=true&headers=false&gid=${SHEET_GID}`;

const EDIT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${SHEET_GID}#gid=${SHEET_GID}`;

export default function GoogleSheetWidget() {
  return (
    <Card>
      <SectionHeader
        title="Google Sheet"
        description="Live embedded view — all tabs are switchable below, just like the original sheet."
      />
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <iframe
          src={EMBED_URL}
          title="Embedded Google Sheet"
          className="w-full"
          style={{ minHeight: "70vh", border: 0 }}
          loading="lazy"
        />
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        This embed only shows live data if the sheet is shared as &ldquo;Anyone with the
        link can view&rdquo; or published to the web. If you see a Google sign-in or
        access-denied screen instead of data, that&apos;s why —{" "}
        <a
          href={EDIT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent underline underline-offset-2 hover:text-accent-dim"
        >
          open it in Google Sheets instead ↗
        </a>
        .
      </p>
    </Card>
  );
}
