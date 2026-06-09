export const TRY_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Claim Provenance Engine — Try it</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<style>
  :root {
    --c-bg: #f7f7f8;
    --c-card: #fff;
    --c-text: #15161a;
    --c-muted: #6b6f76;
    --c-border: #e3e5e9;
    --c-accent: #2a6dfb;
    --c-accent-hover: #1e58d8;
    --c-ok: #2b9648;
    --c-warn: #c97900;
    --c-err: #c0392b;
    --c-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: var(--c-bg); color: var(--c-text);
    font-size: 14px; line-height: 1.55;
  }
  .wrap { max-width: 980px; margin: 0 auto; padding: 28px 24px 80px; }
  header { margin-bottom: 24px; }
  h1 { font-size: 26px; margin: 0 0 6px; font-weight: 700; letter-spacing: -0.01em; }
  .lede { color: var(--c-muted); margin: 0; max-width: 720px; }
  .lede a { color: var(--c-accent); text-decoration: none; }
  .lede a:hover { text-decoration: underline; }

  .card {
    background: var(--c-card); border: 1px solid var(--c-border);
    border-radius: 10px; padding: 20px; margin-bottom: 20px;
  }
  label { display: block; font-weight: 600; font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.04em; color: var(--c-muted); margin-bottom: 6px; }
  input[type=text], textarea {
    width: 100%; padding: 9px 11px; border: 1px solid var(--c-border);
    border-radius: 6px; font-size: 14px; font-family: inherit;
    background: #fff; color: var(--c-text);
  }
  textarea { min-height: 180px; resize: vertical; line-height: 1.5; }
  input:focus, textarea:focus { outline: 2px solid var(--c-accent); outline-offset: 0; border-color: transparent; }

  .row { margin-bottom: 14px; }
  .row:last-child { margin-bottom: 0; }

  .btn-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  button {
    background: var(--c-accent); color: white; border: 0; border-radius: 6px;
    padding: 9px 18px; font-size: 14px; font-weight: 600; cursor: pointer;
    font-family: inherit;
  }
  button:hover { background: var(--c-accent-hover); }
  button:disabled { background: #98a4b8; cursor: not-allowed; }
  button.secondary {
    background: #fff; color: var(--c-text); border: 1px solid var(--c-border); font-weight: 500;
  }
  button.secondary:hover { background: #f0f1f4; }

  .meta { color: var(--c-muted); font-size: 12px; }
  .meta code { font-family: var(--c-mono); background: #eef0f3; padding: 1px 5px; border-radius: 3px; }

  #status { font-size: 13px; color: var(--c-muted); margin-left: 4px; }
  .spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--c-border);
    border-top-color: var(--c-accent); border-radius: 50%; animation: spin 0.8s linear infinite;
    vertical-align: middle; margin-right: 6px; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .results { margin-top: 8px; }
  .empty {
    padding: 40px 20px; text-align: center; color: var(--c-muted); font-size: 13px;
    border: 1px dashed var(--c-border); border-radius: 8px;
  }

  .claim {
    border: 1px solid var(--c-border); border-radius: 8px;
    padding: 14px 16px; margin-bottom: 12px; background: #fff;
  }
  .claim-text { font-weight: 500; margin: 0 0 8px; }
  .badges { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px;
    text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; }
  .badge.cat { background: #eef0f3; color: var(--c-muted); }
  .badge.imp { background: #fff4d6; color: #6f5500; }
  .badge.status { color: white; }
  .badge.status.verified { background: var(--c-ok); }
  .badge.status.partially_verified { background: #1e7a99; }
  .badge.status.opinion { background: #6b46c1; }
  .badge.status.untraceable { background: var(--c-warn); }
  .badge.status.contested { background: var(--c-err); }
  .badge.status.refuted { background: var(--c-err); }

  .chain-notes { font-size: 13px; color: var(--c-muted); margin: 6px 0 8px; font-style: italic; }
  .nodes { display: flex; flex-direction: column; gap: 6px; }
  .node {
    background: #f7f8fa; border: 1px solid var(--c-border); border-radius: 6px;
    padding: 8px 10px; font-size: 13px;
  }
  .node-title { font-weight: 500; }
  .node-title a { color: var(--c-accent); text-decoration: none; }
  .node-title a:hover { text-decoration: underline; }
  .node-meta { font-size: 11px; color: var(--c-muted); margin-top: 2px; }
  .node-snippet { color: var(--c-text); font-size: 12px; margin-top: 4px; }

  .stats { display: flex; gap: 16px; flex-wrap: wrap; padding-top: 12px; margin-top: 14px;
    border-top: 1px solid var(--c-border); font-size: 12px; color: var(--c-muted); }
  .stats span strong { color: var(--c-text); font-weight: 600; }

  .err {
    background: #fff0ec; border: 1px solid #f5b8a8; border-radius: 6px;
    padding: 10px 12px; color: #831a0a; font-size: 13px;
  }

  footer {
    margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--c-border);
    color: var(--c-muted); font-size: 12px; text-align: center;
  }
  footer a { color: var(--c-muted); text-decoration: none; margin: 0 8px; }
  footer a:hover { color: var(--c-text); text-decoration: underline; }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>Claim Provenance Engine — Try it</h1>
  <p class="lede">
    Paste a news, research, or feature article — we extract every factual claim and trace each one back to its likely original source via web search. Built for journalists and researchers. <a href="/docs">API docs</a>.
  </p>
</header>

<div class="card">
  <div class="row">
    <label for="url">Source URL</label>
    <input type="text" id="url" placeholder="https://example.com/article">
  </div>
  <div class="row">
    <label for="title">Title</label>
    <input type="text" id="title" placeholder="Article title">
  </div>
  <div class="row">
    <label for="page_text">Article text</label>
    <textarea id="page_text" placeholder="Paste the article body here…"></textarea>
  </div>
  <div class="btn-row">
    <button id="go">Analyze</button>
    <button class="secondary" id="sample">Load sample</button>
    <button class="secondary" id="clear">Clear</button>
    <span id="status"></span>
  </div>
</div>

<div class="results" id="results">
  <div class="empty">No analysis yet. Paste an article above and click Analyze, or hit "Load sample" to see what comes back.</div>
</div>

<footer>
  <a href="/docs">API docs</a> ·
  <a href="/v1/openapi.yaml">OpenAPI spec</a> ·
  <a href="/healthz">Health</a> ·
  <a href="https://github.com/abhimanyusinghal/whence" target="_blank" rel="noopener">Claim Provenance Engine</a>
</footer>

</div>

<script>
const SAMPLE = {
  url: "https://example.com/2026/coffee-study",
  title: "New study finds coffee lowers heart-disease risk by 25%",
  page_text: \`A new study published this week claims that drinking three cups of coffee per day reduces cardiovascular disease risk by 25%, according to researchers at the University of Cambridge. The study, which followed 50,000 participants over a decade, was funded in part by the National Coffee Association. "These findings should encourage moderate coffee consumption as part of a heart-healthy diet," said lead author Dr. Jane Smith. Critics have noted that the funding source raises potential conflict-of-interest concerns, and that earlier meta-analyses found a smaller 5–10% effect that disappeared when controlling for socioeconomic factors. The study was published in the Journal of Cardiovascular Research.\`,
};

const $ = (id) => document.getElementById(id);
const status = $("status");
const results = $("results");

$("sample").addEventListener("click", () => {
  $("url").value = SAMPLE.url;
  $("title").value = SAMPLE.title;
  $("page_text").value = SAMPLE.page_text;
  status.textContent = "Sample loaded. Click Analyze.";
});

$("clear").addEventListener("click", () => {
  $("url").value = "";
  $("title").value = "";
  $("page_text").value = "";
  results.innerHTML = '<div class="empty">No analysis yet.</div>';
  status.textContent = "";
});

$("go").addEventListener("click", async () => {
  const url = $("url").value.trim();
  const title = $("title").value.trim();
  const page_text = $("page_text").value.trim();

  if (!url || !title || !page_text) {
    status.textContent = "URL, title, and article text are all required.";
    return;
  }

  $("go").disabled = true;
  status.innerHTML = '<span class="spin"></span>Analyzing… (typically 10–30s)';
  results.innerHTML = '<div class="empty">Working…</div>';

  const t0 = Date.now();
  try {
    const res = await fetch("/v1/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title, page_text, page_links: [] }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.message || res.statusText;
      throw new Error(\`HTTP \${res.status}: \${msg}\`);
    }
    render(data, Date.now() - t0);
    status.textContent = \`Done in \${((Date.now() - t0) / 1000).toFixed(1)}s\`;
  } catch (err) {
    results.innerHTML = '<div class="err">' + escapeHtml(String(err.message || err)) + '</div>';
    status.textContent = "Error";
  } finally {
    $("go").disabled = false;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function render(data, clientMs) {
  if (!data?.claims?.length) {
    results.innerHTML = '<div class="empty">No claims extracted from this article.</div>';
    return;
  }

  const chainsByClaim = new Map((data.chains || []).map((c) => [c.claim_id, c]));
  const cards = data.claims.map((claim) => {
    const chain = chainsByClaim.get(claim.id);
    const status = chain?.status || "unknown";
    const nodes = (chain?.nodes || []).map((n) => \`
      <div class="node">
        <div class="node-title">
          \${n.url ? \`<a href="\${escapeHtml(n.url)}" target="_blank" rel="noopener">\${escapeHtml(n.title || n.url)}</a>\` : escapeHtml(n.title || "(no title)")}
        </div>
        <div class="node-meta">\${escapeHtml(n.publisher || "")} \${n.published_date ? "· " + escapeHtml(n.published_date) : ""} \${n.type ? "· " + escapeHtml(n.type) : ""}</div>
        \${n.snippet ? '<div class="node-snippet">' + escapeHtml(n.snippet) + '</div>' : ""}
      </div>
    \`).join("");
    return \`
      <div class="claim">
        <p class="claim-text">\${escapeHtml(claim.text)}</p>
        <div class="badges">
          <span class="badge status \${escapeHtml(status)}">\${escapeHtml(status.replace(/_/g, " "))}</span>
          \${claim.category ? '<span class="badge cat">' + escapeHtml(claim.category) + '</span>' : ""}
          \${claim.importance ? '<span class="badge imp">importance ' + claim.importance + '</span>' : ""}
        </div>
        \${chain?.notes ? '<div class="chain-notes">' + escapeHtml(chain.notes) + '</div>' : ""}
        \${nodes ? '<div class="nodes">' + nodes + '</div>' : ""}
      </div>
    \`;
  }).join("");

  const m = data.meta || {};
  const stats = \`
    <div class="stats">
      <span><strong>\${data.claims.length}</strong> claims</span>
      <span><strong>\${m.search_queries ?? 0}</strong> searches</span>
      <span><strong>\${m.tokens_used ?? 0}</strong> tokens</span>
      <span><strong>\${(((m.ms ?? clientMs)) / 1000).toFixed(1)}s</strong> server</span>
      \${data.request_id ? '<span>request_id <strong>' + escapeHtml(data.request_id) + '</strong></span>' : ""}
    </div>\`;

  results.innerHTML = cards + stats;
}
</script>
</body>
</html>`;
