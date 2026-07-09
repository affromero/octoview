// octoview viewer — Phase 0 auth spike.
// Fetch the file the content script scraped and report status + byte length.
// This is the single go/no-go for the whole private-repo premise; once it
// returns 200 + bytes, the renderer registry gets wired in (Phase 1).
const params = new URLSearchParams(location.search);
const src = params.get("src");
const name = params.get("name") || "file";
const status = document.getElementById("status");
document.title = "octoview · " + name;

(async () => {
  if (!src) {
    status.textContent = "No ?src= provided.";
    return;
  }
  status.textContent = "Fetching " + name + " …";
  try {
    const res = await fetch(src, { credentials: "include" });
    const buf = await res.arrayBuffer();
    status.textContent =
      `[phase 0] ${name} → HTTP ${res.status}, ${buf.byteLength.toLocaleString()} bytes`;
    console.log("[octoview] fetch", res.status, buf.byteLength, src);
  } catch (e) {
    status.textContent = "Fetch failed: " + e.message;
    console.error("[octoview]", e);
  }
})();
