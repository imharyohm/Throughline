import { NextResponse } from "next/server";
import { visualize } from "@/lib/cognee";

// Proxies Cognee's own D3 knowledge-graph HTML so the frontend can embed it
// in an <iframe> without ever exposing the API key to the browser.

// Cognee's toolbar (view tabs + theme toggle) is positioned with fixed,
// center/right-anchored CSS sized for a full browser window. Embedded in our
// narrow sidebar iframe (~350px) the tab row and theme-toggle button overlap.
// This patches only that chrome's position/size — it does not touch the
// graph rendering itself, so it stays within the "no custom D3 work" rule.
const NARROW_EMBED_PATCH = `
<style>
  #view-tabs { left: 8px !important; transform: none !important; }
  .tab-btn { padding: 4px 10px !important; font-size: 11px !important; }
  #theme-toggle { top: 44px !important; right: 8px !important; padding: 4px 10px !important; font-size: 10px !important; }
</style>
</head>`;

export async function GET() {
  try {
    const html = (await visualize()).replace("</head>", NARROW_EMBED_PATCH);
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const html = `<html><body style="margin:0;font-family:monospace;color:#f87171;background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;padding:16px;text-align:center">${message}</body></html>`;
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
