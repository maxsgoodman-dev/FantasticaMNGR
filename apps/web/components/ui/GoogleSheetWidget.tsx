import Card from "./Card";
import SectionHeader from "./SectionHeader";

const SHEET_ID = "1HcQsj3aVbvlak135JK_akFxQ68hG6ioV2HRtOpr-6JM";
const SHEET_GID = "978454946";

// "/pubhtml" requires the sheet to be explicitly Published to the web
// (File > Share > Publish to web) — this sheet is only shared as "anyone
// with the link can view", which /pubhtml rejects with "This document is
// not published." "/preview" renders the same live, tab-switchable view
// for any link-shared sheet without that extra publish step (confirmed
// working directly against this sheet — see the widget's caption below).
const EMBED_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/preview?gid=${SHEET_GID}`;

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
