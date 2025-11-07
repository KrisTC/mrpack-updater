const MAX_CONCURRENCY = 6;
const $ = (id) => document.getElementById(id);

const fileInput = $("file");
const runBtn = $("run");
const buildBtn = $("build");
const dlLink = $("downloadLink");
const buildNote = $("buildNote");

const mcSelect = $("mc");
const loaderSelect = $("loader");
const outSummary = $("summary");
const outRaw = $("raw");
const bar = $("bar");
const phase = $("phase");
const detail = $("detail");

const modsTable = $("mods-table");
const resTable = $("res-table");
const shaderTable = $("shader-table");

let LAST_ROWS = [];
let LAST_INDEX = null;
let LAST_ZIP = null;
let LAST_TARGET_MC = "";
let LAST_PACK_NAME = "";
let LAST_SELECTED_LOADER = "fabric";
let PROJECTID_TO_ORIGFILE = new Map();

/* ---------- THEME LOGIC (working) ---------- */
const THEME_KEY = "mrpack_checker_theme";
const themeBtns = {
  system: $("theme-system"),
  light: $("theme-light"),
  dark: $("theme-dark"),
};

function setThemeAttr(val) {
  document.documentElement.setAttribute("data-theme", val);
  localStorage.setItem(THEME_KEY, val);
  // update active styles
  Object.keys(themeBtns).forEach(k => themeBtns[k].classList.toggle("active", k === val));
}

(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "system";
  setThemeAttr(saved);
  // If user switches OS theme later and we're on "system", CSS updates automatically via media query
})();

themeBtns.system.addEventListener("click", () => setThemeAttr("system"));
themeBtns.light.addEventListener("click", () => setThemeAttr("light"));
themeBtns.dark.addEventListener("click", () => setThemeAttr("dark"));

/* ---------- HELP MODAL ---------- */
const helpBtn = $("help-btn");
const helpModal = $("help-modal");
const helpClose = $("help-close");

helpBtn.addEventListener("click", () => {
  helpModal.style.display = "flex";
});

helpClose.addEventListener("click", () => {
  helpModal.style.display = "none";
});

// Close modal when clicking outside
helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) {
    helpModal.style.display = "none";
  }
});

// Close modal with Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && helpModal.style.display === "flex") {
    helpModal.style.display = "none";
  }
});

/* ---------- UI helpers ---------- */
function setPhase(name, extra = "") {
  phase.textContent = name;
  detail.textContent = extra;
}
function setBar(current, total) {
  const pct = total ? Math.floor((current / total) * 100) : 0;
  bar.style.width = pct + "%";
}
function resetProgress() {
  setPhase("Idle");
  setBar(0, 1);
  outSummary.textContent = "";
}
function updateTitle(packName = null) {
  const baseTitle = "mrpack upgrader for Modrinth";
  document.title = packName ? `${packName} - ${baseTitle}` : baseTitle;
}

/* ---------- Populate MC versions dynamically ---------- */
(async function populateMcVersions(){
  try {
    mcSelect.disabled = true;
    mcSelect.innerHTML = `<option>Loading…</option>`;
    const res = await fetch("https://api.modrinth.com/v2/tag/game_version");
    if (!res.ok) throw new Error("Failed to fetch game versions");
    const tags = await res.json();

    const clean = tags
      .map(t => t.version || t)
      .filter(v => /^\d+\.\d+(\.\d+)?$/.test(v));

    clean.sort((a, b) => {
      const pa = a.split('.').map(n=>parseInt(n,10));
      const pb = b.split('.').map(n=>parseInt(n,10));
      while (pa.length < 3) pa.push(0);
      while (pb.length < 3) pb.push(0);
      for (let i=0;i<3;i++){ if (pb[i] !== pa[i]) return pb[i]-pa[i]; }
      return 0;
    });

    mcSelect.innerHTML = clean.map(v => `<option value="${v}">${v}</option>`).join("");
    mcSelect.disabled = false;
  } catch (e) {
    mcSelect.innerHTML = `<option value="1.21.4">1.21.4</option>`;
    mcSelect.disabled = false;
    console.warn("Falling back to static MC version list:", e);
  }
})();

/* ---------- GitHub fallback for Fabric Carpet only ---------- */
function escReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function fetchCarpetGitHubRelease(targetMc, { includePrereleases = false } = {}) {
  const res = await fetch("https://api.github.com/repos/gnembon/fabric-carpet/releases", {
    headers: { "Accept": "application/vnd.github+json" }
  });
  if (!res.ok) return null;
  const releases = await res.json();
  const mcRe = new RegExp(`(^|\\b|-)${escReg(targetMc)}(\\b|-)`);
  for (const r of releases) {
    if (r.draft) continue;
    if (!includePrereleases && r.prerelease) continue;
    const asset = (r.assets || []).find(a =>
      /\.jar$/i.test(a.name) &&
      /fabric-?carpet/i.test(a.name) &&
      mcRe.test(a.name)
    );
    if (asset) {
      return {
        version_number: r.tag_name || asset.name,
        date_published: r.published_at || r.created_at || null,
        download_url: asset.browser_download_url,
        source: "github-fallback"
      };
    }
  }
  return null;
}

/* ---------- Prefer primary file from a version ---------- */
function pickPrimaryFile(version) {
  if (!version || !Array.isArray(version.files) || !version.files.length) return null;
  return version.files.find(f => f.primary) || version.files[0];
}

/* ---------- Main flow (check) ---------- */
runBtn.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) { alert("Choose a .mrpack file first."); return; }
  const TARGET_MC = mcSelect.value;
  const PACK_LOADER = loaderSelect.value;
  LAST_SELECTED_LOADER = PACK_LOADER;

  resetProgress();
  updateTitle(); // Reset title to base title
  modsTable.innerHTML = resTable.innerHTML = shaderTable.innerHTML = "";
  outRaw.textContent = "";
  buildBtn.disabled = true; dlLink.style.display = "none"; buildNote.textContent = "";

  try {
    setPhase("Reading pack…");
    const zipAb = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(zipAb);
    LAST_ZIP = zip;

    const indexFile = zip.file("modrinth.index.json");
    if (!indexFile) { setPhase("Error"); detail.textContent = "No modrinth.index.json"; return; }
    const index = JSON.parse(await indexFile.async("string"));
    LAST_INDEX = index;
    LAST_PACK_NAME = index?.name || "Updated Pack";
    
    // Update page title with pack name
    updateTitle(LAST_PACK_NAME);

    const PACK_MC = index?.dependencies?.minecraft || "-";

    // collect sha1s and keep a mapping to original index file entries
    const sha1ToPath = new Map();
    const sha1s = [];
    const sha1ToFileObj = new Map();
    for (const f of index.files || []) {
      const sha1 = f?.hashes?.sha1;
      if (sha1) {
        sha1s.push(sha1);
        sha1ToPath.set(sha1, f.path || "");
        sha1ToFileObj.set(sha1, f);
      }
    }
    if (!sha1s.length) { setPhase("Done"); detail.textContent = "No file hashes in pack."; return; }

    outSummary.textContent = `Found ${sha1s.length} entries. Resolving projects…`;
    setBar(1, 5);

    // Step 2: hashes -> versions
    setPhase("Resolving versions from hashes…");
    const versionMap = await fetch("https://api.modrinth.com/v2/version_files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hashes: sha1s, algorithm: "sha1" })
    }).then(r => r.json());
    setBar(2, 5);

    // Step 3: collapse to unique projects and detect category, and remember original file obj per project
    setPhase("Collapsing to projects…");
    PROJECTID_TO_ORIGFILE = new Map();
    const projectEntries = new Map(); // project_id -> { anyVersion, exampleSha1, category }
    for (const [sha1, ver] of Object.entries(versionMap)) {
      if (!ver || !ver.project_id) continue;
      if (!projectEntries.has(ver.project_id)) {
        const path = sha1ToPath.get(sha1) || "";
        const category = path.startsWith("resourcepacks/") ? "resourcepack"
                       : path.startsWith("shaderpacks/")    ? "shaderpack"
                       : "mod";
        projectEntries.set(ver.project_id, { anyVersion: ver, exampleSha1: sha1, category });
        PROJECTID_TO_ORIGFILE.set(ver.project_id, sha1ToFileObj.get(sha1));
      }
    }
    const projectIds = [...projectEntries.keys()];
    if (!projectIds.length) {
      setPhase("Done"); detail.textContent = "No projects resolved."; outRaw.textContent = JSON.stringify(versionMap, null, 2); return;
    }
    setBar(3, 5);

    // Helpers
    function loaderForCategory(cat) {
      return (cat === "resourcepack" || cat === "shaderpack") ? "minecraft" : PACK_LOADER;
    }
    async function getProject(projectId) {
      const r = await fetch(`https://api.modrinth.com/v2/project/${projectId}`);
      if (!r.ok) return null;
      return r.json();
    }
    async function getBestTargetVersion(projectId, mc, loader) {
      const url = new URL(`https://api.modrinth.com/v2/project/${projectId}/version`);
      url.searchParams.set("game_versions", JSON.stringify([mc]));
      url.searchParams.set("loaders", JSON.stringify([loader]));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`versions ${projectId}: ${res.status}`);
      const arr = await res.json();
      if (!Array.isArray(arr) || !arr.length) return null;
      const tier = v => v.version_type === "release" ? 3 : v.version_type === "beta" ? 2 : 1;
      arr.sort((a, b) => {
        const t = tier(b) - tier(a);
        if (t) return t;
        return new Date(b.date_published) - new Date(a.date_published);
      });
      return arr[0];
    }

    async function mapLimitProgress(items, limit, fn, onTick) {
      const out = new Array(items.length);
      let i = 0, done = 0;
      const running = new Set();
      async function run(idx) {
        const p = fn(items[idx]).then(v => out[idx] = v).finally(() => {
          running.delete(p);
          done++; onTick?.(done, items.length);
        });
        running.add(p);
        await p;
      }
      while (i < items.length) {
        while (running.size < limit && i < items.length) await run(i++);
        if (running.size) await Promise.race(running);
      }
      return out;
    }

    // Step 4: fetch project info + best target version, with progress (+ Carpet fallback only if Modrinth missing)
    setPhase("Checking target availability…", `0 / ${projectIds.length}`);
    const rows = await mapLimitProgress(
      projectIds,
      MAX_CONCURRENCY,
      async (pid) => {
        const rep = projectEntries.get(pid)?.anyVersion;
        const cat = projectEntries.get(pid)?.category || "mod";
        const loader = loaderForCategory(cat);
        const [proj, bestModrinth] = await Promise.all([
          getProject(pid),
          getBestTargetVersion(pid, TARGET_MC, loader)
        ]);

        let best = bestModrinth;
        let source = bestModrinth ? "modrinth" : "none";

        // Carpet fallback (only if Modrinth has no target build)
        const isCarpet = (proj?.slug === "fabric-carpet") || (pid === "TQTTVgYE");
        if (!bestModrinth && isCarpet) {
          const gh = await fetchCarpetGitHubRelease(TARGET_MC);
          if (gh) { best = gh; source = "github-fallback"; }
        }

        // Cache file metadata (only for Modrinth results)
        let fmeta = null;
        if (bestModrinth) fmeta = pickPrimaryFile(bestModrinth);

        // Build project URL for badge link
        const typePath =
          (proj?.project_type === "mod" || cat === "mod") ? "mod" :
          (proj?.project_type === "resourcepack" || cat === "resourcepack") ? "resourcepack" :
          (proj?.project_type === "shader" || cat === "shaderpack") ? "shader" :
          "project";
        const project_url = proj?.slug
          ? `https://modrinth.com/${typePath}/${proj.slug}`
          : `https://modrinth.com/project/${pid}`;

        return {
          project_id: pid,
          project_url,
          category: cat,
          name: proj?.title || rep?.name || "(unknown)",
          slug: proj?.slug,
          current_version_number: rep?.version_number || "-",
          current_mc: PACK_MC,
          target_loader: loader,
          target_available: !!best,
          target_version_number: best?.version_number || "-",
          target_mc: TARGET_MC,
          target_date: best?.date_published || null,
          download_url: best?.files?.[0]?.url || best?.download_url || null,
          source,
          // cached file meta for builder
          target_file_sha1:   fmeta?.hashes?.sha1 || null,
          target_file_sha512: fmeta?.hashes?.sha512 || null,
          target_file_size:   Number.isFinite(fmeta?.size) ? fmeta.size : null,
          target_file_url:    fmeta?.url || null,
          target_file_name:   fmeta?.filename || null
        };
      },
      (done, total) => {
        setPhase("Checking target availability…", `${done} / ${total}`);
        const stepBase = 3;
        const stepWidth = done / total;
        setBar(stepBase + stepWidth, 5);
      }
    );

    // Step 5: render & enable builder
    setPhase("Rendering results…");
    renderPartitionedTables(rows);
    outRaw.textContent = JSON.stringify(rows, null, 2);

    const total = rows.length;
    const have = rows.filter(r => r.target_available).length;
    outSummary.textContent = `Done. ${have}/${total} have a ${TARGET_MC} build.`;
    setBar(5, 5);
    setPhase("Done");

    LAST_ROWS = rows;
    LAST_TARGET_MC = TARGET_MC;
    buildBtn.disabled = false;
    buildNote.textContent = "Ready to build a new .mrpack from Modrinth results.";
  } catch (err) {
    console.error(err);
    setPhase("Error", err?.message || String(err));
  }
});

function renderPartitionedTables(rows) {
  const mods = rows.filter(r => r.category === "mod");
  const res  = rows.filter(r => r.category === "resourcepack");
  const sh   = rows.filter(r => r.category === "shaderpack");
  $("mods-table").innerHTML   = renderTable(mods);
  $("res-table").innerHTML    = renderTable(res);
  $("shader-table").innerHTML = renderTable(sh);
}

function renderTable(rows) {
  if (!rows?.length) return `<div class="muted">No entries.</div>`;
  const targetMc = rows[0]?.target_mc || "(target)";
  const html = [
    "<table>",
    "<thead><tr>",
    "<th>Name</th>",
    "<th>Current mod</th>",
    "<th>Current MC</th>",
    "<th>Loader</th>",
    `<th>Has ${escapeHtml(targetMc)}</th>`,
    "<th>Target mod</th>",
    "<th>Source</th>",
    "<th>Published</th>",
    "<th>Download</th>",
    "</tr></thead><tbody>",
    ...rows.map(r => {
      const ok = r.target_available;
      const date = r.target_date ? new Date(r.target_date).toLocaleDateString() : "-";
      const dl = r.download_url ? `<a href="${r.download_url}" target="_blank" rel="noreferrer">.jar</a>` : "";
      const sourceBadge =
        r.source === "github-fallback"
          ? `<a class="badge github-fallback" href="https://github.com/gnembon/fabric-carpet/releases" target="_blank" rel="noreferrer" title="Found on GitHub because Modrinth had no ${escapeHtml(r.target_mc)} build">GitHub fallback</a>`
          : (r.source === "modrinth" && r.target_file_sha512)
            ? `<a class="badge modrinth" href="${escapeHtml(r.project_url)}" target="_blank" rel="noreferrer"
                 title="Open on Modrinth — included in .mrpack">Modrinth</a>`
            : `<span class="badge" title="No match">–</span>`;
      return `<tr>
        <td>${escapeHtml(r.name || "(unknown)")}</td>
        <td>${escapeHtml(r.current_version_number)}</td>
        <td>${escapeHtml(r.current_mc)}</td>
        <td>${escapeHtml(r.target_loader || "-")}</td>
        <td class="${ok ? "ok" : "no"}">${ok ? "✅" : "❌"}</td>
        <td>${escapeHtml(r.target_version_number)}</td>
        <td>${sourceBadge}</td>
        <td>${date}</td>
        <td>${dl}</td>
      </tr>`;
    }),
    "</tbody></table>"
  ].join("");
  return html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/* ---------- Loader version lookup (Fabric) ---------- */
async function getRecommendedLoaderVersion(targetMc, loaderName) {
  if (loaderName !== "fabric") return null; // only fabric for now
  try {
    setPhase("Fetching loader version…");
    const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(targetMc)}`);
    if (!res.ok) throw new Error(`fabric meta ${res.status}`);
    const arr = await res.json();
    const stable = Array.isArray(arr) ? arr.find(x => x?.loader?.stable) : null;
    const pick = stable || (Array.isArray(arr) ? arr[0] : null);
    const ver = pick?.loader?.version || null;
    return ver;
  } catch (e) {
    console.warn("Fabric Meta lookup failed:", e);
    return null;
  }
}

/* ---------- MRPACK BUILDER (uses cached file metadata) ---------- */
buildBtn.addEventListener("click", async () => {
  if (!LAST_ROWS.length || !LAST_INDEX || !LAST_ZIP) {
    alert("Run a check first.");
    return;
  }

  buildBtn.disabled = true;
  dlLink.style.display = "none";
  buildNote.textContent = "Building .mrpack…";
  setPhase("Packaging mrpack…");
  setBar(4, 5);

  try {
    // Only include rows with Modrinth source and cached file meta
    const includable = LAST_ROWS.filter(r =>
      r.target_available &&
      r.source === "modrinth" &&
      r.target_file_sha512 && r.target_file_sha1 &&
      r.target_file_size && r.target_file_url
    );

    const fileRecords = [];
    for (const row of includable) {
      const of = PROJECTID_TO_ORIGFILE.get(row.project_id) || {};
      const path = of.path || inferPathFromCategory(row);
      const env  = of.env || { client: "required", server: "required" };
      fileRecords.push({
        path,
        hashes: { sha512: row.target_file_sha512, sha1: row.target_file_sha1 },
        env,
        downloads: [row.target_file_url],
        fileSize: row.target_file_size
      });
    }

    // Build new index
    const newIndex = structuredClone(LAST_INDEX);
    newIndex.dependencies = Object.assign({}, newIndex.dependencies, { minecraft: LAST_TARGET_MC });

    // If selected loader is fabric, set fabric-loader to recommended version for target MC
    let loaderNote = "";
    if (LAST_SELECTED_LOADER === "fabric") {
      const rec = await getRecommendedLoaderVersion(LAST_TARGET_MC, "fabric");
      if (rec) {
        newIndex.dependencies["fabric-loader"] = rec;
        loaderNote = `Fabric Loader set to ${rec}.`;
      } else {
        if (newIndex.dependencies["fabric-loader"]) {
          loaderNote = `Kept existing Fabric Loader ${newIndex.dependencies["fabric-loader"]} (meta lookup failed).`;
        } else {
          loaderNote = `Fabric Loader not set (meta lookup failed).`;
        }
      }
    }

    newIndex.name = `${(LAST_PACK_NAME || "Pack").replace(/\s+$/, "")} (for ${LAST_TARGET_MC})`;
    newIndex.files = fileRecords;

    // Package: copy overrides/ + write index
    const outZip = new JSZip();

    const overrideEntries = Object.values(LAST_ZIP.files).filter(e => e.name.startsWith("overrides/") && !e.dir);
    for (const e of overrideEntries) {
      const content = await LAST_ZIP.file(e.name).async("arraybuffer");
      outZip.file(e.name, content);
    }
    outZip.file("modrinth.index.json", JSON.stringify(newIndex, null, 2));

    const blob = await outZip.generateAsync({ type: "blob" });
    const fileName = `${slugify(newIndex.name)}.mrpack`;

    const url = URL.createObjectURL(blob);
    dlLink.href = url;
    dlLink.download = fileName;
    dlLink.textContent = `Download ${fileName}`;
    dlLink.style.display = "inline";

    // Warn about excluded rows (GitHub fallback / missing meta)
    const skipped = LAST_ROWS.filter(r =>
      r.target_available &&
      (r.source !== "modrinth" || !(r.target_file_sha512 && r.target_file_sha1 && r.target_file_size && r.target_file_url))
    );

    if (!skipped.length) {
      buildNote.textContent = `Built from all available Modrinth versions. ${loaderNote}`;
    } else {
      const names = skipped.map(r => r.name || r.slug || r.project_id).join(", ");
      buildNote.innerHTML =
        `Built pack excludes ${skipped.length} item(s) without Modrinth-downloadable metadata (e.g., GitHub fallback): ` +
        `<span class="muted">${escapeHtml(names)}</span>. ${escapeHtml(loaderNote)}`;
    }

    setBar(5, 5);
    setPhase("Done");
  } catch (e) {
    console.error(e);
    buildNote.textContent = `Build failed: ${e.message || e}`;
    setPhase("Error", e.message || String(e));
  } finally {
    buildBtn.disabled = false;
  }
});

function inferPathFromCategory(row) {
  if (row.category === "resourcepack") return `resourcepacks/${(row.slug || "resourcepack")}.zip`;
  if (row.category === "shaderpack")   return `shaderpacks/${(row.slug || "shaderpack")}.zip`;
  return `mods/${(row.slug || "mod")}.jar`;
}

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}