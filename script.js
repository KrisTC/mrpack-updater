const MAX_CONCURRENCY = 6;
const $ = (id) => document.getElementById(id);

const fileInput = $("file");
const fileName = $("file-name");
const runBtn = $("run");
const buildBtn = $("build");
const buildControls = $("build-controls");
const captureMissingBtn = $("capture-missing");
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

/* ---------- UTILITY FUNCTIONS ---------- */
function parseVersion(versionStr) {
  const parts = versionStr.split('.').map(n => parseInt(n, 10));
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pb[i] !== pa[i]) return pb[i] - pa[i];
  }
  return 0;
}

function parseModpackNames(modpackString) {
  if (!modpackString || typeof modpackString !== 'string') {
    return [];
  }
  return modpackString.split(', ').map(mp => mp.trim());
}

// Helper function to get default loader for a category
// NOTE: This should only be used as a fallback when project data is not available.
// Always prefer getting the correct loader from the original project data using getLoaderForProject().
function getDefaultLoaderForCategory(category) {
  switch (category) {
    case "mod":
      return "fabric";
    case "shaderpack":
      return "iris";
    case "resourcepack":
    default:
      return "minecraft";
  }
}

/* ---------- COMMON MODRINTH UTILITIES ---------- */

/**
 * Fetch versions for a Modrinth project with specific MC version and loader filters
 * @param {string} projectId - The Modrinth project ID
 * @param {string} mc - Target Minecraft version
 * @param {string} loader - Target loader (e.g., "fabric", "minecraft")
 * @param {string} [projectName] - Optional project name for debugging
 * @returns {Promise<Array|null>} - Array of version objects or null on error
 */
async function fetchModrinthVersions(projectId, mc, loader, projectName = null) {
  try {
    console.log(`[DEBUG] Fetching versions for project ${projectId}${projectName ? ` (${projectName})` : ''} - MC: ${mc}, Loader: ${loader}`);
    
    const url = new URL(`https://api.modrinth.com/v2/project/${projectId}/version`);
    url.searchParams.set("game_versions", JSON.stringify([mc]));
    url.searchParams.set("loaders", JSON.stringify([loader]));

    const res = await fetch(url);
    if (!res.ok) {
      const projectLabel = projectName ? ` (${projectName})` : '';
      console.warn(`Failed to fetch versions for ${projectId}${projectLabel}: ${res.status}`);
      return null;
    }

    const versions = await res.json();
    console.log(`  [DEBUG] Found ${versions.length} versions for project ${projectId}${projectName ? ` (${projectName})` : ''}`);
    return Array.isArray(versions) ? versions : null;
  } catch (e) {
    const projectLabel = projectName ? ` (${projectName})` : '';
    console.warn(`Error fetching versions for ${projectId}${projectLabel}:`, e);
    return null;
  }
}

/**
 * Batch fetch project metadata for multiple projects
 * @param {string[]} projectIds - Array of Modrinth project IDs
 * @returns {Promise<Map<string, Object>>} - Map of projectId -> project metadata
 */
async function getProjectsBatch(projectIds) {
  if (!projectIds.length) return new Map();

  try {
    const url = new URL('https://api.modrinth.com/v2/projects');
    url.searchParams.set('ids', JSON.stringify(projectIds));

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Failed to batch fetch projects: ${res.status}`);
      return new Map();
    }

    const projects = await res.json();
    return new Map(projects.map(p => [p.id, p]));
  } catch (e) {
    console.warn('Error batch fetching projects:', e);
    return new Map();
  }
}

/**
 * Resolve a Modrinth project ID from a project name
 * @param {string} name - The project name to search for
 * @param {string} category - Project category ("mod", "resourcepack", "shaderpack")
 * @returns {Promise<string|null>} - The project ID or null if not found
 */
async function resolveProjectIdFromName(name, category) {
  const loader = getDefaultLoaderForCategory(category);

  try {
    const searchUrl = new URL("https://api.modrinth.com/v2/search");
    searchUrl.searchParams.set("query", name);
    searchUrl.searchParams.set("limit", "10");

    const searchRes = await fetch(searchUrl);
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const hits = searchData.hits || [];

      // Look for exact or close name matches
      for (const hit of hits) {
        if (hit.title.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(hit.title.toLowerCase())) {
          // Verify this project has some versions (basic validation)
          try {
            const versionUrl = new URL(`https://api.modrinth.com/v2/project/${hit.project_id}/version`);
            versionUrl.searchParams.set("game_versions", JSON.stringify(["1.20.1"])); // Use a common version for validation
            versionUrl.searchParams.set("loaders", JSON.stringify([loader]));
            versionUrl.searchParams.set("limit", "1");

            const versionRes = await fetch(versionUrl);
            if (versionRes.ok) {
              const versions = await versionRes.json();
              if (Array.isArray(versions) && versions.length > 0) {
                return hit.project_id; // Found a valid project
              }
            }
          } catch (e) {
            console.warn(`Failed to validate project ${hit.project_id}:`, e);
          }
        }
      }
    }
  } catch (e) {
    console.warn(`Failed to resolve project ID for ${name}:`, e);
  }
  return null;
}

/**
 * Check if a Modrinth project has any compatible versions for the given MC version and loader
 * @param {string} projectId - The Modrinth project ID
 * @param {string} targetMc - Target Minecraft version
 * @param {string} loader - Target loader (e.g., "fabric", "minecraft")
 * @param {string} [projectName] - Optional project name for debugging
 * @returns {Promise<boolean>} - True if compatible versions exist
 */
async function checkModrinthVersionAvailability(projectId, targetMc, loader, projectName = null) {
  const versions = await fetchModrinthVersions(projectId, targetMc, loader, projectName);
  return versions && versions.length > 0;
}

/**
 * Get the best target version for a Modrinth project
 * @param {string} projectId - The Modrinth project ID
 * @param {string} mc - Target Minecraft version
 * @param {string} loader - Target loader (e.g., "fabric", "minecraft")
 * @param {string} [projectName] - Optional project name for debugging
 * @returns {Promise<Object|null>} - Best version object or null if none found
 */
async function getBestTargetVersion(projectId, targetMc, loader, projectName = null) {
  const versions = await fetchModrinthVersions(projectId, targetMc, loader, projectName);
  if (!versions || !versions.length) return null;

  const tier = v => v.version_type === "release" ? 3 : v.version_type === "beta" ? 2 : 1;
  versions.sort((a, b) => {
    const t = tier(b) - tier(a);
    if (t) return t;
    return new Date(b.date_published) - new Date(a.date_published);
  });
  return versions[0];
}

/* ---------- MODPACK CLASS ---------- */
class Modpack {
  constructor() {
    this.reset();
  }

  reset() {
    this.name = "";
    this.packName = ""; // Alias for name, used for missing items
    this.targetMc = "";
    this.selectedLoader = "fabric";
    this.index = null;
    this.zip = null;
    this.rows = [];
    this.projectIdToOrigFile = new Map();
  }

  setMetadata(name, targetMc, loader) {
    this.name = name;
    this.packName = name; // Keep packName in sync with name
    this.targetMc = targetMc;
    this.selectedLoader = loader;
  }

  setData(index, zip, rows, projectIdToOrigFile) {
    this.index = index;
    this.zip = zip;
    this.rows = rows || [];
    this.projectIdToOrigFile = projectIdToOrigFile || new Map();
  }

  hasData() {
    return this.rows.length > 0 && this.index && this.zip;
  }

  getMissingItems() {
    return this.rows.filter(row => !row.target_available);
  }

  getAvailableItems() {
    return this.rows.filter(row => row.target_available);
  }

  getSummary() {
    const total = this.rows.length;
    const available = this.getAvailableItems().length;
    return { total, available, missing: total - available };
  }

  // Analysis method (moved from standalone function)
  async analyze(file, targetMc, packLoader) {
    setPhase("Reading pack…");
    const zipAb = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(zipAb);
    this.zip = zip;

    const indexFile = zip.file("modrinth.index.json");
    if (!indexFile) { setPhase("Error"); detail.textContent = "No modrinth.index.json"; return null; }
    const index = JSON.parse(await indexFile.async("string"));
    this.index = index;
    this.name = index?.name || "Updated Pack";
    this.packName = this.name; // Keep packName in sync

    // Update page title with pack name
    updateTitle(this.name);

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
    if (!sha1s.length) { setPhase("Done"); detail.textContent = "No file hashes in pack."; return null; }

    outSummary.textContent = `Found ${sha1s.length} entries. Resolving projects…`;
    setBar(1, 6);

    // Step 2: hashes -> versions
    setPhase("Resolving versions from hashes…");
    const versionMap = await fetch("https://api.modrinth.com/v2/version_files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hashes: sha1s, algorithm: "sha1" })
    }).then(r => r.json());
    setBar(2, 6);

    // Step 3: collapse to unique projects and detect category, and remember original file obj per project
    setPhase("Collapsing to projects…");
    this.projectIdToOrigFile = new Map();
    const projectEntries = new Map(); // project_id -> { anyVersion, exampleSha1, category }
    for (const [sha1, ver] of Object.entries(versionMap)) {
      if (!ver || !ver.project_id) continue;
      if (!projectEntries.has(ver.project_id)) {
        const path = sha1ToPath.get(sha1) || "";
        const category = path.startsWith("resourcepacks/") ? "resourcepack"
                       : path.startsWith("shaderpacks/")    ? "shaderpack"
                       : "mod";
        projectEntries.set(ver.project_id, { anyVersion: ver, exampleSha1: sha1, category });
        this.projectIdToOrigFile.set(ver.project_id, sha1ToFileObj.get(sha1));
      }
    }
    const projectIds = [...projectEntries.keys()];
    if (!projectIds.length) {
      setPhase("Done"); detail.textContent = "No projects resolved."; outRaw.textContent = JSON.stringify(versionMap, null, 2); return null;
    }
    setBar(3, 6);

    // Helpers
    function getLoaderForProject(proj, cat, packLoader) {
      // For mods, use the pack loader (fabric, etc.)
      if (cat === "mod") {
        console.log(`[DEBUG] Using pack loader '${packLoader}' for mod category`);
        return packLoader;
      }
      
      // For resourcepacks and shaderpacks, use the project's actual loaders if available
      // Otherwise fall back to category defaults
      if (proj?.loaders && Array.isArray(proj.loaders) && proj.loaders.length > 0) {
        const selectedLoader = proj.loaders[0];
        console.log(`[DEBUG] Using project loader '${selectedLoader}' for ${cat} (available: ${proj.loaders.join(', ')})`);
        return selectedLoader; // Use first available loader
      }
      
      // Fallback if no project data available
      const fallbackLoader = (cat === "resourcepack" || cat === "shaderpack") ? "minecraft" : packLoader;
      console.log(`[DEBUG] No project loaders found, using fallback '${fallbackLoader}' for ${cat}`);
      return fallbackLoader;
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
    setPhase("Fetching project metadata…");
    const projectMap = await getProjectsBatch(projectIds);
    setBar(4, 6);
    setPhase("Checking target availability…", `0 / ${projectIds.length}`);
    const rows = await mapLimitProgress(
      projectIds,
      MAX_CONCURRENCY,
      async (pid) => {
        const rep = projectEntries.get(pid)?.anyVersion;
        const cat = projectEntries.get(pid)?.category || "mod";
        const proj = projectMap.get(pid);
        const loader = getLoaderForProject(proj, cat, packLoader);
        const bestModrinth = await getBestTargetVersion(pid, targetMc, loader, rep?.name);

        let best = bestModrinth;
        let source = proj ? "modrinth" : "none";

        // Carpet fallback (only if Modrinth has no target build)
        const isCarpet = (proj?.slug === "fabric-carpet") || (pid === "TQTTVgYE");
        if (!bestModrinth && isCarpet) {
          const gh = await fetchCarpetGitHubRelease(targetMc);
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
          target_mc: targetMc,
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
        const stepBase = 4;
        const stepWidth = done / total;
        setBar(stepBase + stepWidth, 6);
      }
    );

    this.rows = rows;
    this.targetMc = targetMc;
    this.selectedLoader = packLoader;

    return rows;
  }

  // Build method (moved from buildBtn event listener)
  async build() {
    if (!this.hasData()) {
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
      const includable = this.rows.filter(r =>
        r.target_available &&
        r.source === "modrinth" &&
        r.target_file_sha512 && r.target_file_sha1 &&
        r.target_file_size && r.target_file_url
      );

      const fileRecords = [];
      for (const row of includable) {
        const of = this.projectIdToOrigFile.get(row.project_id) || {};
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
      const newIndex = structuredClone(this.index);
      newIndex.dependencies = Object.assign({}, newIndex.dependencies, { minecraft: this.targetMc });

      // If selected loader is fabric, set fabric-loader to recommended version for target MC
      let loaderNote = "";
      if (this.selectedLoader === "fabric") {
        const rec = await getRecommendedLoaderVersion(this.targetMc, "fabric");
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

      newIndex.name = `${(this.name || "Pack").replace(/\s+$/, "")} (for ${this.targetMc})`;
      newIndex.files = fileRecords;

      // Package: copy overrides/ + write index
      const outZip = new JSZip();

      const overrideEntries = Object.values(this.zip.files).filter(e => e.name.startsWith("overrides/") && !e.dir);
      for (const e of overrideEntries) {
        const content = await this.zip.file(e.name).async("arraybuffer");
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
      const skipped = this.rows.filter(r =>
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
  }
}

// Create global instance
const currentModpack = new Modpack();

/* ---------- RESULTS TABLE CLASS ---------- */
class ResultsTable {
  constructor() {
    this.modsTable = $("mods-table");
    this.resTable = $("res-table");
    this.shaderTable = $("shader-table");
  }

  clear() {
    this.modsTable.innerHTML = "";
    this.resTable.innerHTML = "";
    this.shaderTable.innerHTML = "";
  }

  render(rows) {
    const mods = rows.filter(r => r.category === "mod");
    const res  = rows.filter(r => r.category === "resourcepack");
    const sh   = rows.filter(r => r.category === "shaderpack");

    this.modsTable.innerHTML   = this.renderTable(mods);
    this.resTable.innerHTML    = this.renderTable(res);
    this.shaderTable.innerHTML = this.renderTable(sh);
  }

  renderTable(rows) {
    if (!rows?.length) return `<div class="muted">No entries.</div>`;

    // Sort by availability (unavailable first), then alphabetically by name
    const sortedRows = [...rows].sort((a, b) => {
      // First sort by availability (false before true, so unavailable comes first)
      if (a.target_available !== b.target_available) {
        return a.target_available - b.target_available;
      }
      // Then sort alphabetically by name
      const nameA = (a.name || "(unknown)").toLowerCase();
      const nameB = (b.name || "(unknown)").toLowerCase();
      return nameA.localeCompare(nameB);
    });

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
      ...sortedRows.map(r => {
        const ok = r.target_available;
        const date = r.target_date ? new Date(r.target_date).toLocaleDateString() : "-";
        const dl = r.download_url ? `<a href="${r.download_url}" target="_blank" rel="noreferrer">.jar</a>` : "";
        const sourceBadge =
          r.source === "github-fallback"
            ? `<a class="badge github-fallback" href="https://github.com/gnembon/fabric-carpet/releases" target="_blank" rel="noreferrer" title="Found on GitHub because Modrinth had no ${escapeHtml(r.target_mc)} build">GitHub fallback</a>`
            : r.source === "modrinth"
              ? `<a class="badge modrinth" href="${escapeHtml(r.project_url)}" target="_blank" rel="noreferrer"
                   title="Open on Modrinth${r.target_file_sha512 ? ' — included in .mrpack' : ''}">Modrinth</a>`
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

  updateSummary(rows, targetMc) {
    const total = rows.length;
    const have = rows.filter(r => r.target_available).length;
    outSummary.textContent = `Done. ${have}/${total} have a ${targetMc} build.`;
  }
}

// Create global instance
const resultsTable = new ResultsTable();

/* ---------- MISSING ITEMS MANAGER ---------- */
class MissingItemsManager {
  constructor() {
    // Create app-specific storage prefix based on current path
    const APP_PATH = window.location.pathname.replace(/\/[^\/]*$/, '') || '/';
    this.STORAGE_PREFIX = `mrpack${APP_PATH.replace(/[^a-zA-Z0-9]/g, '_')}_`;
    this.MISSING_ITEMS_KEY = `${this.STORAGE_PREFIX}missing_items`;
    this.MISSING_ITEMS_VERSION = 3; // Updated to version 3 - includes loader
    this.isCheckingMissingItems = false;
  }

  // Storage operations
  async getMissingItems() {
    try {
      const stored = localStorage.getItem(this.MISSING_ITEMS_KEY);
      if (!stored) return { version: this.MISSING_ITEMS_VERSION, items: [] };

      const data = JSON.parse(stored);
      
      // Handle version upgrades
      if (data.version < 3) {
        // Upgrade from version 1 or 2 to version 3: ensure project IDs and loaders are present
        console.log(`Upgrading missing items storage from version ${data.version} to version 3...`);
        const upgradedItems = [];
        
        for (const item of data.items || []) {
          if (item.projectId && item.loader) {
            // Already has project ID and loader, keep as-is
            upgradedItems.push(item);
          } else if (item.projectId && !item.loader) {
            // Has project ID but missing loader (version 2 item)
            upgradedItems.push({
              ...item,
              loader: getDefaultLoaderForCategory(item.category)
            });
          } else {
            // Need to resolve name to project ID (version 1 item)
            try {
              const resolvedId = await resolveProjectIdFromName(item.name, item.category);
              if (resolvedId) {
                console.log(`Resolved ${item.name} to project ID ${resolvedId}`);
                upgradedItems.push({
                  ...item,
                  projectId: resolvedId,
                  loader: getDefaultLoaderForCategory(item.category)
                });
              } else {
                console.warn(`Could not resolve project ID for ${item.name}, skipping item`);
                // Skip items that can't be resolved
              }
            } catch (e) {
              console.warn(`Error resolving project ID for ${item.name}:`, e);
              // Skip items that fail to resolve
            }
          }
        }
        
        const upgradedData = { 
          version: this.MISSING_ITEMS_VERSION, 
          items: upgradedItems 
        };
        
        // Save the upgraded data
        this.saveMissingItems(upgradedData);
        console.log(`Upgraded ${upgradedItems.length} items to version 3 storage`);
        
        return upgradedData;
      }
      
      // Version 2 or higher
      return data;
    } catch (e) {
      console.warn("Failed to load missing items:", e);
      return { version: this.MISSING_ITEMS_VERSION, items: [] };
    }
  }

  saveMissingItems(data) {
    try {
      localStorage.setItem(this.MISSING_ITEMS_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn("Failed to save missing items:", e);
      return false;
    }
  }

  // Data manipulation
  async addMissingItem(name, category, targetMcVersion, originalModpack, projectId = null, loader = null) {
    const data = await this.getMissingItems();
    const id = `${category}-${name}-${targetMcVersion}`.replace(/[^a-zA-Z0-9\-]/g, '-');

    // Check if already exists
    const existing = data.items.find(item => item.id === id);
    if (existing) {
      // Add modpack to the list if not already present
      const modpacks = parseModpackNames(existing.originalModpack);
      if (!modpacks.includes(originalModpack)) {
        modpacks.push(originalModpack);
        existing.originalModpack = modpacks.join(', ');
        existing.dateAdded = new Date().toISOString(); // Update date when new modpack is added
        this.saveMissingItems(data);
      }
      return existing;
    }

    const item = {
      id,
      name,
      category,
      targetMcVersion,
      originalModpack,
      projectId,
      loader: loader || getDefaultLoaderForCategory(category), // Default loader based on category
      dateAdded: new Date().toISOString(),
      lastChecked: null,
      found: false
    };

    data.items.push(item);
    this.saveMissingItems(data);
    return item;
  }

  async removeMissingItem(id) {
    // This method doesn't need to be async since it doesn't read data
    const data = await this.getMissingItems();
    data.items = data.items.filter(item => item.id !== id);
    this.saveMissingItems(data);
  }

  async updateMissingItemStatus(id, found, lastChecked = null) {
    // This method doesn't need to be async since it doesn't read data
    const data = await this.getMissingItems();
    const item = data.items.find(item => item.id === id);
    if (item) {
      item.found = found;
      item.lastChecked = lastChecked || new Date().toISOString();
      this.saveMissingItems(data);
    }
  }

  clearMissingItems() {
    this.saveMissingItems({ version: this.MISSING_ITEMS_VERSION, items: [] });
  }

  async removeMissingItemFromModpack(id, modpackName) {
    // This method doesn't need to be async since it doesn't read data
    const data = await this.getMissingItems();
    const item = data.items.find(item => item.id === id);
    if (item) {
      const modpacks = parseModpackNames(item.originalModpack);
      const updatedModpacks = modpacks.filter(mp => mp !== modpackName);

      if (updatedModpacks.length === 0) {
        // Remove the entire item if no modpacks reference it
        data.items = data.items.filter(item => item.id !== id);
      } else {
        // Update the modpack list
        item.originalModpack = updatedModpacks.join(', ');
      }
      this.saveMissingItems(data);
    }
  }

  // UI rendering
  async renderMissingItems() {
    const data = await this.getMissingItems();
    const items = data.items || [];

    if (items.length === 0) {
      missingItemsList.innerHTML = '<p class="muted">No missing items tracked yet. Use "Remember missing items" when building modpacks to track unavailable mods.</p>';
      return;
    }

    // Sort by found status (found items first), then alphabetically by name
    const sortedItems = [...items].sort((a, b) => {
      // First sort by found status (found before not found)
      if (a.found !== b.found) {
        return b.found - a.found; // true (1) comes before false (0)
      }
      // Then sort alphabetically by name
      const nameA = (a.name || "(unknown)").toLowerCase();
      const nameB = (b.name || "(unknown)").toLowerCase();
      return nameA.localeCompare(nameB);
    });

    const html = sortedItems.map(item => {
      const statusClass = item.found ? 'found' : 'not-found';
      const statusText = item.found ? '✅ Found' : '❌ Still missing';
      const lastChecked = item.lastChecked
        ? new Date(item.lastChecked).toLocaleString()
        : 'Never checked';

      // Build view on Modrinth URL if we have project ID
      const modrinthUrl = item.projectId ? `https://modrinth.com/project/${item.projectId}` : null;
      const viewButton = modrinthUrl
        ? `<button class="missing-item-view" onclick="window.open('${modrinthUrl}', '_blank')">View on Modrinth</button>`
        : '';

      return `
        <div class="missing-item">
          <div class="missing-item-header">
            <h4 class="missing-item-name">
              ${escapeHtml(item.name)}
              <span class="missing-item-mc">${escapeHtml(item.targetMcVersion)}</span>
            </h4>
            <span class="missing-item-status ${statusClass}">${statusText}</span>
          </div>
          <div class="missing-item-details">
            <div><strong>Category:</strong> ${escapeHtml(item.category)} | <strong>Loader:</strong> ${escapeHtml(item.loader || 'Unknown')} | <strong>Added:</strong> ${new Date(item.dateAdded).toLocaleString()}</div>
            <div><strong>From modpack:</strong> ${escapeHtml(item.originalModpack || 'Unknown')}</div>
          </div>
          <div class="missing-item-actions">
            ${viewButton}
            <button class="missing-item-remove" onclick="missingItemsManager.removeMissingItemUI('${item.id}')">Remove</button>
            <span class="missing-item-lastcheck"><strong>Last checked:</strong> ${lastChecked}</span>
          </div>
        </div>
      `;
    }).join('');

    missingItemsList.innerHTML = html;
  }

  async removeMissingItemUI(id) {
    await this.removeMissingItem(id);
    await this.renderMissingItems();
    this.updateMissingItemsButtonTitle();
    showNotification("Missing item removed.");
  }

  // Update checking
  async checkMissingItemsForUpdates() {
    if (this.isCheckingMissingItems) return;

    const data = await this.getMissingItems(); // Now async due to potential upgrades
    const items = data.items || [];

    if (items.length === 0) {
      showNotification("No missing items to check.");
      return;
    }

    this.isCheckingMissingItems = true;
    missingItemsBtn.classList.add('checking');
    checkMissingItemsBtn.disabled = true;
    missingItemsStatus.textContent = "Checking for updates...";

    let foundCount = 0;
    let checkedCount = 0;

    try {
      // Check each missing item
      for (const item of items) {
        missingItemsStatus.textContent = `Checking ${checkedCount + 1}/${items.length}: ${item.name}`;

        // All items should now have projectIds after upgrade
        if (!item.projectId) {
          console.warn(`Skipping item ${item.name} - no project ID available`);
          checkedCount++;
          continue;
        }

        const loader = item.loader || getDefaultLoaderForCategory(item.category);
        let found = await checkModrinthVersionAvailability(item.projectId, item.targetMcVersion, loader, item.name);

        this.updateMissingItemStatus(item.id, found);
        if (found) foundCount++;
        checkedCount++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Update UI
      this.renderMissingItems();

      if (foundCount > 0) {
        const foundItems = items.filter(item => {
          const updated = data.items.find(i => i.id === item.id);
          return updated && updated.found;
        }).map(item => `${item.name} (${item.originalModpack || 'Unknown'})`);

        showNotification(`🎉 Found ${foundCount} missing item(s)! Check these modpacks: ${foundItems.join(', ')}`);
      } else {
        showNotification("No updates found for missing items.");
      }

      missingItemsStatus.textContent = `Last checked: ${new Date().toLocaleString()}`;

    } catch (e) {
      console.error("Error checking missing items:", e);
      missingItemsStatus.textContent = "Error checking for updates.";
      showNotification("Error occurred while checking for updates.");
    } finally {
      this.isCheckingMissingItems = false;
      missingItemsBtn.classList.remove('checking');
      checkMissingItemsBtn.disabled = false;
    }
  }

  updateMissingItemsButtonTitle() {
    // This needs to be async now
    this.getMissingItems().then(data => {
      const count = data.items ? data.items.length : 0;

      if (count > 0) {
        missingItemsBtn.title = `Missing Items Tracker (${count} tracked)`;
      } else {
        missingItemsBtn.title = "Missing Items Tracker";
      }
    }).catch(e => {
      console.warn("Failed to update missing items button title:", e);
    });
  }
}

// Create global instance
const missingItemsManager = new MissingItemsManager();

/* ---------- THEME MANAGER ---------- */
class ThemeManager {
  constructor() {
    // Create app-specific storage prefix based on current path
    const APP_PATH = window.location.pathname.replace(/\/[^\/]*$/, '') || '/';
    const STORAGE_PREFIX = `mrpack${APP_PATH.replace(/[^a-zA-Z0-9]/g, '_')}_`;
    this.THEME_KEY = `${STORAGE_PREFIX}theme`;

    this.themeBtns = {
      system: $("theme-system"),
      light: $("theme-light"),
      dark: $("theme-dark"),
    };

    this.init();
  }

  setThemeAttr(val) {
    document.documentElement.setAttribute("data-theme", val);
    localStorage.setItem(this.THEME_KEY, val);
    // update active styles
    Object.keys(this.themeBtns).forEach(k => this.themeBtns[k].classList.toggle("active", k === val));
  }

  init() {
    const saved = localStorage.getItem(this.THEME_KEY) || "system";
    this.setThemeAttr(saved);
    // If user switches OS theme later and we're on "system", CSS updates automatically via media query

    // Set up event listeners
    this.themeBtns.system.addEventListener("click", () => this.setThemeAttr("system"));
    this.themeBtns.light.addEventListener("click", () => this.setThemeAttr("light"));
    this.themeBtns.dark.addEventListener("click", () => this.setThemeAttr("dark"));
  }
}

// Create global instance
const themeManager = new ThemeManager();

/* ---------- FILE INPUT HANDLER ---------- */
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    fileName.textContent = file.name;
  } else {
    fileName.textContent = "";
  }
});

/* ---------- HELP MODAL ---------- */
const helpBtn = $("help-btn");
const helpModal = $("help-modal");
const helpClose = $("help-close");

/* ---------- MISSING ITEMS PANEL ---------- */
const missingItemsBtn = $("missing-items-btn");
const missingItemsPanel = $("missing-items-panel");
const missingItemsClose = $("missing-items-close");
const checkMissingItemsBtn = $("check-missing-items");
const clearMissingItemsBtn = $("clear-missing-items");
const missingItemsList = $("missing-items-list");
const missingItemsStatus = $("missing-items-status");

/* ---------- NOTIFICATION SYSTEM ---------- */
const notificationToast = $("notification-toast");
const notificationText = $("notification-text");
const notificationClose = $("notification-close");

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

/* ---------- MISSING ITEMS PANEL HANDLERS ---------- */
missingItemsBtn.addEventListener("click", async () => {
  missingItemsPanel.style.display = "flex";
  await missingItemsManager.renderMissingItems();
});

missingItemsClose.addEventListener("click", () => {
  missingItemsPanel.style.display = "none";
});

missingItemsPanel.addEventListener("click", (e) => {
  if (e.target === missingItemsPanel) {
    missingItemsPanel.style.display = "none";
  }
});

checkMissingItemsBtn.addEventListener("click", () => {
  missingItemsManager.checkMissingItemsForUpdates();
});

clearMissingItemsBtn.addEventListener("click", async () => {
  if (confirm("Are you sure you want to clear all missing items? This cannot be undone.")) {
    missingItemsManager.clearMissingItems();
    await missingItemsManager.renderMissingItems();
    missingItemsManager.updateMissingItemsButtonTitle();
    showNotification("All missing items cleared.");
  }
});

/* ---------- NOTIFICATION HANDLERS ---------- */
notificationClose.addEventListener("click", () => {
  hideNotification();
});

// Close notification after 10 seconds
let notificationTimeout = null;

function showNotification(message) {
  notificationText.textContent = message;
  notificationToast.style.display = "block";
  
  // Make toast clickable to open missing items panel
  notificationToast.style.cursor = "pointer";
  notificationToast.onclick = (e) => {
    if (e.target !== notificationClose) {
      hideNotification();
      missingItemsPanel.style.display = "flex";
      missingItemsManager.renderMissingItems();
    }
  };
  
  if (notificationTimeout) clearTimeout(notificationTimeout);
  notificationTimeout = setTimeout(() => {
    hideNotification();
  }, 10000);
}

function hideNotification() {
  notificationToast.style.display = "none";
  notificationToast.style.cursor = "";
  notificationToast.onclick = null;
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
    notificationTimeout = null;
  }
}

// Close modal with Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (helpModal.style.display === "flex") {
      helpModal.style.display = "none";
    } else if (missingItemsPanel.style.display === "flex") {
      missingItemsPanel.style.display = "none";
    }
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

    clean.sort((a, b) => compareVersions(a, b));

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

/* ---------- Main flow functions ---------- */

/* ---------- Main flow (check) ---------- */
runBtn.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) { alert("Choose a .mrpack file first."); return; }
  const TARGET_MC = mcSelect.value;
  const PACK_LOADER = loaderSelect.value;

  resetProgress();
  updateTitle(); // Reset title to base title
  resultsTable.clear();
  outRaw.textContent = "";
  buildControls.style.display = "none";
  buildBtn.disabled = true;
  captureMissingBtn.disabled = true;
  captureMissingBtn.style.display = "none";
  dlLink.style.display = "none";
  buildNote.textContent = "";

  try {
    // Step 1-4: Analyze modpack compatibility
    const rows = await currentModpack.analyze(file, TARGET_MC, PACK_LOADER);
    if (!rows) return; // Error occurred during analysis

    // Step 5: Render results
    setPhase("Rendering results…");
    resultsTable.render(rows);
    outRaw.textContent = JSON.stringify(rows, null, 2);
    resultsTable.updateSummary(rows, TARGET_MC);
    setBar(5, 5);
    setPhase("Done");

    // Step 6: Enable build controls and missing items tracking
    buildControls.style.display = "flex";
    buildBtn.disabled = false;
    buildNote.textContent = "Ready to build a new .mrpack from Modrinth results.";

    // Show capture missing button only if there are missing items
    const missingItems = currentModpack.getMissingItems();
    if (missingItems.length > 0) {
      captureMissingBtn.disabled = false;
      captureMissingBtn.style.display = "inline-block";
      captureMissingBtn.textContent = `Remember ${missingItems.length} missing item${missingItems.length > 1 ? 's' : ''}`;
    } else {
      captureMissingBtn.style.display = "none";
    }
  } catch (err) {
    console.error(err);
    setPhase("Error", err?.message || String(err));
  }
});

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
  await currentModpack.build();
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

/* ---------- MISSING ITEMS UI FUNCTIONS ---------- */

// Auto-check missing items when page loads
window.addEventListener('load', async () => {
  // Update missing items button title with count
  missingItemsManager.updateMissingItemsButtonTitle();

  const data = await missingItemsManager.getMissingItems();
  if (data.items && data.items.length > 0) {
    // Wait a bit for the page to fully load, then check in background
    setTimeout(() => {
      missingItemsManager.checkMissingItemsForUpdates();
    }, 1000);
  }
});

// Handle capture missing items button
captureMissingBtn.addEventListener("click", async () => {
  if (!currentModpack.hasData()) {
    alert("Run a check first to capture missing items.");
    return;
  }

  // Find items that are not available for the target version
  const missingItems = currentModpack.getMissingItems();

  if (missingItems.length === 0) {
    showNotification("No missing items to capture - all mods are available for the target version!");
    return;
  }

  let newItemsCount = 0;
  let updatedItemsCount = 0;

  for (const row of missingItems) {
    const data = await missingItemsManager.getMissingItems();
    const id = `${row.category}-${row.name || row.slug || "(unknown)"}-${currentModpack.targetMc}`.replace(/[^a-zA-Z0-9\-]/g, '-');
    const existing = data.items.find(item => item.id === id);

    if (existing) {
      const modpacks = parseModpackNames(existing.originalModpack);
      if (!modpacks.includes(currentModpack.packName)) {
        updatedItemsCount++;
      }
    } else {
      newItemsCount++;
    }

    missingItemsManager.addMissingItem(
      row.name || row.slug || "(unknown)",
      row.category,
      currentModpack.targetMc,
      currentModpack.packName,
      row.project_id,
      row.target_loader
    );
  }

  let message = "";
  if (newItemsCount > 0 && updatedItemsCount > 0) {
    message = `Added ${newItemsCount} new missing items and updated ${updatedItemsCount} existing items with "${currentModpack.packName}".`;
  } else if (newItemsCount > 0) {
    message = `Added ${newItemsCount} new missing items from "${currentModpack.packName}".`;
  } else if (updatedItemsCount > 0) {
    message = `Updated ${updatedItemsCount} existing items with "${currentModpack.packName}".`;
  } else {
    message = `All ${missingItems.length} missing items were already tracked for "${currentModpack.packName}".`;
  }

  showNotification(message);
  missingItemsManager.updateMissingItemsButtonTitle();
});

// Check missing items on page load if any exist
document.addEventListener("DOMContentLoaded", async () => {
  missingItemsManager.updateMissingItemsButtonTitle();

  const data = await missingItemsManager.getMissingItems();
  if (data.items.length > 0) {
    // Auto-check in background
    setTimeout(() => {
      missingItemsManager.checkMissingItemsForUpdates();
    }, 2000); // Wait 2 seconds after page load
  }
});