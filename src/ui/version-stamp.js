// "Updated <date, time>" under the lab logo: when the latest change to the slicer was published.
//
// The site is static (no build step to stamp a date into), so the page asks GitHub for the newest commit
// on the main branch and shows its time in the viewer's own time zone. The answer is cached for 10 minutes
// so reloading doesn't use up GitHub's anonymous rate limit (60 requests an hour per address). If GitHub
// can't be reached, it falls back to the Last-Modified time of this page; if that is unknown too, nothing
// is shown rather than a wrong time.
const REPO = 'anqua/LDM-slicer';
const BRANCH = 'main';
const CACHE_KEY = 'ldm.latestCommit.v1';
const CACHE_MS = 10 * 60 * 1000;

const format = d => new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
}).format(d);

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return c && Date.now() - c.fetchedAt < CACHE_MS ? c : null;
  } catch { return null; }
}
const writeCache = c => { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...c, fetchedAt: Date.now() })); } catch { /* storage unavailable */ } };

async function latestCommit() {
  const cached = readCache();
  if (cached) return cached;
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error('GitHub answered ' + r.status);
  const j = await r.json();
  const c = { iso: j.commit.committer.date, sha: j.sha.slice(0, 7), source: 'latest commit on GitHub' };
  writeCache(c);
  return c;
}

/** Last-Modified of this page as served (GitHub Pages sets it to the time of the deploy). */
async function pageLastModified() {
  const r = await fetch(location.pathname, { method: 'HEAD', cache: 'no-cache' });
  const h = r.headers.get('last-modified');
  const d = h && new Date(h);
  return d && !isNaN(d) ? { iso: d.toISOString(), sha: '', source: 'page last modified' } : null;
}

export async function initVersionStamp() {
  const el = document.getElementById('updated');
  if (!el) return;
  let info = null;
  try { info = await latestCommit(); } catch { /* offline or rate limited: try the fallback */ }
  if (!info) { try { info = await pageLastModified(); } catch { /* nothing to show */ } }
  const d = info && new Date(info.iso);
  if (!d || isNaN(d)) return;                                    // stays hidden
  el.textContent = 'Updated ' + format(d);
  el.title = `${info.source}${info.sha ? ' (' + info.sha + ')' : ''} · ${d.toISOString()}`;
  el.hidden = false;
}
