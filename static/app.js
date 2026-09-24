const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const fmtT = (s) => {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60), r = s - m * 60;
  const hh = Math.floor(m / 60);
  const mm = hh ? String(m % 60).padStart(2, "0") : m;
  return (hh ? hh + ":" : "") + mm + ":" + r.toFixed(1).padStart(4, "0");
};
const fmtDur = (s) => {
  s = Math.round(s || 0);
  const m = Math.floor(s / 60), r = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
const fmtSize = (b) => {
  if (b == null) return "–";
  if (b < 1024) return b + " B";
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return (b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)) + " " + u[i];
};
const even = (x) => Math.max(2, Math.round(x / 2) * 2);

const FMT_SUB = {
  h264: "Se reproduce en todo", h265: "Mitad de tamaño", av1: "El más eficiente", vp9: "Formato web abierto",
  mkv: "Contenedor flexible", gif: "Bucle sin audio", mp3: "Solo audio", copy: "Instantáneo, sin pérdida",
};
const CRF = {
  h264: [12, 32, 23], mkv: [12, 32, 23], h265: [14, 36, 28], av1: [18, 50, 30], vp9: [18, 50, 31],
};
const TEN_DEFAULT = { h265: true, av1: true, vp9: false };
const RES = [2160, 1440, 1080, 720, 540, 480, 360, 240];
const RES_NAME = { 2160: "4K", 1440: "1440p", 1080: "1080p", 720: "720p", 540: "540p", 480: "480p", 360: "360p", 240: "240p" };
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8, 16];
const ASPECTS = [["Libre", null], ["Original", "orig"], ["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:5", 4 / 5], ["4:3", 4 / 3], ["21:9", 21 / 9]];
const SLIDERS = [
  ["exposure", "Exposición", -2, 2, 0.05, (v) => (v > 0 ? "+" : "") + v.toFixed(2)],
  ["contrast", "Contraste", -1, 1, 0.01, (v) => Math.round(v * 100)],
  ["highlights", "Luces", -1, 1, 0.01, (v) => Math.round(v * 100)],
  ["shadows", "Sombras", -1, 1, 0.01, (v) => Math.round(v * 100)],
  ["saturation", "Saturación", -1, 1, 0.01, (v) => Math.round(v * 100)],
  ["temperature", "Temperatura", -1, 1, 0.01, (v) => Math.round(v * 100)],
  ["tint", "Tinte", -1, 1, 0.01, (v) => Math.round(v * 100)],
  ["intensity", "Intensidad LUT", 0, 1, 0.01, (v) => Math.round(v * 100) + "%"],
  ["sharpen", "Nitidez", 0, 1, 0.01, (v) => Math.round(v * 100)],
];
const GRADE_DEFAULT = { lut: "", intensity: 1, exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, temperature: 0, tint: 0, sharpen: 0 };

const OUT_DEFAULT = {
  format: "h264", height: 0, fps: 0, mode: "crf", crfBy: {}, tenBy: {}, size_mb: 50, preset: "medium", encoder: "cpu",
  tonemap: true, slowmo: "dup", audioMode: "keep", abr: 160, volume: 1, fade_in: 0, fade_out: 0, crfv: 2,
};
const outDefault = () => ({ ...OUT_DEFAULT, crfBy: {}, tenBy: {} });
const S = {
  config: null, luts: [], media: null, mediaList: [], jobs: [], jobsSeen: {}, project: null, projects: [],
  segs: [], sel: 0,
  crop: { enabled: false, x: 0, y: 0, w: 1, h: 1, aspect: null },
  rotate: 0, flip_h: false, flip_v: false,
  grade: { ...GRADE_DEFAULT },
  out: outDefault(),
  name: "", nameDirty: false,
  subs: { key: "", mode: "burn", size: 1, live: true }, atrack: 0,
  tracks: [], msel: null, aregs: [], asel: 0, lane: "video",
};
const VOLS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const AUDIO_RE = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aif|aiff)$/i;
const VIDEO_RE = /\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts|ts|mpg|mpeg|wmv|flv|3gp|mxf|lrv|insv|dv)$/i;
const SUB_RE = /\.(srt|ass|ssa|vtt)$/i;
const SUB_CODEC = { ass: "ASS", ssa: "SSA", subrip: "SRT", srt: "SRT", mov_text: "Texto", webvtt: "VTT", hdmv_pgs_subtitle: "PGS", dvd_subtitle: "DVD", dvb_subtitle: "DVB" };

async function api(method, path, body, raw) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers["content-type"] = "application/json"; }
  const r = await fetch(path, opt);
  if (r.status === 401 && path !== "/api/login") { showLogin(); throw new Error("Sesión caducada"); }
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = j.detail || msg; } catch {}
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return raw ? r : r.json();
}

function toast(msg, kind = "") {
  const t = h("div", { class: "toast " + kind }, msg);
  $("toasts").append(t);
  setTimeout(() => t.remove(), kind === "err" ? 7000 : 4000);
}

function confirmBox(text, yes = "Borrar") {
  return new Promise((res) => {
    $("confirmText").textContent = text;
    $("confirmYes").textContent = yes;
    $("confirmModal").classList.remove("hidden");
    const done = (v) => { $("confirmModal").classList.add("hidden"); $("confirmYes").onclick = $("confirmNo").onclick = null; res(v); };
    $("confirmYes").onclick = () => done(true);
    $("confirmNo").onclick = () => done(false);
  });
}

function showLogin() {
  $("login").classList.remove("hidden");
  setTimeout(() => $("loginPass").focus(), 50);
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginErr").textContent = "";
  try {
    await api("POST", "/api/login", { password: $("loginPass").value });
    $("login").classList.add("hidden");
    $("loginPass").value = "";
    if (!S.config) init();
  } catch (err) { $("loginErr").textContent = err.message; }
});

async function boot() {
  const me = await api("GET", "/api/me");
  if (me.auth_required && !me.authenticated) return showLogin();
  init();
}

async function init() {
  S.config = await api("GET", "/api/config");
  if (!S.config.formats.find((f) => f.id === S.out.format)) S.out.format = "h264";
  if (S.config.library.length) $("libBtn").classList.remove("hidden");
  buildStatic();
  await loadLuts();
  window.addEventListener("hashchange", route);
  route();
}

async function route() {
  const mm = location.hash.match(/^#\/p\/([0-9a-f]+)/);
  if (mm) return openProject(mm[1]);
  showHome();
}

let homeTimer = null;
async function showHome() {
  await flushSave();
  S.project = null;
  closeMedia();
  $("projectView").classList.add("hidden");
  $("homeView").classList.remove("hidden");
  $("projHead").classList.add("hidden");
  $("jobsBtn").classList.add("hidden");
  document.title = "Video Tools";
  await refreshHome();
}

async function refreshHome() {
  clearTimeout(homeTimer);
  if (S.project) return;
  try {
    const [projects, media] = await Promise.all([api("GET", "/api/projects"), api("GET", "/api/media")]);
    S.projects = projects;
    S.mediaList = media;
    renderProjects();
    renderRecent();
  } catch {}
  refreshQuick();
  const busy = S.projects.some((p) => p.active || (p.media && ["pending", "running"].includes(p.media.proxy_status)));
  homeTimer = setTimeout(refreshHome, busy ? 2000 : 15000);
}

const ago = (t) => {
  const d = Date.now() / 1000 - t;
  if (d < 60) return "ahora mismo";
  if (d < 3600) return `hace ${Math.round(d / 60)} min`;
  if (d < 86400) return `hace ${Math.round(d / 3600)} h`;
  if (d < 86400 * 30) return `hace ${Math.round(d / 86400)} días`;
  return new Date(t * 1000).toLocaleDateString("es-ES");
};

function renderProjects() {
  const g = $("projGrid");
  $("projSub").textContent = S.projects.length ? `${S.projects.length} proyecto${S.projects.length > 1 ? "s" : ""} · se guardan solos` : "";
  if (!S.projects.length) return g.replaceChildren(h("div", { class: "proj-empty" }, "Aún no tienes proyectos. Sube un vídeo para crear el primero."));
  g.replaceChildren(...S.projects.map((p) => {
    const m = p.media;
    const th = h("div", { class: "th" });
    if (m && m.thumbs) th.style.backgroundImage = `url(/api/media/${m.id}/thumbs)`;
    if (m) th.append(h("span", { class: "dur" }, fmtDur(m.info.duration)));
    if (m && ["pending", "running"].includes(m.proxy_status)) th.append(h("span", { class: "st" }, `Preparando ${Math.round((m.proxy_progress || 0) * 100)}%`));
    else if (p.active) th.append(h("span", { class: "st" }, `Renderizando…`));
    const meta = [m ? `${m.info.video.width}×${m.info.video.height}` : "vídeo borrado", p.renders ? `${p.renders} render${p.renders > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ");
    return h("a", { class: "proj", href: `#/p/${p.id}`, title: m ? m.name : "" },
      th,
      h("div", { class: "bd" }, h("div", { class: "nm" }, p.name), h("div", { class: "muted small mono ellipsis" }, meta), h("div", { class: "muted small" }, "Editado " + ago(p.updated || p.created))),
      h("button", { class: "del", title: "Borrar proyecto", onclick: async (e) => {
        e.preventDefault(); e.stopPropagation();
        const shared = m && S.projects.filter((x) => x.media_id === p.media_id).length > 1;
        const txt = `¿Borrar el proyecto «${p.name}»? Se borrarán sus renders${shared ? "" : " y el vídeo subido"}.`;
        if (!(await confirmBox(txt))) return;
        await api("DELETE", `/api/projects/${p.id}`);
        refreshHome();
      } }, "✕"));
  }));
}

function renderRecent() {
  const box = $("recent");
  $("reuseBox").classList.toggle("hidden", !S.mediaList.length);
  box.replaceChildren(...S.mediaList.map((m) => {
    const v = m.info.video;
    const st = m.proxy_status === "running" || m.proxy_status === "pending" ? ` · preparando ${Math.round((m.proxy_progress || 0) * 100)}%` : m.proxy_status === "error" ? " · error" : "";
    return h("div", { class: "mchip", title: "Crear un proyecto nuevo con este vídeo", onclick: () => newProject(m) },
      h("div", { class: "min0" }, h("div", { class: "nm ellipsis" }, m.name), h("div", { class: "muted small mono" }, `${v.width}×${v.height} · ${fmtDur(m.info.duration)}${st}${m.projects ? ` · ${m.projects} proy.` : ""}`)),
      m.projects ? null : h("button", { class: "x", title: "Borrar vídeo", onclick: async (e) => {
        e.stopPropagation();
        if (!(await confirmBox(`¿Borrar «${m.name}» del servidor?`))) return;
        try { await api("DELETE", `/api/media/${m.id}`); } catch (err) { toast(err.message, "err"); }
        refreshHome();
      } }, "✕"));
  }));
}

async function newProject(m) {
  try {
    const p = await api("POST", "/api/projects", { media_id: m.id });
    location.hash = `#/p/${p.id}`;
  } catch (e) { toast(e.message, "err"); }
}

async function openProject(id) {
  clearTimeout(homeTimer);
  if (S.project && S.project.id === id) return;
  await flushSave();
  let p;
  try { p = await api("GET", `/api/projects/${id}`); }
  catch (e) { toast(e.message, "err"); location.hash = "#/"; return; }
  if (!p.media) { toast("El vídeo de este proyecto ya no existe", "err"); location.hash = "#/"; return; }
  S.project = p;
  S.jobsSeen = {};
  $("homeView").classList.add("hidden");
  $("projectView").classList.remove("hidden");
  $("projHead").classList.remove("hidden");
  $("jobsBtn").classList.remove("hidden");
  $("projName").value = p.name;
  $("saveState").textContent = "";
  document.title = p.name + " · Video Tools";
  S.media = null;
  openMedia(p.media, p.state);
  pollJobs();
  window.scrollTo(0, 0);
}

let saveT = null, savePending = false;
function projectState() {
  return { ...JSON.parse(snap()), name: S.name, nameDirty: S.nameDirty };
}
function scheduleSave() {
  if (!S.project) return;
  savePending = true;
  $("saveState").textContent = "Guardando…";
  clearTimeout(saveT);
  saveT = setTimeout(flushSave, 800);
}
async function flushSave(keepalive) {
  clearTimeout(saveT);
  if (!savePending || !S.project || !S.media) return;
  savePending = false;
  const id = S.project.id;
  try {
    await fetch(`/api/projects/${id}`, { method: "PUT", keepalive: !!keepalive, headers: { "content-type": "application/json" }, body: JSON.stringify({ state: projectState() }) });
    if (S.project && S.project.id === id) $("saveState").textContent = "Guardado";
  } catch { savePending = true; if (S.project) $("saveState").textContent = "Sin guardar"; }
}
window.addEventListener("beforeunload", () => { if (savePending) flushSave(true); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && savePending) flushSave(true); });

$("projName").addEventListener("change", async () => {
  const n = $("projName").value.trim();
  if (!n || !S.project) { $("projName").value = S.project ? S.project.name : ""; return; }
  S.project.name = n;
  document.title = n + " · Video Tools";
  await api("PUT", `/api/projects/${S.project.id}`, { name: n });
  $("saveState").textContent = "Guardado";
});
$("projName").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });

function closeMedia() {
  const old = S.media;
  if (old && old.proxy_status === "ready" && LOCAL.has(old.id)) {
    URL.revokeObjectURL(LOCAL.get(old.id).url);
    LOCAL.delete(old.id);
  }
  dropMemory();
  audioStop(true);
  S.media = null;
  $("editor").classList.add("hidden");
  const v = $("video");
  v.removeAttribute("src");
  v.load();
  trackKey = null;
  v.querySelectorAll("track").forEach((t) => t.remove());
}

function applyState(st) {
  if (!st) return;
  const d = S.media.info.duration;
  if (Array.isArray(st.segs) && st.segs.length) S.segs = st.segs.map((x) => ({ start: clamp(+x.start, 0, d), end: clamp(+x.end, 0, d), speed: +x.speed || 1, vol: x.vol == null ? 1 : clamp(+x.vol, 0, 4) })).filter((x) => x.end > x.start);
  if (!S.segs.length) S.segs = [{ start: 0, end: d, speed: 1 }];
  S.sel = clamp(st.sel || 0, 0, S.segs.length - 1);
  if (st.crop) S.crop = { ...S.crop, ...st.crop };
  S.rotate = st.rotate || 0; S.flip_h = !!st.flip_h; S.flip_v = !!st.flip_v;
  if (st.grade) S.grade = { ...GRADE_DEFAULT, ...st.grade };
  if (st.subs) S.subs = { ...S.subs, ...st.subs };
  if (st.atrack != null) S.atrack = st.atrack;
  if (Array.isArray(st.tracks)) S.tracks = st.tracks.map(normTrack).filter(Boolean);
  else if (st.music && st.music.id) S.tracks = legacyTracks(st.music);
  if (Array.isArray(st.aregs) && st.aregs.length) S.aregs = st.aregs.map((r) => ({ start: +r.start, end: +r.end, vol: clamp(+r.vol, 0, 4) }));
  else if (S.segs.some((x) => x.vol !== 1)) {
    const regs = [];
    let last = 0;
    for (const x of S.segs) {
      if (x.start > last) regs.push({ start: last, end: x.start, vol: 1 });
      regs.push({ start: x.start, end: x.end, vol: x.vol });
      last = x.end;
    }
    if (last < d) regs.push({ start: last, end: d, vol: 1 });
    S.aregs = regs;
  }
  S.segs.forEach((x) => { x.vol = 1; });
  normAregs();
  if (st.out) S.out = { ...outDefault(), ...st.out, crfBy: st.out.crfv === 2 ? { ...(st.out.crfBy || {}) } : {}, tenBy: { ...(st.out.tenBy || {}) }, crfv: 2 };
  if (st.nameDirty && st.name) { S.name = st.name; S.nameDirty = true; }
  if (!Array.isArray(st.tracks) && st.music && st.music.id && st.music.replace) S.out.audioMode = "mute";
}

let mediaPoll = null;
function openMedia(m, state) {
  const same = S.media && S.media.id === m.id;
  S.media = m;
  if (!same) {
    const d = m.info.duration;
    S.segs = [{ start: 0, end: d, speed: 1 }];
    S.sel = 0;
    S.crop = { enabled: false, x: 0, y: 0, w: 1, h: 1, aspect: null };
    S.rotate = 0; S.flip_h = false; S.flip_v = false;
    S.nameDirty = false;
    S.subs = { key: "", mode: "burn", size: 1, live: S.subs.live };
    const auds = m.info.audios || [];
    S.atrack = Math.max(0, auds.findIndex((x) => x.default));
    S.tracks = [];
    S.msel = null;
    S.aregs = [{ start: 0, end: d, vol: 1 }];
    S.asel = 0;
    S.grade = { ...GRADE_DEFAULT };
    S.out = outDefault();
    liveOff();
    trackKey = null;
    applyState(state);
    cmp.loaded = false;
    $("cmpEmpty").classList.remove("hidden");
    $("cmpAfter").removeAttribute("src");
    $("cmpBefore").removeAttribute("src");
  }
  $("editor").classList.remove("hidden");
  $("mName").textContent = m.name;
  renderMeta(m);
  $("tDur").textContent = fmtT(m.info.duration);
  refreshMediaState(!same);
  renderAll();
  if (!same) resetHistory();
}

async function refreshMediaState(reload) {
  clearTimeout(mediaPoll);
  if (!S.media) return;
  const m = S.media;
  const msg = $("stageMsg");
  const loc = localActive(m);
  if (loc) {
    msg.classList.add("hidden");
    if (video.getAttribute("src") !== loc.url && !mem.key) setSource(loc.url, video.currentTime || 0);
    localAudio(m.id);
    localThumbs(m.id);
    if (typeof loc.thumbs === "string" && loc.thumbs.startsWith("data:")) setThumbs(`url("${loc.thumbs}")`);
    audioSources();
    localBadge(m);
    mediaPoll = setTimeout(pollMedia, 1500);
    return;
  }
  if (m.proxy_status === "ready" || m.proxy_status === "direct") {
    msg.classList.add("hidden");
    const url = `/api/media/${m.id}/preview?v=${m.preview_v || 0}&n=2`;
    const v = $("video");
    const onLocal = LOCAL.has(m.id) && v.getAttribute("src") === LOCAL.get(m.id).url;
    if (mem.key !== url && mem.pending !== url && (reload || v.getAttribute("src") !== url)) {
      const t = onLocal ? v.currentTime || 0 : reload ? 0 : v.currentTime || 0;
      const small = (m.preview_size || 0) > 0 && m.preview_size <= MEM_DIRECT;
      if (!onLocal) {
        if (!small) setSource(url, t);
        else { v.removeAttribute("src"); v.load(); }
      }
      loadIntoMemory(m, url, t);
    }
    localBadge(m);
    if (m.scrub && scrubImg.src.indexOf(`/api/media/${m.id}/scrub.jpg?v=${m.preview_v}`) < 0) scrubImg.src = `/api/media/${m.id}/scrub.jpg?v=${m.preview_v}`;
    if (m.thumbs) setThumbs(`url("/api/media/${m.id}/thumbs")`);
    else {
      const lt = LOCAL.get(m.id);
      setThumbs(lt && typeof lt.thumbs === "string" && lt.thumbs.startsWith("data:") ? `url("${lt.thumbs}")` : "");
      mediaPoll = setTimeout(pollMedia, 1500);
    }
    setWaveImg(m.wave ? `/api/media/${m.id}/wave.png?v=${m.preview_v}` : "");
    audioSources();
    if (!cmp.loaded) setTimeout(() => { if (!cmp.loaded && S.media === m) refreshCompare(); }, 800);
  } else if (m.proxy_status === "error") {
    msg.classList.remove("hidden");
    msg.replaceChildren(h("div", {}, h("b", {}, "No se pudo preparar la vista previa"), h("div", { class: "small" }, m.error || ""), h("div", { class: "small" }, "Aun así puedes intentar renderizar.")));
  } else {
    $("video").removeAttribute("src");
    setThumbs("");
    setWaveImg("");
    audioStop(true);
    msg.classList.remove("hidden");
    const up = m.proxy_status === "uploading";
    const p = Math.round(((up ? m.upload_progress : m.proxy_progress) || 0) * 100);
    msg.replaceChildren(h("div", {}, h("b", {}, up ? `Subiendo el vídeo · ${p}%` : m.proxy_status === "pending" ? "En cola para preparar la vista previa…" : `Preparando vista previa ligera · ${p}%`),
      h("div", { class: "small" }, "El original no se toca: el render final usa siempre la máxima calidad."),
      h("div", { class: "bar" }, h("i", { style: `width:${p}%` }))));
    mediaPoll = setTimeout(pollMedia, 1200);
  }
}

function renderMeta(m) {
  const v = m.info.video, a = m.info.audio;
  const bits = v.bits > 8 ? ` ${v.bits}-bit` : "";
  const hdr = v.hdr ? ` · HDR ${v.transfer === "arib-std-b67" ? "HLG" : "PQ"}` : "";
  $("mMeta").textContent = `${v.width}×${v.height} · ${v.codec || "leyendo…"}${bits} · ${+v.fps.toFixed(2)} fps · ${fmtDur(m.info.duration)} · ${fmtSize(m.info.size)}${hdr}${a ? "" : " · sin audio"}`;
}

function fixDuration(oldD, newD) {
  if (!oldD || !newD || Math.abs(oldD - newD) < 1e-3) return false;
  for (const x of S.segs) {
    if (Math.abs(x.end - oldD) < 0.05) x.end = newD;
    x.end = Math.min(x.end, newD);
    x.start = Math.min(x.start, Math.max(0, x.end - 0.1));
  }
  S.segs = S.segs.filter((x) => x.end - x.start > 0.05);
  if (!S.segs.length) S.segs = [{ start: 0, end: newD, speed: 1 }];
  S.sel = clamp(S.sel, 0, S.segs.length - 1);
  normAregs();
  return true;
}

async function pollMedia() {
  if (!S.media) return;
  try {
    const m = await api("GET", `/api/media/${S.media.id}`);
    if (!S.media || S.media.id !== m.id) return;
    const was = S.media.proxy_status;
    const oldD = S.media.info.duration, prov = S.media.info.provisional;
    S.media = m;
    if (S.project) S.project.media = m;
    if (prov && !m.info.provisional) {
      fixDuration(oldD, m.info.duration);
      $("tDur").textContent = fmtT(m.info.duration);
      renderMeta(m);
      renderAll();
      scheduleSave();
    }
    refreshMediaState(was !== m.proxy_status && !(was === "uploading" || LOCAL.has(m.id)));
  } catch { mediaPoll = setTimeout(pollMedia, 3000); }
}

function buildStatic() {
  $("fmtGrid").replaceChildren(...S.config.formats.map((f) => h("button", { class: "fmt", "data-f": f.id, onclick: () => setFormat(f.id) }, h("b", {}, f.label), h("span", {}, FMT_SUB[f.id] || ""))));
  $("aspectChips").replaceChildren(...ASPECTS.map(([n, a], i) => h("button", { class: "chip", "data-i": i, onclick: () => setAspect(a) }, n)));
  const fades = [0, 0.5, 1, 1.5, 2, 3];
  for (const id of ["fadeIn", "fadeOut"]) {
    $(id).replaceChildren(...fades.map((f) => h("option", { value: f }, f ? f + " s" : "No")));
  }
  $("fadeIn").onchange = () => { S.out.fade_in = +$("fadeIn").value; changed(); };
  $("fadeOut").onchange = () => { S.out.fade_out = +$("fadeOut").value; changed(); };
  $("abrChips").replaceChildren(...[96, 128, 160, 192, 256, 320].map((b) => h("button", { class: "chip", "data-b": b, onclick: () => { S.out.abr = b; changed(); } }, b + " kbps")));
  $("musFile").addEventListener("change", () => { const f = $("musFile").files[0]; $("musFile").value = ""; if (f) uploadMusic(f); });
  $("sliders").replaceChildren(...SLIDERS.map(([k, label, mn, mx, st, f]) => {
    const inp = h("input", { type: "range", min: mn, max: mx, step: st, id: "sl-" + k });
    const val = h("span", { class: "v" });
    const row = h("div", { class: "sl", id: "slr-" + k, title: "Doble clic para restablecer" }, h("span", {}, label), inp, val);
    inp.addEventListener("input", () => { S.grade[k] = +inp.value; renderSliders(); gradeChanged(); });
    row.addEventListener("dblclick", () => { S.grade[k] = GRADE_DEFAULT[k]; renderSliders(); gradeChanged(); });
    return row;
  }));
  document.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { S.out.mode = b.dataset.mode; changed(); }));
  document.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { S.out.preset = b.dataset.p; changed(); }));
  document.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => { S.out.encoder = b.dataset.e; changed(); }));
  document.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { S.out.slowmo = b.dataset.s; changed(); }));
  document.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => { S.out.audioMode = b.dataset.a; changed(); }));
  document.querySelectorAll("[data-sm]").forEach((b) => (b.onclick = () => { S.subs.mode = b.dataset.sm; renderSubs(); gradeChanged(); }));
}

function geom() {
  const v = S.media.info.video;
  const W = v.width, H = v.height;
  let cw = W, ch = H;
  if (S.crop.enabled) { cw = Math.min(even(S.crop.w * W), W - (W % 2)); ch = Math.min(even(S.crop.h * H), H - (H % 2)); }
  const rot = ((S.rotate % 360) + 360) % 360;
  const [rw, rh] = rot === 90 || rot === 270 ? [ch, cw] : [cw, ch];
  let w = rw - (rw % 2), hh = rh - (rh % 2);
  const t = S.out.height;
  const short = Math.min(rw, rh);
  if (t && t < short) { const k = t / short; w = even(rw * k); hh = even(rh * k); }
  return { W, H, cw, ch, rw, rh, w, h: hh, short };
}

function isVideoFmt(f) { return !["mp3", "copy"].includes(f); }

function setFormat(f) {
  const prev = S.out.format;
  S.out.format = f;
  if (f === "gif") {
    if (!S.out.height || S.out.height > 480) S.out.height = 360;
    if (!S.out.fps || S.out.fps > 25) S.out.fps = 15;
  } else if (prev === "gif") {
    S.out.fps = 0;
  }
  changed();
}

function setAspect(a) {
  const v = S.media.info.video;
  S.crop.aspect = a;
  if (a === null) { S.crop.enabled = true; renderCrop(); changed(); return; }
  const target = a === "orig" ? v.width / v.height : a;
  const frameAr = v.width / v.height;
  let w = 1, hh = 1;
  if (target > frameAr) hh = frameAr / target; else w = target / frameAr;
  S.crop = { enabled: true, x: (1 - w) / 2, y: (1 - hh) / 2, w, h: hh, aspect: a };
  changed();
}

function crfFor(f) {
  const c = CRF[f];
  if (!c) return null;
  const v = S.out.crfBy[f];
  return v == null ? c[2] : clamp(v, c[0], c[1]);
}
function tenFor(f) { return S.out.tenBy[f] == null ? !!TEN_DEFAULT[f] : S.out.tenBy[f]; }
function encAvailable(f) {
  const g = S.config.gpu;
  return (f === "h264" || f === "mkv") ? g.h264 : f === "h265" ? g.hevc : false;
}

function settings() {
  const o = S.out, f = o.format;
  const gpu = o.encoder === "gpu" && encAvailable(f);
  return {
    segments: mergedSegs().map((s) => ({ start: +s.start.toFixed(3), end: +s.end.toFixed(3), speed: s.speed })),
    aregions: S.aregs.some((r) => r.vol !== 1) ? S.aregs.map((r) => ({ start: +r.start.toFixed(3), end: +r.end.toFixed(3), vol: r.vol })) : [],
    crop: { enabled: S.crop.enabled, x: S.crop.x, y: S.crop.y, w: S.crop.w, h: S.crop.h },
    rotate: S.rotate, flip_h: S.flip_h, flip_v: S.flip_v,
    grade: { lut: S.grade.lut || null, intensity: S.grade.intensity, exposure: S.grade.exposure, contrast: S.grade.contrast, highlights: S.grade.highlights,
      shadows: S.grade.shadows, saturation: S.grade.saturation, temperature: S.grade.temperature, tint: S.grade.tint },
    sharpen: S.grade.sharpen,
    output: {
      format: f, height: o.height, fps: o.fps, mode: o.mode, crf: crfFor(f), size_mb: o.size_mb, preset: o.preset,
      encoder: gpu ? "gpu" : "cpu", ten_bit: tenFor(f), tonemap: o.tonemap, slowmo: o.slowmo,
      audio: { mode: f === "mp3" ? "keep" : o.audioMode, bitrate: o.abr, volume: o.volume, track: S.atrack }, fade_in: o.fade_in, fade_out: o.fade_out,
    },
    subs: S.subs.key && f !== "mp3" && f !== "copy" ? { key: S.subs.key, mode: S.subs.mode === "soft" && softOk()[0] ? "soft" : "burn", size: S.subs.size } : null,
    tracks: f === "gif" ? [] : S.tracks.map((c) => ({ asset: c.asset, offset: +c.offset.toFixed(3), trim_in: +c.trim_in.toFixed(3), trim_out: +c.trim_out.toFixed(3), vol: c.vol, fade_in: c.fade_in, fade_out: c.fade_out })),
  };
}

function mergedSegs() {
  const out = [];
  for (const s of S.segs) {
    const p = out[out.length - 1];
    if (p && Math.abs(p.end - s.start) < 1e-3 && p.speed === s.speed) p.end = s.end;
    else out.push({ start: s.start, end: s.end, speed: s.speed });
  }
  return out;
}

function changed() {
  renderAll();
  record();
  auDirty();
}

const hist = { past: [], future: [], cur: null, timer: null };
function snap() {
  return JSON.stringify({ segs: S.segs, sel: S.sel, crop: S.crop, rotate: S.rotate, flip_h: S.flip_h, flip_v: S.flip_v,
    grade: S.grade, subs: { key: S.subs.key, mode: S.subs.mode, size: S.subs.size }, atrack: S.atrack, out: S.out, tracks: S.tracks, aregs: S.aregs });
}
function resetHistory() {
  hist.past = []; hist.future = []; hist.cur = S.media ? snap() : null;
  updateUndoButtons();
}
function record() {
  clearTimeout(hist.timer);
  if (!S.media) return;
  const cur = snap();
  if (hist.cur === null) { hist.cur = cur; return; }
  if (cur === hist.cur) return;
  hist.past.push(hist.cur);
  if (hist.past.length > 200) hist.past.shift();
  hist.cur = cur;
  hist.future = [];
  updateUndoButtons();
  scheduleSave();
}
function recordSoon() {
  clearTimeout(hist.timer);
  hist.timer = setTimeout(record, 500);
}
function restore(str) {
  const x = JSON.parse(str);
  S.segs = x.segs; S.sel = Math.min(x.sel, x.segs.length - 1); S.crop = x.crop; S.rotate = x.rotate; S.flip_h = x.flip_h; S.flip_v = x.flip_v;
  S.grade = x.grade; S.subs = { ...S.subs, ...x.subs }; S.atrack = x.atrack; S.out = x.out; S.tracks = x.tracks || [];
  if (S.msel && !S.tracks.some((c) => c.uid === S.msel)) S.msel = null;
  if (x.aregs) S.aregs = x.aregs;
  hist.cur = str;
  scheduleSave();
  renderAll();
  gradeChanged();
  updateUndoButtons();
}
function undo() {
  record();
  if (!hist.past.length) return toast("No hay nada que deshacer");
  hist.future.push(hist.cur);
  restore(hist.past.pop());
}
function redo() {
  record();
  if (!hist.future.length) return toast("No hay nada que rehacer");
  hist.past.push(hist.cur);
  restore(hist.future.pop());
}
function updateUndoButtons() {
  $("undoBtn").disabled = !hist.past.length;
  $("redoBtn").disabled = !hist.future.length;
}
$("undoBtn").onclick = undo;
$("redoBtn").onclick = redo;

function renderAll() {
  if (!S.media) return;
  renderTimeline();
  liveLut();
  renderOutput();
  renderCrop();
  renderSliders();
  renderLutSel();
  renderSubs();
  renderAudio();
  scheduleEstimate();
}

function assetOf(id) { return (S.media && (S.media.music || []).find((x) => x.id === id)) || null; }
let uidN = 0;
function newUid() { return Date.now().toString(36) + (uidN++).toString(36); }
function normTrack(c) {
  if (!c || !c.asset) return null;
  const a = assetOf(c.asset);
  const dur = a ? a.duration : Math.max(+c.trim_out || 0, 0.1);
  const ti = clamp(+c.trim_in || 0, 0, Math.max(0, dur - 0.1));
  return { uid: c.uid || newUid(), asset: c.asset, offset: Math.max(0, +c.offset || 0), trim_in: ti, trim_out: clamp(+c.trim_out || dur, ti + 0.1, dur),
    vol: c.vol == null ? 1 : clamp(+c.vol, 0, 4), fade_in: +c.fade_in || 0, fade_out: +c.fade_out || 0, lane: Math.max(0, Math.round(+c.lane || 0)) };
}
function legacyTracks(M) {
  const a = assetOf(M.id);
  if (!a) return [];
  const ti = +M.trim_in || 0, to = +M.trim_out || a.duration, L = Math.max(0.1, to - ti);
  const base = { asset: M.id, trim_in: ti, trim_out: to, vol: M.vol == null ? 1 : +M.vol, fade_in: +M.fade_in || 0, fade_out: +M.fade_out || 0, lane: 0 };
  const out = [normTrack({ ...base, offset: +M.offset || 0 })];
  if (M.loop) {
    const T = outTotal();
    for (let o = (+M.offset || 0) + L; o < T - 0.05 && out.length < 32; o += L) out.push(normTrack({ ...base, offset: o, fade_in: 0 }));
  }
  return out.filter(Boolean);
}
function trackEnd(c) { return c.offset + (c.trim_out - c.trim_in); }
function laneFree(lane, a, b, skip) { return !S.tracks.some((c) => c !== skip && c.lane === lane && c.offset < b - 0.01 && trackEnd(c) > a + 0.01); }
function placeTrack(c) {
  if (laneFree(c.lane, c.offset, trackEnd(c), c)) return;
  for (let l = 0; l < 16; l++) if (laneFree(l, c.offset, trackEnd(c), c)) { c.lane = l; return; }
}
function compactLanes() {
  const used = [...new Set(S.tracks.map((c) => c.lane))].sort((a, b) => a - b);
  S.tracks.forEach((c) => { c.lane = used.indexOf(c.lane); });
}
function addTrack(asset, at) {
  const a = assetOf(asset);
  if (!a) return;
  const T = outTotal();
  let o = at == null ? curOut() : at;
  if (o >= T - 0.1) o = 0;
  const c = normTrack({ asset, offset: o, trim_in: 0, trim_out: a.duration, lane: 0 });
  placeTrack(c);
  S.tracks.push(c);
  S.msel = c.uid;
  setLane("music");
  changed();
}
function removeTrack(uid) {
  S.tracks = S.tracks.filter((c) => c.uid !== uid);
  if (S.msel === uid) S.msel = null;
  compactLanes();
  changed();
}
function splitTrack(c, o) {
  const at = c.trim_in + (o - c.offset);
  if (o - c.offset < 0.1 || trackEnd(c) - o < 0.1) return toast(o <= c.offset || o >= trackEnd(c) ? "El cursor no está sobre este audio" : "Ya hay un corte aquí");
  const b = { ...c, uid: newUid(), offset: o, trim_in: at, fade_in: 0 };
  c.trim_out = at;
  c.fade_out = 0;
  S.tracks.push(b);
  S.msel = b.uid;
  changed();
}

function renderAudio() {
  if (!S.media) return;
  const m = S.media, o = S.out, f = o.format;
  const hasAudio = !!m.info.audio;
  const n0 = S.tracks.length;
  S.tracks = S.tracks.filter((c) => assetOf(c.asset));
  if (S.tracks.length !== n0) compactLanes();
  $("audioCard").classList.toggle("dim", f === "gif");
  $("origAudioBox").classList.toggle("hidden", !hasAudio);
  $("noOrigAudio").classList.toggle("hidden", hasAudio);
  setOn("[data-a]", (b) => b.dataset.a === o.audioMode);
  const auds = m.info.audios || [];
  $("atrackBox").classList.toggle("hidden", auds.length < 2 || o.audioMode === "mute");
  if (auds.length > 1) {
    $("atrack").replaceChildren(...auds.map((x, i) => h("option", { value: i }, `#${i + 1} ${[x.lang ? x.lang.toUpperCase() : null, x.codec, x.channels ? x.channels + " canales" : null, x.title].filter(Boolean).join(" · ")}`)));
    $("atrack").value = String(S.atrack);
  }
  $("volRow").classList.toggle("hidden", o.audioMode === "mute");
  $("volume").value = o.volume;
  $("volVal").textContent = Math.round(o.volume * 100) + "%";
  const lib = m.music || [];
  $("musChips").replaceChildren(...(lib.length ? lib.map((x) => {
    const uses = S.tracks.filter((c) => c.asset === x.id).length;
    return h("div", { class: "aitem" },
      h("span", { class: "grow ellipsis", title: x.name }, "🎵 " + x.name),
      h("span", { class: "muted small mono" }, fmtT(x.duration) + (uses ? ` · ${uses} en uso` : "")),
      h("button", { class: "btn sm soft", title: "Ponerlo en la línea de tiempo, en el cursor", onclick: () => addTrack(x.id) }, "＋"),
      h("button", { class: "icon", title: "Borrar este audio", onclick: async () => {
        if (!(await confirmBox(uses ? `¿Borrar «${x.name}»? También se quitará de la línea de tiempo.` : `¿Borrar «${x.name}»?`))) return;
        try { m.music = await api("DELETE", `/api/media/${m.id}/music/${x.id}`); } catch (err) { return toast(err.message, "err"); }
        S.tracks = S.tracks.filter((c) => c.asset !== x.id);
        compactLanes();
        changed();
      } }, "✕"));
  }) : [h("div", { class: "muted small" }, "Aún no has subido ningún audio.")]));
  audioSources();
}

async function uploadMusic(f) {
  if (!S.media) return toast("Abre primero un vídeo para añadirle audio", "err");
  if (f.size > 500 * 1024 * 1024) return toast("Ese audio es demasiado grande (máximo 500 MB)", "err");
  const fd = new FormData();
  fd.append("file", f);
  const mid = S.media.id;
  const at = curOut();
  toast(`Subiendo «${f.name}»…`);
  try {
    const r = await api("POST", `/api/media/${mid}/music`, fd);
    if (!S.media || S.media.id !== mid) return;
    S.media.music = r.items;
    addTrack(r.item.id, at);
    toast(`«${f.name}» añadido a la línea de tiempo`, "ok");
  } catch (e) { toast(e.message, "err"); }
}

function curSub() {
  const k = S.subs.key;
  if (!k || !S.media) return null;
  if (k.startsWith("e:")) {
    const x = (S.media.info.subtitles || [])[+k.slice(2)];
    return x ? { text: x.text, image: x.image, ass: x.codec === "ass" || x.codec === "ssa" } : null;
  }
  const x = (S.media.ext_subs || []).find((y) => "x:" + y.id === k);
  return x ? { text: true, image: false, ass: x.ext === ".ass" || x.ext === ".ssa" } : null;
}

function softOk() {
  const f = S.out.format, sub = curSub();
  if (!sub) return [false, ""];
  if (!["h264", "h265", "av1", "mkv", "vp9"].includes(f)) return [false, "Este formato no admite pistas de subtítulos, así que se quemarán en la imagen."];
  const ms = mergedSegs();
  if (ms.length !== 1 || ms[0].speed !== 1) return [false, "Como pista solo funciona con un único clip a velocidad normal; con cortes o cambios de velocidad se quemarán en la imagen."];
  if (sub.image && f !== "mkv") return [false, "Los subtítulos de imagen (PGS/DVD) como pista solo caben en MKV; en este formato se quemarán."];
  return [true, ""];
}

function setSub(key) {
  S.subs.key = key;
  renderSubs();
  scheduleEstimate();
  gradeChanged();
}

let trackKey = null;
function updateTrack() {
  const sub = curSub();
  const want = S.media && S.subs.live && sub && !sub.image ? `${S.media.id}/${S.subs.key}` : "";
  if (want === trackKey) return;
  trackKey = want;
  video.querySelectorAll("track").forEach((t) => t.remove());
  if (!want) return;
  const t = h("track", { kind: "subtitles", label: "Subtítulos", srclang: "es", default: "", src: `/api/media/${S.media.id}/vtt/${encodeURIComponent(S.subs.key)}` });
  t.addEventListener("error", () => toast("No se pudieron cargar los subtítulos en el reproductor", "err"));
  video.append(t);
  setTimeout(() => { for (const tt of video.textTracks) tt.mode = "showing"; }, 50);
}

function renderSubs() {
  if (!S.media) return;
  const m = S.media;
  const emb = m.info.subtitles || [];
  const ext = m.ext_subs || [];
  const chips = [h("button", { class: "chip" + (!S.subs.key ? " on" : ""), onclick: () => setSub("") }, "Ninguno")];
  emb.forEach((x, i) => {
    const bits = [x.lang ? x.lang.toUpperCase() : null, SUB_CODEC[x.codec] || x.codec, x.title, x.forced ? "forzados" : null].filter(Boolean).join(" · ");
    chips.push(h("button", { class: "chip" + (S.subs.key === "e:" + i ? " on" : ""), title: "Pista incluida en el vídeo", disabled: !x.text && !x.image ? "" : null, onclick: () => setSub("e:" + i) }, `#${i + 1} ${bits}`));
  });
  ext.forEach((x) => {
    chips.push(h("button", { class: "chip" + (S.subs.key === "x:" + x.id ? " on" : ""), title: "Archivo subido", onclick: () => setSub("x:" + x.id) }, "📄 " + x.name,
      h("span", { class: "del", title: "Borrar", onclick: async (e) => {
        e.stopPropagation();
        if (!(await confirmBox(`¿Borrar «${x.name}»?`))) return;
        m.ext_subs = await api("DELETE", `/api/media/${m.id}/subs/${x.id}`);
        if (S.subs.key === "x:" + x.id) S.subs.key = "";
        renderSubs(); gradeChanged();
      } }, "✕")));
  });
  $("subChips").replaceChildren(...chips);
  const sub = curSub();
  if (S.subs.key && !sub) S.subs.key = "";
  $("subOpts").classList.toggle("hidden", !sub);
  $("subsCard").classList.toggle("dim", !isVideoFmt(S.out.format));
  if (sub) {
    const [ok, why] = softOk();
    const eff = S.subs.mode === "soft" && ok ? "soft" : "burn";
    setOn("[data-sm]", (b) => b.dataset.sm === eff);
    $("subSizeRow").classList.toggle("hidden", eff !== "burn" || sub.ass || sub.image);
    $("subSize").value = S.subs.size;
    $("subSizeVal").textContent = Math.round(S.subs.size * 100) + "%";
    const notes = [];
    if (S.subs.mode === "soft" && !ok) notes.push(why);
    if (eff === "burn" && sub.ass) notes.push("Los .ass mantienen su estilo, posición y fuentes; si vienen del MKV se usan las fuentes que trae.");
    if (sub.image) notes.push("Los subtítulos de imagen no se ven en la vista previa, pero sí en el render.");
    $("subNote").textContent = notes.join(" ");
    $("subNote").classList.toggle("hidden", !notes.length);
  }
  $("subLive").checked = S.subs.live;
  updateTrack();
}

function defaultName() {
  const stem = S.media.name.replace(/\.[^.]+$/, "");
  const f = S.out.format;
  if (f === "copy") return stem + "_corte";
  if (f === "mp3") return stem;
  const g = geom();
  const tag = S.out.height && S.out.height < g.short ? (RES_NAME[S.out.height] || S.out.height + "p") : "editado";
  return `${stem}_${tag}`;
}

function outExt() {
  const f = S.config.formats.find((x) => x.id === S.out.format);
  if (f && f.ext) return "." + f.ext;
  const src = S.media.name.toLowerCase();
  return /\.(mp4|mov|m4v)$/.test(src) ? ".mp4" : ".mkv";
}

function setOn(sel, test) { document.querySelectorAll(sel).forEach((b) => b.classList.toggle("on", test(b))); }

function renderOutput() {
  const o = S.out, f = o.format, v = S.media.info.video, g = geom();
  setOn("#fmtGrid .fmt", (b) => b.dataset.f === f);
  const video = isVideoFmt(f);
  $("videoOpts").classList.toggle("hidden", !video);
  $("copyNote").classList.toggle("hidden", f !== "copy");
  $("cropCard").classList.toggle("dim", !video);
  $("colorCard").classList.toggle("dim", !video);

  const opts = [h("button", { class: "chip" + (!o.height || o.height >= g.short ? " on" : ""), onclick: () => { S.out.height = 0; changed(); } }, `Original · ${g.rw - (g.rw % 2)}×${g.rh - (g.rh % 2)}`)];
  for (const r of RES) {
    if (r >= g.short) continue;
    if (f === "gif" && r > 480) continue;
    const k = r / g.short;
    opts.push(h("button", { class: "chip" + (o.height === r ? " on" : ""), onclick: () => { S.out.height = r; changed(); } }, `${RES_NAME[r]} · ${even(g.rw * k)}×${even(g.rh * k)}`));
  }
  $("resChips").replaceChildren(...opts);

  const fpsList = f === "gif" ? [10, 12, 15, 20, 25] : [0, 60, 50, 30, 25, 24];
  $("fpsChips").replaceChildren(...fpsList.map((x) => h("button", { class: "chip" + ((o.fps || 0) === x ? " on" : ""), onclick: () => { S.out.fps = x; changed(); } }, x ? String(x) : `Original · ${+v.fps.toFixed(2)}`)));

  const hasQ = !!CRF[f];
  $("qualityBlock").classList.toggle("hidden", !hasQ);
  if (hasQ) {
    setOn("[data-mode]", (b) => b.dataset.mode === o.mode);
    $("crfBox").classList.toggle("hidden", o.mode !== "crf");
    $("sizeBox").classList.toggle("hidden", o.mode !== "size");
    const [mn, mx] = CRF[f];
    const crf = crfFor(f);
    const inp = $("crf");
    inp.min = mn; inp.max = mx; inp.value = crf;
    inp.style.direction = "rtl";
    $("crfVal").textContent = "CRF " + crf;
    const t = (crf - mn) / (mx - mn);
    $("crfLbl").textContent = t < 0.2 ? "Máxima" : t < 0.4 ? "Alta" : t < 0.65 ? "Equilibrada" : "Compacta";
    $("sizeMb").value = o.size_mb;
    const gpuOk = encAvailable(f);
    $("encBox").classList.toggle("hidden", !gpuOk);
    const gpu = gpuOk && o.encoder === "gpu";
    setOn("[data-e]", (b) => b.dataset.e === (gpu ? "gpu" : "cpu"));
    $("presetChips").previousElementSibling.classList.toggle("hidden", gpu);
    $("presetChips").classList.toggle("hidden", gpu);
    setOn("[data-p]", (b) => b.dataset.p === o.preset);
    const tenOk = (f === "h265") || (!gpu && (f === "av1" || f === "vp9"));
    $("tenBitBox").classList.toggle("hidden", !tenOk);
    $("tenBit").checked = tenFor(f);
  }
  $("hdrBox").classList.toggle("hidden", !(v.hdr && S.config.hdr_tonemap && video));
  $("tonemap").checked = o.tonemap;
  const slow = S.segs.some((s) => s.speed < 1) && video;
  $("slowBox").classList.toggle("hidden", !slow);
  setOn("[data-s]", (b) => b.dataset.s === o.slowmo);
  $("fadeIn").value = String(o.fade_in);
  $("fadeOut").value = String(o.fade_out);

  const hasAudio = !!S.media.info.audio;
  const mus = S.tracks.length > 0;
  const outAudio = (hasAudio && (o.audioMode !== "mute" || f === "mp3")) || mus;
  $("audioOpts").classList.toggle("hidden", f === "gif" || f === "copy" || !outAudio);
  setOn("#abrChips .chip", (b) => +b.dataset.b === o.abr);

  if (!S.nameDirty) S.name = defaultName();
  if (document.activeElement !== $("outName")) $("outName").value = S.name;
  $("outExt").textContent = outExt();

  const label = (S.config.formats.find((x) => x.id === f) || {}).label || f;
  const speedBad = f === "copy" && S.segs.some((s) => s.speed !== 1);
  const audBad = f === "copy" && (mus || S.aregs.some((r) => r.vol !== 1));
  const noAudio = f === "mp3" && !hasAudio && !mus;
  const upl = S.media.proxy_status === "uploading";
  const btn = $("renderBtn");
  btn.disabled = upl || speedBad || audBad || noAudio;
  btn.textContent = upl ? `Subiendo el vídeo… ${Math.round((S.media.upload_progress || 0) * 100)}%` : speedBad ? "Sin recodificar no admite cambios de velocidad" : audBad ? "Sin recodificar no admite cambios de audio" : noAudio ? "Este vídeo no tiene audio" : `Renderizar ${label}`;
  const d = S.segs.reduce((a, s) => a + (s.end - s.start) / s.speed, 0);
  const nm = mergedSegs().length;
  $("sDur").textContent = fmtDur(d) + (nm > 1 ? ` · ${nm} clips` : "");
  $("sFrame").textContent = f === "mp3" ? "–" : f === "copy" ? `${v.width}×${v.height}` : `${g.w}×${g.h} · ${+(o.fps || v.fps).toFixed(2)} fps`;
}

$("crf").addEventListener("input", () => { S.out.crfBy[S.out.format] = +$("crf").value; changed(); });
$("sizeMb").addEventListener("input", () => { const x = +$("sizeMb").value; if (x > 0) { S.out.size_mb = x; scheduleEstimate(); recordSoon(); } });
$("tenBit").addEventListener("change", () => { S.out.tenBy[S.out.format] = $("tenBit").checked; changed(); });
$("tonemap").addEventListener("change", () => { S.out.tonemap = $("tonemap").checked; changed(); gradeChanged(); });
$("volume").addEventListener("input", () => { S.out.volume = +$("volume").value; $("volVal").textContent = Math.round(S.out.volume * 100) + "%"; auDirty(); recordSoon(); });
$("atrack").addEventListener("change", () => { S.atrack = +$("atrack").value; audioSources(); scheduleEstimate(); record(); });
$("subSize").addEventListener("input", () => { S.subs.size = +$("subSize").value; $("subSizeVal").textContent = Math.round(S.subs.size * 100) + "%"; gradeChanged(); });
$("subLive").addEventListener("change", () => { S.subs.live = $("subLive").checked; updateTrack(); });
$("subFile").addEventListener("change", () => { const f = $("subFile").files[0]; $("subFile").value = ""; if (f) uploadSub(f); });

async function uploadSub(f) {
  if (!S.media) return toast("Abre primero un vídeo para añadirle subtítulos", "err");
  const fd = new FormData();
  fd.append("file", f);
  try {
    const r = await api("POST", `/api/media/${S.media.id}/subs`, fd);
    S.media.ext_subs = r.items;
    setSub("x:" + r.id);
    toast(`Subtítulos «${f.name}» añadidos`, "ok");
  } catch (e) { toast(e.message, "err"); }
}

async function uploadLut(f) {
  const fd = new FormData();
  fd.append("file", f);
  try {
    const r = await api("POST", "/api/luts", fd);
    await loadLuts(r.id);
    toast(`LUT «${f.name}» guardada`, "ok");
    renderSliders();
    gradeChanged();
  } catch (e) { toast(e.message, "err"); }
}

$("outName").addEventListener("input", () => { S.name = $("outName").value; S.nameDirty = !!S.name.trim(); if (!S.nameDirty) S.name = defaultName(); scheduleSave(); });

let estT = null, estSeq = 0;
function scheduleEstimate() {
  clearTimeout(estT);
  estT = setTimeout(async () => {
    if (!S.media) return;
    const seq = ++estSeq;
    try {
      const e = await api("POST", `/api/media/${S.media.id}/estimate`, settings());
      if (seq !== estSeq) return;
      const target = S.out.mode === "size" && CRF[S.out.format];
      $("sSize").textContent = (target ? "" : "≈ ") + fmtSize(e.size) + (target ? " (objetivo)" : "");
    } catch { $("sSize").textContent = "–"; }
  }, 250);
}

$("renderBtn").onclick = async () => {
  if (!S.media) return;
  const btn = $("renderBtn");
  btn.disabled = true;
  try {
    const j = await api("POST", "/api/jobs", { media_id: S.media.id, project_id: S.project ? S.project.id : null, settings: settings(), name: (S.name || defaultName()).trim() });
    S.jobsSeen[j.id] = j.status;
    toast(`«${j.name}» añadido a la cola`, "ok");
    pollJobs();
  } catch (e) { toast(e.message, "err"); }
  finally { btn.disabled = false; renderOutput(); }
};

const video = $("video");
video.muted = true;

function outTotal() { return S.segs.reduce((a, s) => a + (s.end - s.start) / s.speed, 0); }
function outTime(t) {
  let o = 0;
  for (const s of S.segs) {
    if (t >= s.end - 0.01) { o += (s.end - s.start) / s.speed; continue; }
    if (t >= s.start - 0.02) return o + Math.max(0, t - s.start) / s.speed;
    return null;
  }
  return null;
}

const AU = { ctx: null, mid: "", orig: { key: "", buf: null, peaks: null }, mus: new Map(), nodes: [], gains: [], playing: false,
  mode: "", startCtx: 0, startPos: 0, lastSync: 0, dirtyAt: 0, origMaster: null, stretch: new Map() };

function auCtx() {
  const m = S.media;
  if (!m) return null;
  if (AU.ctx && AU.mid === m.id) return AU.ctx;
  if (AU.ctx) { auStop(); AU.ctx.close().catch(() => {}); AU.ctx = null; }
  const d = m.info.duration || 0;
  const rate = d <= 900 ? 44100 : d <= 2400 ? 32000 : 22050;
  try { AU.ctx = new AudioContext({ sampleRate: rate, latencyHint: "interactive" }); }
  catch { try { AU.ctx = new AudioContext(); } catch { AU.ctx = null; } }
  AU.mid = m.id;
  AU.orig = { key: "", buf: null, peaks: null };
  AU.mus = new Map();
  AU.stretch.clear();
  return AU.ctx;
}
function auResume() { const c = auCtx(); if (c && c.state === "suspended") c.resume().catch(() => {}); }

async function auLoad(slot, url, isOrig) {
  if (slot.key === url || (url && slot.failed === url)) return;
  slot.key = url;
  slot.buf = null;
  if (isOrig) { slot.peaks = null; AU.stretch.clear(); drawWave(); }
  if (!url) return;
  const ctx = auCtx();
  if (!ctx) return;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.statusText);
    const data = await r.arrayBuffer();
    if (slot.key !== url) return;
    const buf = await ctx.decodeAudioData(data);
    if (slot.key !== url) return;
    slot.buf = buf;
    if (isOrig) { slot.peaks = computePeaks(buf); drawWave(); }
    else { slot.peaks = computePeaks(buf, 12000, false); renderMusic(); }
    AU.dirtyAt = 1;
  } catch {
    if (slot.key === url) { slot.key = ""; slot.failed = url; if (isOrig) drawWave(); }
  }
}

function computePeaks(buf, N = 6000, norm = true) {
  const len = buf.length, per = Math.max(1, Math.floor(len / N));
  const out = new Float32Array(N);
  const chs = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chs.push(buf.getChannelData(c));
  for (let i = 0; i < N; i++) {
    const a = Math.floor((i * len) / N), b = Math.min(len, a + per);
    let mx = 0;
    for (const d of chs) for (let j = a; j < b; j += 2) { const v = d[j] < 0 ? -d[j] : d[j]; if (v > mx) mx = v; }
    out[i] = mx;
  }
  let top = 0;
  for (let i = 0; i < N; i++) if (out[i] > top) top = out[i];
  if (norm && top > 0 && top < 0.5) { const k = 0.5 / top; for (let i = 0; i < N; i++) out[i] *= k; }
  return out;
}

function audioSources() {
  const m = S.media;
  if (!m) return;
  const ok = m.proxy_status === "ready";
  const loc = LOCAL.get(m.id);
  const useLocal = loc && loc.audio instanceof AudioBuffer && (S.atrack === 0 || !ok);
  const need = new Set(S.tracks.map((c) => c.asset));
  if (AU.ctx && AU.mid === m.id) for (const [id, slot] of AU.mus) if (!need.has(id)) { slot.key = ""; AU.mus.delete(id); }
  if (need.size && auCtx()) for (const id of need) {
    let slot = AU.mus.get(id);
    if (!slot) { slot = { key: "", buf: null, peaks: null }; AU.mus.set(id, slot); }
    auLoad(slot, `/api/media/${m.id}/music/${id}/preview?f=mp3&n=2`, false);
  }
  if (!ok && !useLocal) { if (!AU.orig.key.startsWith("local:")) auLoad(AU.orig, "", true); return; }
  auCtx();
  if (useLocal) {
    if (AU.orig.key !== "local:" + m.id) {
      AU.orig = { key: "local:" + m.id, buf: loc.audio, peaks: loc.peaks };
      AU.stretch.clear();
      AU.dirtyAt = 1;
      drawWave();
    }
  } else {
    const pa = m.preview_audio || [];
    const k = pa.includes(S.atrack) ? S.atrack : pa.length ? pa[0] : null;
    auLoad(AU.orig, k == null ? "" : `/api/media/${m.id}/audio/${k}?v=${m.preview_v}&n=2`, true);
  }
}

function auStop() {
  for (const n of AU.nodes) { try { n.onended = null; n.stop(); } catch {} try { n.disconnect(); } catch {} }
  for (const g of AU.gains) { try { g.disconnect(); } catch {} }
  AU.nodes = [];
  AU.gains = [];
  AU.origMaster = null;
  AU.playing = false;
}
function audioStop(clear) {
  auStop();
  if (clear) { auLoad(AU.orig, "", true); for (const slot of AU.mus.values()) slot.key = ""; AU.mus = new Map(); }
}

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
function stretchBuffer(ctx, buf, a, b, speed) {
  const sr = buf.sampleRate, nch = buf.numberOfChannels;
  const i0 = Math.max(0, Math.floor(a * sr)), i1 = Math.min(buf.length, Math.floor(b * sr));
  const nIn = Math.max(1, i1 - i0);
  const nOut = Math.max(1, Math.floor(nIn / speed));
  const W = (Math.round(sr * 0.05) >> 1) << 1, Ha = W >> 1, Hs = Ha * speed;
  const tol = Math.round(sr * 0.006), L = Ha;
  const win = hann(W);
  const inCh = [], outCh = [];
  const out = ctx.createBuffer(nch, nOut, sr);
  for (let c = 0; c < nch; c++) { inCh.push(buf.getChannelData(c)); outCh.push(out.getChannelData(c)); }
  const mono = new Float32Array(nIn);
  for (let c = 0; c < nch; c++) { const d = inCh[c]; for (let i = 0; i < nIn; i++) mono[i] += d[i0 + i]; }
  let prev = -1;
  for (let k = 0, op = 0; op < nOut; k++, op += Ha) {
    let ip = Math.round(k * Hs);
    if (prev >= 0) {
      const ref = prev + Ha;
      let best = 0, bestC = -Infinity;
      for (let d = -tol; d <= tol; d += 3) {
        const p = ip + d;
        if (p < 0 || p + L >= nIn || ref + L >= nIn) continue;
        let c = 0;
        for (let n = 0; n < L; n += 8) c += mono[ref + n] * mono[p + n];
        if (c > bestC) { bestC = c; best = d; }
      }
      ip += best;
    }
    ip = Math.min(Math.max(ip, 0), nIn - 1);
    const lim = Math.min(W, nIn - ip, nOut - op);
    for (let c = 0; c < nch; c++) {
      const src = inCh[c], dst = outCh[c], base = i0 + ip;
      for (let n = 0; n < lim; n++) dst[op + n] += src[base + n] * win[n];
    }
    prev = ip;
  }
  return out;
}
function stretched(s) {
  const buf = AU.orig.buf;
  const key = `${s.start.toFixed(3)}|${s.end.toFixed(3)}|${s.speed}`;
  let b = AU.stretch.get(key);
  if (!b) {
    if ((s.end - s.start) / s.speed > 1200) return null;
    b = stretchBuffer(AU.ctx, buf, s.start, s.end, s.speed);
    AU.stretch.set(key, b);
    if (AU.stretch.size > 24) AU.stretch.delete(AU.stretch.keys().next().value);
  }
  return b;
}

function srcAtOut(o) {
  let acc = 0;
  for (const s of S.segs) {
    const d = (s.end - s.start) / s.speed;
    if (o < acc + d) return s.start + (o - acc) * s.speed;
    acc += d;
  }
  const last = S.segs[S.segs.length - 1];
  return last ? last.end : 0;
}
function aregAt(t) {
  const r = S.aregs;
  for (let i = 0; i < r.length; i++) if (t < r[i].end || i === r.length - 1) return i;
  return -1;
}
function volAt(t) { const i = aregAt(t); return i >= 0 ? S.aregs[i].vol : 1; }

function envPoints(param, when, pos, len, peak, fi, fo) {
  const at = (x) => peak * fadeEnv(x, len, fi, fo);
  param.setValueAtTime(at(pos), when);
  const pts = [];
  if (fi > 0 && pos < fi) pts.push(fi);
  if (fo > 0 && pos < len - fo) pts.push(len - fo);
  if (fo > 0 && pos < len) pts.push(len);
  let last = pos;
  for (const x of pts) {
    if (x <= last) continue;
    param.linearRampToValueAtTime(at(x), when + (x - pos));
    last = x;
  }
}
function fadeEnv(x, len, fi, fo) {
  let g = 1;
  if (fi > 0) g = Math.min(g, x / fi);
  if (fo > 0) g = Math.min(g, (len - x) / fo);
  return clamp(g, 0, 1);
}

function auStart() {
  const ctx = auCtx();
  if (!ctx) return;
  auStop();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  AU.playing = true;
  AU.lastSync = performance.now();
  const now = ctx.currentTime + 0.04;
  AU.startCtx = now;
  const gif = S.out.format === "gif";
  const origOn = !gif && S.out.audioMode !== "mute" && AU.orig.buf;
  const fade = ctx.createGain();
  fade.connect(ctx.destination);
  AU.gains.push(fade);
  const om = ctx.createGain();
  om.gain.value = S.out.volume;
  om.connect(fade);
  AU.gains.push(om);
  AU.origMaster = om;
  AU.mode = "out";
  let t0 = video.currentTime;
  let i = segAt(t0);
  if (i < 0) {
    i = S.segs.findIndex((s) => s.start > t0);
    if (i < 0) { AU.playing = false; return; }
    t0 = S.segs[i].start;
  }
  t0 = Math.max(t0, S.segs[i].start);
  const o0 = outTime(t0) || 0;
  AU.startPos = o0;
  const T = outTotal();
  envPoints(fade.gain, now, o0, T, 1, S.out.fade_in, S.out.fade_out);
  if (origOn) {
    let acc = 0;
    for (let j = 0; j < S.segs.length; j++) {
      const s = S.segs[j];
      const d = (s.end - s.start) / s.speed;
      if (j < i) { acc += d; continue; }
      const from = j === i ? t0 : s.start;
      const when = Math.max(now, now + (acc + (from - s.start) / s.speed - o0));
      acc += d;
      const len = s.end - from;
      if (len <= 0.005 || from >= AU.orig.buf.duration) continue;
      const g = ctx.createGain();
      g.connect(om);
      AU.gains.push(g);
      g.gain.setValueAtTime(volAt(from), when);
      for (const r of S.aregs) if (r.start > from && r.start < s.end) g.gain.setValueAtTime(r.vol, when + (r.start - from) / s.speed);
      const src = ctx.createBufferSource();
      if (Math.abs(s.speed - 1) < 1e-6) {
        src.buffer = AU.orig.buf;
        src.start(when, from, len);
      } else {
        const sb = stretched(s);
        if (sb) { src.buffer = sb; src.start(when, Math.max(0, (from - s.start) / s.speed), len / s.speed); }
        else { src.buffer = AU.orig.buf; src.playbackRate.value = s.speed; src.start(when, from, len); }
      }
      src.connect(g);
      AU.nodes.push(src);
    }
  }
  if (gif) return;
  for (const c of S.tracks) {
    const slot = AU.mus.get(c.asset);
    if (!slot || !slot.buf) continue;
    const tin = c.trim_in, tout = Math.min(c.trim_out, slot.buf.duration);
    const mlen = Math.min(Math.max(0, tout - tin), Math.max(0, T - c.offset));
    const rel0 = o0 - c.offset;
    if (mlen < 0.02 || rel0 >= mlen) continue;
    const relStart = Math.max(0, rel0);
    const when = now + Math.max(0, -rel0);
    const g = ctx.createGain();
    g.connect(fade);
    AU.gains.push(g);
    envPoints(g.gain, when, relStart, mlen, c.vol, Math.min(c.fade_in, mlen / 2), Math.min(c.fade_out, mlen / 2));
    const src = ctx.createBufferSource();
    src.buffer = slot.buf;
    src.start(when, tin + relStart, mlen - relStart);
    src.connect(g);
    AU.nodes.push(src);
  }
}

function auPos() { return AU.startPos + Math.max(0, AU.ctx.currentTime - AU.startCtx); }

function auTick() {
  const loc = S.media && LOCAL.get(S.media.id);
  const viaVideo = !!(loc && !AU.orig.buf && video.getAttribute("src") === loc.url && S.media.info.audio && S.out.audioMode !== "mute");
  if (video.muted === viaVideo) video.muted = !viaVideo;
  if (viaVideo) { const vv = Math.min(1, S.out.volume); if (Math.abs(video.volume - vv) > 0.01) video.volume = vv; }
  const want = S.media && !video.paused && !scrub.active && video.readyState >= 1;
  if (!want) { if (AU.playing) auStop(); return; }
  if (!AU.ctx) return;
  if (!AU.playing || (AU.dirtyAt && performance.now() - AU.dirtyAt > 120)) { AU.dirtyAt = 0; auStart(); return; }
  if (video.seeking || performance.now() - AU.lastSync < 400 || AU.ctx.currentTime < AU.startCtx) return;
  const p = auPos();
  const target = AU.mode === "out" ? srcAtOut(p) : p;
  const cur = video.currentTime;
  const i = segAt(cur);
  const rate = AU.mode === "out" && i >= 0 ? S.segs[i].speed : 1;
  if (Math.abs(cur - target) > 0.12 * Math.max(1, rate)) {
    AU.lastSync = performance.now();
    video.currentTime = target;
  }
}
function auDirty() { if (AU.playing) AU.dirtyAt = AU.dirtyAt || performance.now(); if (AU.origMaster) AU.origMaster.gain.value = S.out.volume; }
const LOCAL = new Map();
let mp4boxP = null;
function loadMp4box() {
  if (!mp4boxP) mp4boxP = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "/mp4box.min.js";
    s.onload = () => res(window.MP4Box);
    s.onerror = () => { mp4boxP = null; rej(new Error("mp4box")); };
    document.head.append(s);
  });
  return mp4boxP;
}

async function readMoov(file) {
  if (!/\.(mp4|mov|m4v|lrv|3gp)$/i.test(file.name)) return null;
  const MP4Box = await loadMp4box();
  const mp = MP4Box.createFile(false);
  let info = null, bad = false;
  mp.onReady = (i) => { info = i; };
  mp.onError = () => { bad = true; };
  let off = 0, guard = 0;
  while (!info && !bad && off < file.size && guard++ < 4000) {
    const ab = await file.slice(off, off + (1 << 20)).arrayBuffer();
    ab.fileStart = off;
    const next = mp.appendBuffer(ab);
    off = next && next > off ? next : off + ab.byteLength;
  }
  return info ? { mp, info } : null;
}

function probeVideo(url) {
  return new Promise((res) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    let done = false;
    const fin = (ok) => {
      if (done) return;
      done = true;
      const r = ok && v.videoWidth > 0 && isFinite(v.duration) && v.duration > 0 ? { duration: v.duration, width: v.videoWidth, height: v.videoHeight } : null;
      v.removeAttribute("src");
      v.load();
      res(r);
    };
    v.addEventListener("loadeddata", () => fin(true), { once: true });
    v.addEventListener("error", () => fin(false), { once: true });
    setTimeout(() => fin(v.readyState >= 2), 6000);
    v.src = url;
  });
}

async function probeLocal(file) {
  const url = URL.createObjectURL(file);
  const pv = await probeVideo(url);
  if (!pv) { URL.revokeObjectURL(url); return null; }
  let moov = null;
  try { moov = await readMoov(file); } catch {}
  let audio = true, fps = 0;
  if (moov) {
    audio = moov.info.audioTracks.length > 0;
    const vt = moov.info.videoTracks[0];
    if (vt && vt.nb_samples && vt.duration) fps = Math.round((vt.nb_samples / (vt.duration / vt.timescale)) * 1000) / 1000;
  }
  return { url, moov, meta: { duration: pv.duration, width: pv.width, height: pv.height, audio, fps } };
}

async function extractAudio(file, moov) {
  if (!moov || typeof AudioDecoder === "undefined") return null;
  const { mp, info } = moov;
  const at = info.audioTracks[0];
  if (!at) return null;
  const trak = mp.getTrackById(at.id);
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  let description;
  try {
    const d = entry.esds && entry.esds.esd.descs[0].descs[0];
    if (d && d.data) description = d.data;
  } catch {}
  const config = { codec: at.codec, sampleRate: at.audio.sample_rate, numberOfChannels: at.audio.channel_count };
  if (description) config.description = description;
  const sup = await AudioDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!sup.supported) return null;
  const samples = mp.getTrackSamplesInfo(at.id) || [];
  if (!samples.length) return null;
  const ts = at.timescale;
  let mediaTime = 0;
  try { const e = trak.edts && trak.edts.elst && trak.edts.elst.entries[0]; if (e && e.media_time > 0) mediaTime = e.media_time; } catch {}
  const total = info.duration / info.timescale;
  let sr = 0, nch = 0, chans = null, maxEnd = 0, err = null;
  const dec = new AudioDecoder({
    output: (a) => {
      try {
        if (!chans) {
          sr = a.sampleRate;
          nch = Math.min(2, a.numberOfChannels);
          const len = Math.ceil((total + 1) * sr);
          chans = Array.from({ length: nch }, () => new Float32Array(len));
        }
        const start = Math.round((a.timestamp / 1e6) * sr);
        const n = a.numberOfFrames;
        const tmp = new Float32Array(n);
        for (let c = 0; c < nch; c++) {
          a.copyTo(tmp, { planeIndex: Math.min(c, a.numberOfChannels - 1), format: "f32-planar" });
          const dst = chans[c];
          let from = 0, at0 = start;
          if (at0 < 0) { from = -at0; at0 = 0; }
          const lim = Math.min(n, dst.length - at0 + from);
          if (lim > from) dst.set(tmp.subarray(from, lim), at0);
        }
        if (start + n > maxEnd) maxEnd = start + n;
      } finally { a.close(); }
    },
    error: (e) => { err = e; },
  });
  dec.configure(config);
  const order = samples.slice().sort((x, y) => x.offset - y.offset);
  const GAP = 2 << 20, BLOCK = 24 << 20;
  let i = 0;
  while (i < order.length && !err) {
    let j = i;
    const base = order[i].offset;
    while (j + 1 < order.length && order[j + 1].offset - (order[j].offset + order[j].size) <= GAP && order[j + 1].offset + order[j + 1].size - base <= BLOCK) j++;
    const end = order[j].offset + order[j].size;
    const buf = new Uint8Array(await file.slice(base, end).arrayBuffer());
    for (let k = i; k <= j; k++) {
      const s = order[k];
      dec.decode(new EncodedAudioChunk({ type: "key", timestamp: Math.round(((s.cts - mediaTime) / ts) * 1e6), duration: Math.round((s.duration / ts) * 1e6), data: buf.subarray(s.offset - base, s.offset - base + s.size) }));
    }
    i = j + 1;
    while (dec.decodeQueueSize > 2000 && !err) await new Promise((r) => dec.addEventListener("dequeue", r, { once: true }));
  }
  if (!err) await dec.flush().catch((e) => { err = e; });
  try { dec.close(); } catch {}
  if (err || !chans || !maxEnd) return null;
  const len = Math.min(chans[0].length, Math.max(maxEnd, Math.round(total * sr)));
  const out = new AudioBuffer({ length: len, numberOfChannels: nch, sampleRate: sr });
  for (let c = 0; c < nch; c++) out.copyToChannel(chans[c].subarray(0, len), c);
  return out;
}

function seekVideo(v, t) {
  return new Promise((r) => {
    let done = false;
    const f = () => { if (done) return; done = true; v.removeEventListener("seeked", f); r(); };
    v.addEventListener("seeked", f);
    setTimeout(f, 4000);
    v.currentTime = t;
  });
}

async function localThumbs(mid) {
  const loc = LOCAL.get(mid);
  if (!loc || loc.thumbs) return;
  loc.thumbs = "loading";
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = loc.url;
  const ok = await new Promise((r) => {
    v.addEventListener("loadeddata", () => r(true), { once: true });
    v.addEventListener("error", () => r(false), { once: true });
    setTimeout(() => r(v.readyState >= 2), 8000);
  });
  if (!ok || !v.videoWidth) { loc.thumbs = "none"; return; }
  const N = 24, TW = 192, TH = 108;
  const cv = document.createElement("canvas");
  cv.width = N * TW;
  cv.height = TH;
  const g = cv.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, cv.width, TH);
  const d = v.duration, vw = v.videoWidth, vh = v.videoHeight;
  const k = Math.max(TW / vw, TH / vh), dw = vw * k, dh = vh * k;
  for (let i = 0; i < N; i++) {
    if (!LOCAL.has(mid)) return;
    await seekVideo(v, Math.min(d - 0.05, ((i + 0.5) * d) / N));
    g.save();
    g.beginPath();
    g.rect(i * TW, 0, TW, TH);
    g.clip();
    g.drawImage(v, i * TW + (TW - dw) / 2, (TH - dh) / 2, dw, dh);
    g.restore();
    if (i % 3 === 2 || i === N - 1) {
      loc.thumbs = cv.toDataURL("image/jpeg", 0.72);
      if (S.media && S.media.id === mid && !S.media.thumbs) setThumbs(`url("${loc.thumbs}")`);
    }
  }
  v.removeAttribute("src");
  v.load();
}

async function localAudio(mid) {
  const loc = LOCAL.get(mid);
  if (!loc || loc.audio) return;
  loc.audio = "loading";
  drawWave();
  let buf = null;
  try { buf = await extractAudio(loc.file, loc.moov); } catch {}
  if (!buf && loc.file.size <= 400 * 1024 * 1024) {
    try {
      const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      buf = await new C(2, 44100, 44100).decodeAudioData(await loc.file.arrayBuffer());
    } catch { buf = null; }
  }
  loc.audio = buf || "none";
  loc.peaks = buf ? computePeaks(buf) : null;
  loc.moov = null;
  if (S.media && S.media.id === mid) { audioSources(); drawWave(); }
}

function localActive(m) {
  const loc = m && LOCAL.get(m.id);
  return loc && m.proxy_status !== "ready" ? loc : null;
}

function localBadge(m) {
  const b = $("localBadge");
  const loc = m && LOCAL.get(m.id);
  const onLocal = loc && video.getAttribute("src") === loc.url;
  if (!onLocal) { b.classList.add("hidden"); return; }
  let t = "Vista previa local";
  if (m.proxy_status === "uploading") t += ` · subiendo ${Math.round((m.upload_progress || 0) * 100)}%`;
  else if (m.proxy_status === "pending" || m.proxy_status === "running") t += ` · preparando versión ligera ${Math.round((m.proxy_progress || 0) * 100)}%`;
  else if (m.proxy_status === "ready") t += " · cargando versión ligera";
  else if (m.proxy_status === "error") t += " · la versión ligera falló";
  b.textContent = t;
  b.classList.remove("hidden");
}
const MEM_DIRECT = 80 * 1024 * 1024;
const mem = { key: null, blobUrl: null, ctrl: null, pending: null, url: null };
function dropMemory() {
  if (mem.ctrl) mem.ctrl.abort();
  mem.ctrl = null;
  mem.pending = null;
  if (mem.blobUrl) URL.revokeObjectURL(mem.blobUrl);
  mem.blobUrl = null;
  mem.key = null;
  $("memBadge").classList.add("hidden");
}
function setSource(src, t, play, rate) {
  watch.since = 0;
  scrub.target = null;
  video.src = src;
  video.load();
  video.addEventListener("loadedmetadata", () => {
    const want = scrub.active ? scrub.t : t;
    if (want) video.currentTime = want;
    if (rate) video.playbackRate = rate;
    if (play) video.play().catch(() => {});
  }, { once: true });
}
function whenSettled(fn) {
  if (!video.seeking && video.readyState >= 2) return fn();
  let done = false;
  const go = () => { if (done) return; done = true; video.removeEventListener("seeked", go); video.removeEventListener("canplay", go); fn(); };
  video.addEventListener("seeked", go);
  video.addEventListener("canplay", go);
  setTimeout(go, 2000);
}
async function loadIntoMemory(m, url, t0) {
  dropMemory();
  mem.url = url;
  const size = m.preview_size || 0;
  if (!size || size > 1500 * 1024 * 1024) { if (!video.getAttribute("src")) setSource(url, t0 || 0); return; }
  const direct = size <= MEM_DIRECT;
  const ctrl = new AbortController();
  mem.ctrl = ctrl;
  mem.pending = url;
  const badge = $("memBadge");
  badge.classList.remove("hidden", "fade");
  badge.textContent = "Cargando en memoria 0%";
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok || !r.body) throw new Error(r.statusText);
    const reader = r.body.getReader();
    const chunks = [];
    let got = 0, lastPct = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      const pct = Math.floor((got / size) * 100);
      if (pct !== lastPct) { lastPct = pct; badge.textContent = `Cargando en memoria ${pct}%`; }
    }
    if (ctrl.signal.aborted || !S.media || S.media.id !== m.id) return;
    const blobUrl = URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
    mem.blobUrl = blobUrl;
    mem.key = url;
    mem.ctrl = null;
    mem.pending = null;
    const swap = () => {
      if (mem.blobUrl !== blobUrl) return;
      const has = !!video.getAttribute("src");
      setSource(blobUrl, has ? (scrub.target !== null ? scrub.target : video.currentTime || 0) : t0 || 0, has && !video.paused, video.playbackRate);
    };
    if (direct || !video.getAttribute("src")) swap(); else whenSettled(swap);
    badge.textContent = "En memoria ✓";
    setTimeout(() => badge.classList.add("fade"), 1500);
    setTimeout(() => badge.classList.add("hidden"), 2500);
  } catch (e) {
    if (ctrl.signal.aborted) return;
    mem.pending = null;
    badge.classList.add("hidden");
    if (S.media && S.media.id === m.id && !video.getAttribute("src")) setSource(url, t0 || 0);
  }
}
const watch = { since: 0, tries: 0, errs: 0, errAt: 0 };
setInterval(() => {
  if (!S.media || !video.getAttribute("src") || document.visibilityState !== "visible") { watch.since = 0; return; }
  const src = video.getAttribute("src");
  const blob = src.startsWith("blob:");
  const stuck = (video.seeking || video.readyState < 2) && (blob || video.networkState !== 2) && !video.error;
  if (!stuck) { watch.since = 0; watch.tries = 0; return; }
  if (!watch.since) { watch.since = Date.now(); return; }
  if (Date.now() - watch.since < 2500) return;
  watch.tries++;
  const t = scrub.target !== null ? scrub.target : video.currentTime || 0;
  if (watch.tries > 2 && blob && mem.url) {
    const url = mem.url;
    dropMemory();
    mem.url = url;
    setSource(url, t);
  } else setSource(src, t);
}, 1000);
const scrubImg = new Image();
const scrub = { active: false, t: 0, target: null };
function showScrub(t) {
  const sc = S.media && S.media.scrub;
  const el = $("scrubView");
  if (!sc || !scrubImg.complete || !scrubImg.naturalWidth) return;
  const idx = Math.max(0, Math.min(sc.count - 1, Math.round(t / sc.interval)));
  const col = idx % sc.cols, row = Math.floor(idx / sc.cols);
  el.style.backgroundImage = `url("${scrubImg.src}")`;
  el.style.backgroundSize = `${sc.cols * 100}% ${sc.rows * 100}%`;
  el.style.backgroundPosition = `${sc.cols > 1 ? (col / (sc.cols - 1)) * 100 : 0}% ${sc.rows > 1 ? (row / (sc.rows - 1)) * 100 : 0}%`;
  el.classList.remove("hidden");
}
function hideScrub() { $("scrubView").classList.add("hidden"); }
video.addEventListener("seeked", () => {
  if (scrub.target !== null) { const t = scrub.target; scrub.target = null; video.currentTime = t; return; }
  const sc = S.media && S.media.scrub;
  if (!scrub.active || Math.abs(video.currentTime - scrub.t) <= (sc ? sc.interval : 0.25)) hideScrub();
});
video.addEventListener("error", () => {
  if (!S.media) return;
  const src = video.getAttribute("src");
  const now = Date.now();
  if (now - watch.errAt > 15000) watch.errs = 0;
  watch.errAt = now;
  if (src && watch.errs < 4) {
    watch.errs++;
    setSource(src, scrub.target !== null ? scrub.target : video.currentTime || 0);
  } else setTimeout(pollMedia, 500);
});
const segAt = (t) => S.segs.findIndex((s) => t >= s.start - 0.02 && t < s.end - 0.01);
function frameDur() { return 1 / ((S.media && S.media.info.video.fps) || 30); }

function sortSegs() {
  const cur = S.segs[S.sel];
  S.segs.sort((a, b) => a.start - b.start);
  S.sel = Math.max(0, S.segs.indexOf(cur));
}

const TL = { freeze: 0, lead: null };
function tlDur() {
  if (TL.freeze) return TL.freeze;
  const T = outTotal();
  let me = 0;
  for (const c of S.tracks) me = Math.max(me, trackEnd(c));
  return Math.max(0.1, T + clamp(me - T, 0, T * 0.25));
}
function laneW() { return $("timeline").clientWidth || 1; }
function outAt(t) {
  let o = 0;
  for (const s of S.segs) {
    if (t < s.start) return o;
    if (t < s.end) return o + (t - s.start) / s.speed;
    o += (s.end - s.start) / s.speed;
  }
  return o;
}
function curSrc() { return scrub.active ? scrub.t : scrub.target !== null ? scrub.target : video.currentTime || 0; }
function curOut() { return outAt(curSrc()); }
function outToSrc(o) {
  const T = outTotal();
  o = clamp(o, 0, T);
  return o >= T - 1e-3 ? Math.max(0, srcAtOut(T) - 0.001) : srcAtOut(o);
}
function seekOut(o) { seek(outToSrc(o)); }
function scrubOut(o) { scrubTo(outToSrc(o)); }
function xToOut(e) {
  const r = $("timeline").getBoundingClientRect();
  return clamp((e.clientX - r.left) / r.width, 0, 1) * tlDur();
}
function clipLayout() {
  const out = [];
  let o = 0;
  S.segs.forEach((s, i) => {
    const d = (s.end - s.start) / s.speed;
    out.push({ i, s, o: TL.lead && TL.lead.i === i ? o + TL.lead.dt : o, d });
    o += d;
  });
  return out;
}
function setThumbs(v) {
  if ($("thumbs").style.backgroundImage === v) return;
  $("thumbs").style.backgroundImage = v;
  if (S.media) renderClips();
}
const waveImg = new Image();
waveImg.onload = () => drawWave();
function setWaveImg(url) {
  if (!url) { waveImg.removeAttribute("src"); return; }
  if (waveImg.getAttribute("src") !== url) waveImg.src = url;
}

function renderTimeline() {
  if (!S.media) return;
  $("tl").style.setProperty("--end", (outTotal() / tlDur()) * 100 + "%");
  renderClips();
  renderRuler();
  drawWave();
  renderMusic();
  $("tDur").textContent = fmtT(outTotal());
  const m = S.out.audioMode === "mute";
  const b = $("origMute");
  b.textContent = m ? "🔇" : "🔊";
  b.classList.toggle("on", m);
  b.title = m ? "Activar el audio original" : "Silenciar el audio original";
  b.disabled = !S.media.info.audio;
  setLane(S.lane);
}

function renderClips() {
  const V = tlDur(), W = laneW(), D = S.media.info.duration || 1;
  const img = $("thumbs").style.backgroundImage;
  $("tl").style.setProperty("--end", (outTotal() / V) * 100 + "%");
  $("segLayer").replaceChildren(...clipLayout().map(({ i, s, o, d }) => {
    const wpx = (d / V) * W;
    const bgW = (wpx * D) / Math.max(0.001, s.end - s.start);
    const st = `left:${(o / V) * 100}%;width:${(d / V) * 100}%;` + (img && img !== "none" ? `background-image:${img};background-size:${bgW.toFixed(1)}px 100%;background-position:${(-(s.start / D) * bgW).toFixed(1)}px 0` : "");
    return h("div", { class: "clip" + (i === S.sel ? " sel" : ""), style: st, "data-i": i },
      s.speed !== 1 ? h("span", { class: "sp" }, s.speed + "×") : null,
      wpx > 64 ? h("span", { class: "dur" }, fmtT(d)) : null,
      h("div", { class: "h l", "data-i": i, "data-side": "start" }),
      h("div", { class: "h r", "data-i": i, "data-side": "end" }));
  }));
}

function renderRuler() {
  const V = tlDur(), W = laneW();
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
  const step = steps.find((x) => (x / V) * W >= 70) || 7200;
  const kids = [];
  for (let k = 0; k * step <= V + 1e-6 && kids.length < 300; k++) {
    const t = k * step;
    const m = Math.floor(t / 60), sec = t - m * 60;
    const lab = step < 1 ? `${m}:${sec.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.round(sec)).padStart(2, "0")}`;
    kids.push(h("span", { class: "tick", style: `left:${(t / V) * 100}%` }, lab));
  }
  $("tlRuler").replaceChildren(...kids);
}

function setLane(l) {
  S.lane = l;
  $("tl").dataset.lane = l;
}

function normAregs() {
  const d = S.media ? S.media.info.duration : 0;
  let r = (S.aregs || []).filter((x) => x.end - x.start > 0.001).sort((a, b) => a.start - b.start);
  if (!r.length) r = [{ start: 0, end: d, vol: 1 }];
  r[0].start = 0;
  for (let i = 1; i < r.length; i++) r[i].start = r[i - 1].end;
  r[r.length - 1].end = d;
  const out = [];
  for (const x of r) {
    const p = out[out.length - 1];
    if (p && x.end - x.start < 0.02) { p.end = x.end; continue; }
    out.push(x);
  }
  S.aregs = out;
  S.asel = clamp(S.asel || 0, 0, out.length - 1);
}

function splitAudio(t) {
  const i = aregAt(t);
  if (i < 0) return;
  const r = S.aregs[i];
  if (t - r.start < 0.05 || r.end - t < 0.05) return toast("Ya hay un corte aquí");
  S.aregs.splice(i + 1, 0, { start: t, end: r.end, vol: r.vol });
  r.end = t;
  S.asel = i + 1;
  changed();
}
function mergeAudio(i) {
  const r = S.aregs;
  if (i < 0 || i >= r.length - 1) return;
  r[i].end = r[i + 1].end;
  r.splice(i + 1, 1);
  S.asel = i;
  changed();
}

const VOL_MAX = 2;
let waveRaf = 0;
function drawWave() {
  if (waveRaf) return;
  waveRaf = requestAnimationFrame(() => {
    waveRaf = 0;
    const cv = $("awave"), lane = $("alane");
    if (!S.media || !cv) return;
    const w = lane.clientWidth, hh = lane.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    const msg = $("alaneMsg");
    const has = !!S.media.info.audio;
    lane.classList.toggle("none", !has);
    lane.classList.toggle("off", S.out.audioMode === "mute");
    if (!has) { msg.textContent = "Este vídeo no tiene sonido"; return; }
    const pk = AU.orig.peaks;
    const useImg = !pk && S.media.wave && waveImg.complete && waveImg.naturalWidth > 0;
    const loc = LOCAL.get(S.media.id);
    msg.textContent = pk || useImg ? ""
      : loc && loc.audio === "loading" ? "Leyendo el audio del archivo…"
      : loc && S.media.proxy_status !== "ready" ? "El audio aparecerá cuando esté la versión ligera"
      : AU.orig.failed && !AU.orig.key ? "No se pudo cargar el audio en el navegador"
      : S.media.proxy_status === "ready" ? "Cargando audio…" : "";
    const V = tlDur(), D = S.media.info.duration || 1, mid = hh / 2;
    const style = getComputedStyle(lane);
    const on = style.getPropertyValue("--wave").trim() || "#3fbfa8";
    const selA = S.lane === "audio";
    const L = clipLayout(), groups = [];
    for (const c of L) {
      const p = groups[groups.length - 1], prev = p && p.last;
      if (prev && Math.abs(prev.s.end - c.s.start) < 1e-3 && Math.abs(prev.o + prev.d - c.o) < 1e-6) { p.b = c.o + c.d; p.last = c; }
      else groups.push({ a: c.o, b: c.o + c.d, last: c });
    }
    g.fillStyle = "rgba(63,191,168,.10)";
    for (const gr of groups) g.fillRect((gr.a / V) * w + 1, 1, Math.max(0, ((gr.b - gr.a) / V) * w - 2), hh - 2);
    for (const { s, o, d } of L) {
      const x0 = (o / V) * w, x1 = ((o + d) / V) * w, cw = Math.max(1, x1 - x0), sd = Math.max(1e-6, s.end - s.start);
      const xs = (t) => x0 + ((t - s.start) / sd) * cw;
      if (pk) {
        const N = pk.length;
        g.fillStyle = on;
        for (let x = Math.floor(x0); x < x1; x++) {
          const ta = s.start + ((x - x0) / cw) * sd, tb = s.start + ((x + 1 - x0) / cw) * sd;
          const a = Math.floor((ta / D) * N), b = Math.max(a + 1, Math.floor((tb / D) * N));
          let p = 0;
          for (let j = a; j < b && j < N; j++) if (pk[j] > p) p = pk[j];
          const amp = Math.min(mid - 2, p * volAt((ta + tb) / 2) * (mid - 3));
          if (amp < 0.3) continue;
          g.fillRect(x, mid - amp, 1, amp * 2);
        }
      } else if (useImg) {
        const iw = waveImg.naturalWidth, ih = waveImg.naturalHeight;
        g.globalAlpha = 0.8;
        g.drawImage(waveImg, (s.start / D) * iw, 0, Math.max(1, (sd / D) * iw), ih, x0 + 1, 2, Math.max(1, cw - 2), hh - 4);
        g.globalAlpha = 1;
      }
      S.aregs.forEach((r, k) => {
        const a = Math.max(r.start, s.start), b = Math.min(r.end, s.end);
        if (b <= a) return;
        const xa = xs(a), xb = xs(b);
        if (r.vol === 0) {
          g.fillStyle = "rgba(255,77,79,.16)";
          g.fillRect(xa, 0, xb - xa, hh);
        }
        if (selA && k === S.asel) {
          g.fillStyle = "rgba(245,184,61,.12)";
          g.fillRect(xa, 0, xb - xa, hh);
        }
        const y = 2 + (1 - clamp(r.vol / VOL_MAX, 0, 1)) * (hh - 4);
        g.fillStyle = "#f5b83d";
        g.fillRect(xa, y - 1, xb - xa, 2);
        if (r.start > s.start + 1e-3) {
          g.fillStyle = "rgba(255,255,255,.7)";
          g.fillRect(Math.round(xa), 0, 1, hh);
        }
        if (r.vol !== 1 && xb - xa > 36) {
          g.font = "600 10px ui-monospace, monospace";
          g.fillStyle = "rgba(0,0,0,.6)";
          const lab = r.vol === 0 ? "silencio" : Math.round(r.vol * 100) + "%";
          const tw = g.measureText(lab).width + 8;
          g.fillRect(xa + 3, 3, tw, 14);
          g.fillStyle = "#fff";
          g.fillText(lab, xa + 7, 14);
        }
      });
    }
    g.strokeStyle = "rgba(0,0,0,.55)";
    g.lineWidth = 2;
    for (const gr of groups) g.strokeRect((gr.a / V) * w, 0, ((gr.b - gr.a) / V) * w, hh);
  });
}

let musRaf = 0;
function renderMusic() {
  if (!S.media) return;
  const V = tlDur(), W = laneW();
  const lanes = S.tracks.reduce((m, c) => Math.max(m, c.lane + 1), 0);
  const rows = [];
  const dpr = window.devicePixelRatio || 1;
  for (let l = 0; l < lanes; l++) {
    const clips = S.tracks.filter((c) => c.lane === l).map((c) => {
      const a = assetOf(c.asset);
      const len = c.trim_out - c.trim_in;
      const wpx = Math.max(1, (len / V) * W);
      const cv = h("canvas");
      const slot = AU.mus.get(c.asset);
      if (slot && slot.peaks && a) {
        const pk = slot.peaks, N = pk.length, ch = 40;
        cv.width = Math.min(4096, Math.round(wpx * dpr));
        cv.height = ch * dpr;
        const g = cv.getContext("2d");
        g.fillStyle = "rgba(255,255,255,.55)";
        const k = cv.width / wpx;
        for (let x = 0; x < cv.width; x++) {
          const ta = c.trim_in + (x / cv.width) * len, tb = c.trim_in + ((x + 1) / cv.width) * len;
          const i0 = Math.floor((ta / a.duration) * N), i1 = Math.max(i0 + 1, Math.floor((tb / a.duration) * N));
          let p = 0;
          for (let j = i0; j < i1 && j < N; j++) if (pk[j] > p) p = pk[j];
          const amp = Math.sqrt(Math.min(1, p * c.vol)) * (cv.height / 2 - 2 * k);
          if (amp < 0.4) continue;
          g.fillRect(x, cv.height / 2 - amp, 1, amp * 2);
        }
      }
      const vy = (1 - clamp(c.vol / VOL_MAX, 0, 1)) * 100;
      return h("div", { class: "mclip" + (S.msel === c.uid ? " sel" : ""), "data-uid": c.uid, style: `left:${(c.offset / V) * 100}%;width:${(len / V) * 100}%` },
        cv,
        c.fade_in > 0 ? h("i", { class: "fi", style: `width:${Math.min(50, (c.fade_in / len) * 100)}%` }) : null,
        c.fade_out > 0 ? h("i", { class: "fo", style: `width:${Math.min(50, (c.fade_out / len) * 100)}%` }) : null,
        h("div", { class: "mvol", style: `top:calc(2px + (100% - 4px) * ${(vy / 100).toFixed(4)})` }),
        wpx > 40 ? h("span", { class: "mname" }, (a ? a.name : "Audio") + (c.vol !== 1 ? ` · ${c.vol === 0 ? "silencio" : Math.round(c.vol * 100) + "%"}` : "")) : null,
        h("div", { class: "h l" }), h("div", { class: "h r" }));
    });
    rows.push(h("div", { class: "tl-head", title: `Pista de audio ${l + 1}` }, "🎵"), h("div", { class: "tl-lane mlane", "data-lane": l }, ...clips));
  }
  $("mlanes").replaceChildren(...rows);
}

function trackBy(uid) { return S.tracks.find((c) => c.uid === uid) || null; }
function snapTargets(skip) {
  const t = [0, outTotal(), curOut()];
  let o = 0;
  for (const s of S.segs) { o += (s.end - s.start) / s.speed; t.push(o); }
  for (const c of S.tracks) if (c.uid !== skip) t.push(c.offset, trackEnd(c));
  return t;
}
function snapV(x, targets, tol) {
  let best = x, bd = tol;
  for (const t of targets) { const d = Math.abs(t - x); if (d < bd) { bd = d; best = t; } }
  return best;
}

function endScrub() {
  scrub.active = false;
  seek(scrub.t);
  if (!video.seeking && scrub.target === null) hideScrub();
  setTimeout(() => { if (!scrub.active && !video.seeking) hideScrub(); }, 1500);
}
function startScrub(e) {
  scrub.active = true;
  video.pause();
  scrubOut(xToOut(e));
}

(function audioLane() {
  const lane = $("alane");
  let mode = null, idx = -1, moved = false;
  const geo = (e) => {
    const r = lane.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const o = clamp(x / r.width, 0, 1) * tlDur();
    return { x, y, w: r.width, h: r.height, o, t: outToSrc(o) };
  };
  const hit = (e) => {
    const g = geo(e);
    const V = tlDur();
    for (let k = 0; k < S.aregs.length - 1; k++) {
      const b = S.aregs[k].end;
      if (segAt(b) < 0) continue;
      const bx = (outAt(b) / V) * g.w;
      if (Math.abs(g.x - bx) <= 5) return { kind: "bnd", i: k, g };
    }
    if (g.o > outTotal()) return { kind: "none", i: -1, g };
    const i = aregAt(g.t);
    if (i < 0) return { kind: "none", i, g };
    const ly = 2 + (1 - clamp(S.aregs[i].vol / VOL_MAX, 0, 1)) * (g.h - 4);
    if (Math.abs(g.y - ly) <= 7) return { kind: "vol", i, g };
    return { kind: "scrub", i, g };
  };
  lane.addEventListener("pointermove", (e) => {
    if (!S.media) return;
    if (!mode) {
      const k = hit(e).kind;
      lane.style.cursor = k === "bnd" ? "ew-resize" : k === "vol" ? "ns-resize" : "pointer";
      return;
    }
    const g = geo(e);
    moved = true;
    if (mode === "vol") {
      let v = clamp((1 - (g.y - 2) / (g.h - 4)) * VOL_MAX, 0, VOL_MAX);
      if (Math.abs(v - 1) < 0.05) v = 1;
      if (v < 0.03) v = 0;
      S.aregs[idx].vol = Math.round(v * 100) / 100;
      drawWave();
      auDirty();
    } else if (mode === "bnd") {
      const a = S.aregs[idx], b = S.aregs[idx + 1];
      const t = clamp(g.t, a.start + 0.05, b.end - 0.05);
      a.end = t; b.start = t;
      drawWave();
      scrubTo(t);
    } else if (mode === "scrub") scrubOut(g.o);
  });
  lane.addEventListener("pointerdown", (e) => {
    if (!S.media || e.button > 0 || !S.media.info.audio) return;
    e.preventDefault();
    hideMenu();
    lane.setPointerCapture(e.pointerId);
    const hi = hit(e);
    mode = hi.kind === "none" ? "scrub" : hi.kind;
    idx = hi.i;
    moved = false;
    if (hi.i >= 0 && mode !== "bnd") S.asel = hi.i;
    setLane("audio");
    if (mode === "scrub" || mode === "bnd") { scrub.active = true; video.pause(); }
    if (mode === "scrub") scrubOut(hi.g.o);
    drawWave();
  });
  const end = () => {
    if (!mode) return;
    const m = mode;
    mode = null;
    if (m === "scrub") endScrub();
    else {
      if (m === "bnd") endScrub();
      if (moved) { normAregs(); changed(); }
    }
  };
  lane.addEventListener("pointerup", end);
  lane.addEventListener("pointercancel", end);
  lane.addEventListener("dblclick", (e) => {
    const hi = hit(e);
    if (hi.i >= 0 && hi.kind !== "bnd") { S.aregs[hi.i].vol = 1; changed(); }
  });
  lane.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!S.media || !S.media.info.audio) return;
    setLane("audio");
    const g = geo(e);
    if (g.o > outTotal()) return;
    const i = aregAt(g.t);
    if (i < 0) return;
    S.asel = i;
    drawWave();
    const r = S.aregs[i];
    const items = [
      { sep: true, label: "Audio original" },
      { label: "✂ Cortar el audio aquí", action: () => splitAudio(g.t) },
      { label: r.vol === 0 ? "🔊 Quitar silencio de este trozo" : "🔇 Silenciar este trozo", action: () => { r.vol = r.vol === 0 ? 1 : 0; changed(); } },
      { sep: true, label: "Volumen de este trozo" },
      { row: [0.25, 0.5, 0.75, 1, 1.5, 2].map((v) => ({ label: Math.round(v * 100) + "%", on: Math.abs(r.vol - v) < 1e-3, action: () => { r.vol = v; changed(); } })) },
    ];
    if (i < S.aregs.length - 1 || i > 0) items.push({ sep: true });
    if (i > 0) items.push({ label: "Unir con el trozo anterior", action: () => mergeAudio(i - 1) });
    if (i < S.aregs.length - 1) items.push({ label: "Unir con el trozo siguiente", action: () => mergeAudio(i) });
    showMenu(e.clientX, e.clientY, items);
  });
})();

(function musicLanes() {
  const box = $("mlanes");
  let dr = null;
  const clipHit = (e, el, c) => {
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const edge = Math.min(8, r.width / 4);
    if (x <= edge) return "l";
    if (r.width - x <= edge) return "r";
    const ly = 2 + (1 - clamp(c.vol / VOL_MAX, 0, 1)) * (r.height - 4);
    if (Math.abs(y - ly) <= 5) return "vol";
    return "move";
  };
  const laneAtY = (y) => {
    const rows = [...box.querySelectorAll(".mlane")];
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i++) if (y < rows[i].getBoundingClientRect().bottom) return i;
    return Math.min(15, rows.length);
  };
  box.addEventListener("pointermove", (e) => {
    if (!S.media) return;
    if (!dr) {
      const el = e.target.closest(".mclip");
      if (!el) { box.style.cursor = e.target.closest(".mlane") ? "pointer" : ""; return; }
      const c = trackBy(el.dataset.uid);
      if (!c) return;
      const k = clipHit(e, el, c);
      box.style.cursor = k === "l" || k === "r" ? "ew-resize" : k === "vol" ? "ns-resize" : "grab";
      return;
    }
    if (dr.kind === "scrub") return scrubOut(xToOut(e));
    if (Math.abs(e.clientX - dr.x0) + Math.abs(e.clientY - dr.y0) > 3) dr.moved = true;
    if (!dr.moved) return;
    const c = dr.c, c0 = dr.c0;
    const dx = (e.clientX - dr.x0) / dr.pps;
    const tol = 8 / dr.pps;
    const len = c0.trim_out - c0.trim_in;
    if (dr.kind === "move") {
      const off = Math.max(0, c0.offset + dx);
      const a = snapV(off, dr.snaps, tol), b = snapV(off + len, dr.snaps, tol) - len;
      c.offset = Math.max(0, Math.abs(a - off) <= Math.abs(b - off) && a !== off ? a : b !== off ? b : off);
      c.lane = laneAtY(e.clientY);
      box.style.cursor = "grabbing";
    } else if (dr.kind === "l") {
      let start = snapV(c0.offset + dx, dr.snaps, tol);
      start = clamp(start, Math.max(0, c0.offset - c0.trim_in), c0.offset + len - 0.1);
      c.offset = start;
      c.trim_in = c0.trim_in + (start - c0.offset);
    } else if (dr.kind === "r") {
      const a = assetOf(c.asset);
      const end = snapV(c0.offset + len + dx, dr.snaps, tol);
      c.trim_out = clamp(c0.trim_in + (end - c0.offset), c0.trim_in + 0.1, a ? a.duration : c0.trim_out);
    } else if (dr.kind === "vol") {
      const el = box.querySelector(`.mclip[data-uid="${c.uid}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      let v = clamp((1 - (e.clientY - r.top - 2) / (r.height - 4)) * VOL_MAX, 0, VOL_MAX);
      if (Math.abs(v - 1) < 0.05) v = 1;
      if (v < 0.03) v = 0;
      c.vol = Math.round(v * 100) / 100;
      auDirty();
    }
    renderMusic();
  });
  box.addEventListener("pointerdown", (e) => {
    if (!S.media || e.button > 0) return;
    const el = e.target.closest(".mclip");
    const laneEl = e.target.closest(".mlane");
    if (!el && !laneEl) return;
    e.preventDefault();
    hideMenu();
    box.setPointerCapture(e.pointerId);
    if (!el) { S.msel = null; setLane("music"); renderMusic(); dr = { kind: "scrub" }; startScrub(e); return; }
    const c = trackBy(el.dataset.uid);
    if (!c) return;
    S.msel = c.uid;
    setLane("music");
    TL.freeze = tlDur();
    dr = { kind: clipHit(e, el, c), c, c0: { ...c }, x0: e.clientX, y0: e.clientY, pps: laneW() / TL.freeze, moved: false, snaps: snapTargets(c.uid) };
    renderMusic();
  });
  const end = () => {
    if (!dr) return;
    const d = dr;
    dr = null;
    box.style.cursor = "";
    if (d.kind === "scrub") return endScrub();
    TL.freeze = 0;
    if (d.moved) {
      if (d.kind === "move") placeTrack(d.c);
      compactLanes();
      changed();
    } else renderTimeline();
  };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
  box.addEventListener("dblclick", (e) => {
    const el = e.target.closest(".mclip");
    const c = el && trackBy(el.dataset.uid);
    if (c) { c.vol = 1; changed(); }
  });
  box.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const el = e.target.closest(".mclip");
    const c = el && trackBy(el.dataset.uid);
    if (!c) return;
    S.msel = c.uid;
    setLane("music");
    renderMusic();
    const a = assetOf(c.asset);
    const o = curOut();
    const fades = [0, 0.5, 1, 2, 3, 5];
    const fl = (x) => (x ? String(x).replace(".", ",") + " s" : "No");
    showMenu(e.clientX, e.clientY, [
      { sep: true, label: a ? a.name : "Audio" },
      { label: "✂ Cortar en el cursor", disabled: o <= c.offset + 0.1 || o >= trackEnd(c) - 0.1, action: () => splitTrack(c, o) },
      { label: "⧉ Duplicar a continuación", action: () => { const b = { ...c, uid: newUid(), offset: trackEnd(c) }; placeTrack(b); S.tracks.push(b); S.msel = b.uid; changed(); } },
      { label: "🗑 Borrar", action: () => removeTrack(c.uid) },
      { sep: true, label: "Volumen" },
      { row: [0, 0.25, 0.5, 0.75, 1, 1.5, 2].map((v) => ({ label: v === 0 ? "🔇" : Math.round(v * 100) + "%", on: Math.abs(c.vol - v) < 1e-3, action: () => { c.vol = v; changed(); } })) },
      { sep: true, label: "Fundido de entrada" },
      { row: fades.map((x) => ({ label: fl(x), on: c.fade_in === x, action: () => { c.fade_in = x; changed(); } })) },
      { sep: true, label: "Fundido de salida" },
      { row: fades.map((x) => ({ label: fl(x), on: c.fade_out === x, action: () => { c.fade_out = x; changed(); } })) },
    ]);
  });
})();

$("tlRuler").addEventListener("pointerdown", (e) => {
  if (!S.media || e.button > 0) return;
  e.preventDefault();
  hideMenu();
  const r = $("tlRuler");
  r.setPointerCapture(e.pointerId);
  startScrub(e);
  const mv = (ev) => scrubOut(xToOut(ev));
  const up = () => { r.removeEventListener("pointermove", mv); r.removeEventListener("pointerup", up); r.removeEventListener("pointercancel", up); endScrub(); };
  r.addEventListener("pointermove", mv);
  r.addEventListener("pointerup", up);
  r.addEventListener("pointercancel", up);
});
$("origMute").onclick = () => { if (!S.media) return; S.out.audioMode = S.out.audioMode === "mute" ? "keep" : "mute"; changed(); };
$("musFile").addEventListener("change", () => { const f = $("musFile").files[0]; $("musFile").value = ""; if (f) uploadMusic(f); });
let tlRaf = 0;
new ResizeObserver(() => { if (tlRaf) return; tlRaf = requestAnimationFrame(() => { tlRaf = 0; if (S.media) renderTimeline(); }); }).observe($("timeline"));

$("timeline").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (!S.media) return;
  const clip = e.target.closest(".clip");
  if (!clip) return;
  const i = +clip.dataset.i;
  S.sel = i;
  setLane("video");
  renderClips();
  const s = S.segs[i];
  const t = outToSrc(xToOut(e));
  showMenu(e.clientX, e.clientY, [
    { sep: true, label: `Clip ${i + 1} · velocidad` },
    { row: SPEEDS.map((x) => ({ label: x + "×", on: x === s.speed, action: () => { s.speed = x; changed(); } })) },
    { sep: true },
    { label: "✂ Cortar aquí", action: () => split(t) },
    { label: "🗑 Borrar este clip", disabled: S.segs.length < 2, action: () => removeSeg(i) },
  ]);
});

function showMenu(x, y, items) {
  const m = $("ctxMenu");
  const btn = (it, cls) => h("button", { class: cls + (it.on ? " on" : ""), disabled: it.disabled ? "" : null, onclick: () => { hideMenu(); it.action(); } }, it.label);
  m.replaceChildren(...items.map((it) => {
    if (it.sep) return h("div", { class: "ctx-sep" }, it.label || "");
    if (it.row) return h("div", { class: "ctx-row" }, ...it.row.map((r) => btn(r, "ctx-chip")));
    return btn(it, "ctx-item");
  }));
  m.classList.remove("hidden");
  const w = m.offsetWidth, hh = m.offsetHeight;
  m.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + "px";
  m.style.top = Math.max(4, Math.min(y, window.innerHeight - hh - 4)) + "px";
}
function hideMenu() { $("ctxMenu").classList.add("hidden"); }
document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#ctxMenu")) hideMenu(); }, true);
window.addEventListener("scroll", hideMenu, true);
window.addEventListener("blur", hideMenu);

function removeSeg(i) {
  if (S.segs.length < 2) return toast("No puedes borrar el único clip");
  const o = clipLayout()[i].o;
  S.segs.splice(i, 1);
  S.sel = clamp(i, 0, S.segs.length - 1);
  setLane("video");
  changed();
  seekOut(o);
}

function setIn() {
  const t = curSrc(), i = S.sel, s = S.segs[i];
  const prevEnd = i > 0 ? S.segs[i - 1].end : 0;
  if (t >= s.end - 0.1) return toast("El inicio tiene que ir antes del fin del clip");
  s.start = Math.max(t, prevEnd);
  changed();
}
function setOut() {
  const t = curSrc(), i = S.sel, s = S.segs[i];
  const nextStart = i < S.segs.length - 1 ? S.segs[i + 1].start : S.media.info.duration;
  if (t <= s.start + 0.1) return toast("El fin tiene que ir después del inicio del clip");
  s.end = Math.min(t, nextStart);
  changed();
}
function split(at) {
  const t = at == null ? curSrc() : at;
  const i = segAt(t);
  if (i < 0) return toast("El cursor no está sobre ningún clip");
  const s = S.segs[i];
  if (t - s.start < 0.1) return toast(i > 0 ? "Ya hay un corte aquí" : "Demasiado cerca del principio");
  if (s.end - t < 0.1) return toast(i < S.segs.length - 1 ? "Ya hay un corte aquí" : "Demasiado cerca del final");
  S.segs.splice(i + 1, 0, { start: t, end: s.end, speed: s.speed });
  s.end = t;
  S.sel = i + 1;
  setLane("video");
  changed();
}
function whole() {
  S.segs = [{ start: 0, end: S.media.info.duration, speed: 1 }];
  S.sel = 0;
  changed();
}
$("setIn").onclick = setIn;
$("setOut").onclick = setOut;
function cutSelected() {
  const c = S.lane === "music" && trackBy(S.msel);
  if (c) splitTrack(c, curOut());
  else if (S.lane === "audio") splitAudio(curSrc());
  else split();
}
$("splitBtn").onclick = cutSelected;
$("wholeBtn").onclick = whole;

function seek(t) {
  if (!S.media) return;
  t = clamp(t, 0, S.media.info.duration);
  if (video.seeking) { scrub.target = t; return; }
  if (Math.abs(video.currentTime - t) < 0.001) return;
  video.currentTime = t;
}
function scrubTo(t) {
  if (!S.media) return;
  t = clamp(t, 0, S.media.info.duration);
  scrub.t = t;
  seek(t);
}

function togglePlay() {
  if (!video.getAttribute("src")) return;
  auResume();
  if (video.paused) {
    const t = video.currentTime;
    if (outAt(t) >= outTotal() - 0.05) video.currentTime = S.segs[0].start;
    else if (segAt(t) < 0) {
      const next = S.segs.find((s) => s.start > t) || S.segs[0];
      video.currentTime = next.start;
    }
    video.play().catch(() => {});
  } else video.pause();
}
$("playBtn").onclick = togglePlay;
$("bigPlay").onclick = togglePlay;
$("stepBack").onclick = () => { video.pause(); seek(curSrc() - frameDur()); };
$("stepFwd").onclick = () => { video.pause(); seek(curSrc() + frameDur()); };
video.addEventListener("play", auResume);
video.addEventListener("play", () => { $("stage").classList.add("playing"); $("playIcon").setAttribute("d", "M7 5h4v14H7zM13 5h4v14h-4z"); });
video.addEventListener("pause", () => { auStop(); $("stage").classList.remove("playing"); $("playIcon").setAttribute("d", "M8 5v14l11-7z"); });
video.addEventListener("ended", auStop);
video.addEventListener("emptied", auStop);
video.addEventListener("loadedmetadata", layoutStage);
video.addEventListener("click", () => { if (!S.crop.enabled) togglePlay(); });

const tickState = { x: -1, txt: "" };
function tick() {
  try {
    if (S.media) {
      const o = curOut();
      const x = Math.round((o / tlDur()) * laneW());
      if (x !== tickState.x) { tickState.x = x; $("playhead").style.transform = `translateX(${x}px)`; }
      const txt = fmtT(o);
      if (txt !== tickState.txt) { tickState.txt = txt; $("tCur").textContent = txt; }
      auTick();
      if (!video.paused && !video.seeking && !scrub.active) {
        const t = video.currentTime;
        const i = segAt(t);
        if (i < 0) {
          const next = S.segs.find((s) => s.start > t);
          if (next) video.currentTime = next.start;
          else { video.pause(); video.currentTime = Math.max(0, S.segs[S.segs.length - 1].end - 0.05); }
        } else {
          const r = clamp(S.segs[i].speed, 0.0625, 16);
          if (Math.abs(video.playbackRate - r) > 1e-3) video.playbackRate = r;
        }
      }
      if (live.on) liveFrame();
    }
  } catch (err) {
    console.error(err);
    try { auStop(); } catch {}
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

(function timelineDrag() {
  const tl = $("timeline");
  let dr = null;
  tl.addEventListener("pointerdown", (e) => {
    if (!S.media || e.button > 0) return;
    e.preventDefault();
    hideMenu();
    tl.setPointerCapture(e.pointerId);
    const hnd = e.target.closest(".h");
    const clip = e.target.closest(".clip");
    scrub.active = true;
    video.pause();
    if (hnd) {
      const i = +hnd.dataset.i, s = S.segs[i];
      S.sel = i;
      setLane("video");
      TL.freeze = tlDur();
      dr = { kind: hnd.dataset.side, i, x0: e.clientX, s0: { ...s }, pps: laneW() / TL.freeze };
      scrubTo(dr.kind === "start" ? s.start : s.end - 0.001);
      renderClips();
      return;
    }
    if (clip) { S.sel = +clip.dataset.i; setLane("video"); renderClips(); }
    dr = { kind: "scrub" };
    scrubOut(xToOut(e));
  });
  tl.addEventListener("pointermove", (e) => {
    if (!dr) return;
    if (dr.kind === "scrub") return scrubOut(xToOut(e));
    const s = S.segs[dr.i];
    const dt = ((e.clientX - dr.x0) / dr.pps) * dr.s0.speed;
    if (dr.kind === "start") {
      const lo = dr.i > 0 ? S.segs[dr.i - 1].end : 0;
      s.start = clamp(dr.s0.start + dt, lo, s.end - 0.1);
      TL.lead = { i: dr.i, dt: (s.start - dr.s0.start) / s.speed };
      scrubTo(s.start);
    } else {
      const hi = dr.i < S.segs.length - 1 ? S.segs[dr.i + 1].start : S.media.info.duration;
      s.end = clamp(dr.s0.end + dt, s.start + 0.1, hi);
      scrubTo(s.end - 0.001);
    }
    renderClips();
    drawWave();
  });
  tl.addEventListener("dragstart", (e) => e.preventDefault());
  const end = () => {
    if (!dr) return;
    const d = dr;
    dr = null;
    if (d.kind !== "scrub") {
      TL.freeze = 0;
      TL.lead = null;
      changed();
    }
    endScrub();
  };
  tl.addEventListener("pointerup", end);
  tl.addEventListener("pointercancel", end);
})();

const cropGeo = { cw: 0, ch: 0, s: 1 };
function layoutStage() {
  if (!S.media) return;
  const st = $("stage").getBoundingClientRect();
  const v = S.media.info.video;
  const k = Math.min(st.width / v.width, st.height / v.height);
  const cw = v.width * k, ch = v.height * k;
  const layer = $("cropLayer");
  layer.style.left = (st.width - cw) / 2 + "px";
  layer.style.top = (st.height - ch) / 2 + "px";
  layer.style.width = cw + "px";
  layer.style.height = ch + "px";
  for (const el of [$("scrubView"), $("glView")]) {
    el.style.left = layer.style.left;
    el.style.top = layer.style.top;
    el.style.width = layer.style.width;
    el.style.height = layer.style.height;
  }
  const r = ((S.rotate % 360) + 360) % 360;
  const s = r === 90 || r === 270 ? Math.min(st.width / ch, st.height / cw) : 1;
  cropGeo.cw = cw; cropGeo.ch = ch; cropGeo.s = s;
  $("frame").style.transform = `scale(${S.flip_h ? -1 : 1}, ${S.flip_v ? -1 : 1}) rotate(${r}deg) scale(${s})`;
}
window.addEventListener("resize", layoutStage);
new ResizeObserver(layoutStage).observe($("stage"));

function renderCrop() {
  if (!S.media) return;
  layoutStage();
  const c = S.crop;
  $("cropOn").checked = c.enabled;
  $("cropLayer").classList.toggle("hidden", !c.enabled);
  $("stage").classList.toggle("cropping", c.enabled);
  const r = $("cropRect");
  r.style.left = c.x * 100 + "%";
  r.style.top = c.y * 100 + "%";
  r.style.width = c.w * 100 + "%";
  r.style.height = c.h * 100 + "%";
  setOn("#aspectChips .chip", (b) => c.enabled && ASPECTS[+b.dataset.i][1] === c.aspect);
  setOn("#flipH", () => S.flip_h);
  setOn("#flipV", () => S.flip_v);
  const g = geom();
  const parts = [];
  if (c.enabled) parts.push(`Recorte ${g.cw}×${g.ch}`);
  if (S.rotate) parts.push(`Giro ${S.rotate}°`);
  if (S.flip_h || S.flip_v) parts.push("Volteado");
  parts.push(`Salida ${g.w}×${g.h}`);
  $("cropInfo").textContent = parts.join(" · ");
}

$("cropOn").onchange = () => {
  S.crop.enabled = $("cropOn").checked;
  if (S.crop.enabled && S.crop.w >= 0.999 && S.crop.h >= 0.999) { S.crop = { enabled: true, x: 0.1, y: 0.1, w: 0.8, h: 0.8, aspect: null }; }
  video.pause();
  changed();
};
$("rotL").onclick = () => { S.rotate = (S.rotate + 270) % 360; changed(); };
$("rotR").onclick = () => { S.rotate = (S.rotate + 90) % 360; changed(); };
$("flipH").onclick = () => { S.flip_h = !S.flip_h; changed(); };
$("flipV").onclick = () => { S.flip_v = !S.flip_v; changed(); };

(function cropDrag() {
  const rect = $("cropRect");
  let drag = null;
  const toLocal = (dx, dy) => {
    if (S.flip_h) dx = -dx;
    if (S.flip_v) dy = -dy;
    const a = (-S.rotate * Math.PI) / 180;
    const x = dx * Math.cos(a) - dy * Math.sin(a);
    const y = dx * Math.sin(a) + dy * Math.cos(a);
    return [x / cropGeo.s / cropGeo.cw, y / cropGeo.s / cropGeo.ch];
  };
  rect.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    rect.setPointerCapture(e.pointerId);
    drag = { h: e.target.dataset.h || "move", x0: e.clientX, y0: e.clientY, c: { ...S.crop } };
  });
  rect.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [dx, dy] = toLocal(e.clientX - drag.x0, e.clientY - drag.y0);
    const c0 = drag.c;
    const c = S.crop;
    if (drag.h === "move") {
      c.x = clamp(c0.x + dx, 0, 1 - c0.w);
      c.y = clamp(c0.y + dy, 0, 1 - c0.h);
    } else {
      const v = S.media.info.video;
      const west = drag.h.includes("w"), north = drag.h.includes("n");
      const ax = west ? c0.x + c0.w : c0.x, ay = north ? c0.y + c0.h : c0.y;
      let w = west ? c0.w - dx : c0.w + dx;
      let hh = north ? c0.h - dy : c0.h + dy;
      const maxW = west ? ax : 1 - ax, maxH = north ? ay : 1 - ay;
      w = clamp(w, 0.05, maxW);
      hh = clamp(hh, 0.05, maxH);
      if (c.aspect !== null) {
        const A = (c.aspect === "orig" ? v.width / v.height : c.aspect) * (v.height / v.width);
        if (w / hh > A) w = hh * A; else hh = w / A;
        if (w > maxW) { w = maxW; hh = w / A; }
        if (hh > maxH) { hh = maxH; w = hh * A; }
      }
      c.w = w; c.h = hh;
      c.x = west ? ax - w : ax;
      c.y = north ? ay - hh : ay;
    }
    renderCrop();
  });
  const end = () => { if (drag) { drag = null; changed(); } };
  rect.addEventListener("pointerup", end);
  rect.addEventListener("pointercancel", end);
})();

async function loadLuts(select) {
  S.luts = await api("GET", "/api/luts");
  if (select) S.grade.lut = select;
  if (S.grade.lut && !S.luts.find((l) => l.id === S.grade.lut)) S.grade.lut = "";
  renderLutSel();
}

function renderLutSel() {
  const sel = $("lutSel");
  const bi = S.luts.filter((l) => l.builtin), us = S.luts.filter((l) => !l.builtin);
  sel.replaceChildren(h("option", { value: "" }, "Sin LUT"),
    h("optgroup", { label: "Incluidas" }, ...bi.map((l) => h("option", { value: l.id }, l.name))),
    us.length ? h("optgroup", { label: "Tus LUTs" }, ...us.map((l) => h("option", { value: l.id }, l.name))) : null);
  sel.value = S.grade.lut || "";
  $("lutDel").classList.toggle("hidden", !S.grade.lut.startsWith("user:"));
}
$("lutSel").onchange = () => { S.grade.lut = $("lutSel").value; renderLutSel(); renderSliders(); gradeChanged(); };
$("lutFile").onchange = () => {
  const f = $("lutFile").files[0];
  $("lutFile").value = "";
  if (f) uploadLut(f);
};
$("lutDel").onclick = async () => {
  const l = S.luts.find((x) => x.id === S.grade.lut);
  if (!l || !(await confirmBox(`¿Borrar la LUT «${l.name}»?`))) return;
  await api("DELETE", `/api/luts?id=${encodeURIComponent(l.id)}`);
  S.grade.lut = "";
  await loadLuts();
  gradeChanged();
};
$("gradeReset").onclick = () => { S.grade = { ...GRADE_DEFAULT }; renderLutSel(); renderSliders(); gradeChanged(); };

function renderSliders() {
  for (const [k, , , , , f] of SLIDERS) {
    const inp = $("sl-" + k);
    if (!inp) continue;
    if (document.activeElement !== inp) inp.value = S.grade[k];
    const row = $("slr-" + k);
    row.querySelector(".v").textContent = f(+S.grade[k]);
    row.classList.toggle("changed", Math.abs(S.grade[k] - GRADE_DEFAULT[k]) > 1e-6);
    if (k === "intensity") { inp.disabled = !S.grade.lut; row.classList.toggle("dim", !S.grade.lut); }
  }
}

const cmp = { loaded: false, seq: 0, beforeKey: "", timer: null, pos: 0.5 };
function gradeChanged() {
  clearTimeout(cmp.timer);
  cmp.timer = setTimeout(refreshCompare, 350);
  liveLut();
  recordSoon();
}
async function frameBlob(t, graded) {
  const r = await api("POST", `/api/media/${S.media.id}/frame`, { t, settings: settings(), graded }, true);
  return URL.createObjectURL(await r.blob());
}
async function refreshCompare() {
  if (!S.media || !isVideoFmt(S.out.format)) return;
  if (S.media.proxy_status === "uploading") { $("cmpStatus").textContent = "Disponible cuando termine la subida"; return; }
  const seq = ++cmp.seq;
  const t = video.currentTime || Math.min(1, S.media.info.duration / 2);
  $("cmpStatus").textContent = "Generando…";
  try {
    const key = `${S.media.id}:${t.toFixed(3)}:${S.out.tonemap}`;
    const jobs = [frameBlob(t, true)];
    if (key !== cmp.beforeKey) jobs.push(frameBlob(t, false));
    const [after, before] = await Promise.all(jobs);
    if (seq !== cmp.seq) return;
    const a = $("cmpAfter");
    if (a.src.startsWith("blob:")) URL.revokeObjectURL(a.src);
    a.src = after;
    if (before) {
      const b = $("cmpBefore");
      if (b.src.startsWith("blob:")) URL.revokeObjectURL(b.src);
      b.src = before;
      cmp.beforeKey = key;
    }
    cmp.loaded = true;
    $("cmpEmpty").classList.add("hidden");
    $("cmpStatus").textContent = `Fotograma ${fmtT(t)}`;
  } catch (e) {
    if (seq === cmp.seq) $("cmpStatus").textContent = "Error: " + e.message;
  }
}
$("cmpRefresh").onclick = refreshCompare;

const live = { on: false, gl: null, prog: null, vtex: null, ltex: null, n: 0, key: "", want: "", seq: 0, timer: null, ready: false, lastT: -1, dirty: true, w: 0, h: 0 };
function liveInit() {
  if (live.gl) return true;
  const cv = $("glView");
  const gl = cv.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) return false;
  const sh = (type, src) => {
    const x = gl.createShader(type);
    gl.shaderSource(x, src);
    gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x));
    return x;
  };
  const vs = sh(gl.VERTEX_SHADER, `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`);
  const fs = sh(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D v;
uniform sampler3D l;
uniform float n;
in vec2 uv;
out vec4 o;
void main() {
  vec3 c = clamp(texture(v, uv).rgb, 0.0, 1.0);
  o = vec4(texture(l, c * ((n - 1.0) / n) + 0.5 / n).rgb, 1.0);
}`);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  live.vtex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, live.vtex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  live.ltex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, live.ltex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
  gl.uniform1i(gl.getUniformLocation(prog, "v"), 0);
  gl.uniform1i(gl.getUniformLocation(prog, "l"), 1);
  live.nLoc = gl.getUniformLocation(prog, "n");
  live.gl = gl;
  live.prog = prog;
  return true;
}
function liveGradeKey() {
  const g = S.grade;
  return JSON.stringify({ lut: g.lut || null, intensity: g.intensity, exposure: g.exposure, contrast: g.contrast, highlights: g.highlights, shadows: g.shadows, saturation: g.saturation, temperature: g.temperature, tint: g.tint });
}
function liveLut() {
  if (!live.on) return;
  const key = liveGradeKey();
  if (key === live.key || key === live.want) return;
  live.want = key;
  clearTimeout(live.timer);
  live.timer = setTimeout(async () => {
    const seq = ++live.seq;
    try {
      const r = await api("POST", "/api/grade/lut3d", { grade: JSON.parse(key) }, true);
      const n = +r.headers.get("X-Lut-Size") || 33;
      const data = new Float32Array(await r.arrayBuffer());
      if (seq !== live.seq || !live.on || !live.gl) return;
      const gl = live.gl;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, live.ltex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, n, n, n, 0, gl.RGB, gl.FLOAT, data);
      gl.uniform1f(live.nLoc, n);
      live.n = n;
      live.key = key;
      live.want = "";
      live.ready = true;
      live.dirty = true;
      liveShow();
    } catch (e) {
      if (seq === live.seq) { live.want = ""; toast("No se pudo preparar el color en tiempo real: " + e.message, "err"); }
    }
  }, 120);
}
function liveShow() {
  const on = live.on && live.ready;
  $("glView").classList.toggle("hidden", !on);
  video.classList.toggle("graded", on);
}
function liveFrame() {
  if (!live.ready || video.readyState < 2 || !video.videoWidth) return;
  const t = video.currentTime;
  if (!live.dirty && t === live.lastT && video.paused) return;
  const gl = live.gl, cv = $("glView");
  if (cv.width !== video.videoWidth || cv.height !== video.videoHeight) { cv.width = video.videoWidth; cv.height = video.videoHeight; }
  gl.viewport(0, 0, cv.width, cv.height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, live.vtex);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); } catch { return; }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  live.lastT = t;
  live.dirty = false;
}
video.addEventListener("seeked", () => { live.dirty = true; });
video.addEventListener("loadeddata", () => { live.dirty = true; });
function liveOff() {
  $("liveGrade").checked = false;
  if (!live.on) return;
  live.on = false;
  live.ready = false;
  live.key = "";
  live.want = "";
  live.seq++;
  liveShow();
}
$("liveGrade").checked = false;
$("liveGrade").onchange = () => {
  live.on = $("liveGrade").checked;
  if (live.on) {
    let ok = false;
    try { ok = liveInit(); } catch (e) { console.error(e); }
    if (!ok) { live.on = false; $("liveGrade").checked = false; return toast("Tu navegador no permite el color en tiempo real (WebGL2)", "err"); }
    live.key = "";
    live.want = "";
    live.dirty = true;
    liveLut();
  } else {
    live.ready = false;
    live.key = "";
    live.seq++;
  }
  liveShow();
};
(function compareDrag() {
  const box = $("compare");
  let on = false;
  const set = (e) => {
    const r = box.getBoundingClientRect();
    cmp.pos = clamp((e.clientX - r.left) / r.width, 0, 1);
    $("cmpBeforeWrap").style.clipPath = `inset(0 ${(1 - cmp.pos) * 100}% 0 0)`;
    $("cmpBar").style.left = cmp.pos * 100 + "%";
  };
  box.addEventListener("pointerdown", (e) => { on = true; box.setPointerCapture(e.pointerId); set(e); });
  box.addEventListener("pointermove", (e) => on && set(e));
  box.addEventListener("pointerup", () => (on = false));
  box.addEventListener("pointercancel", () => (on = false));
})();

let jobsTimer = null;
async function pollJobs() {
  clearTimeout(jobsTimer);
  if (!S.project) return;
  const pid = S.project.id;
  try {
    const jobs = await api("GET", `/api/jobs?project=${pid}`);
    if (!S.project || S.project.id !== pid) return;
    S.jobs = jobs;
    for (const j of S.jobs) {
      const prev = S.jobsSeen[j.id];
      if (prev && prev !== j.status) {
        if (j.status === "done") toast(`✓ «${j.name}» listo · ${fmtSize(j.size)}`, "ok");
        if (j.status === "error") toast(`«${j.name}» falló`, "err");
      }
      S.jobsSeen[j.id] = j.status;
    }
    renderJobs();
  } catch {}
  const active = S.jobs.some((j) => j.status === "queued" || j.status === "running");
  jobsTimer = setTimeout(pollJobs, active ? 1000 : 8000);
}

function jobLabel(j) {
  const f = j.settings && j.settings.output ? j.settings.output.format : "";
  const x = S.config.formats.find((y) => y.id === f);
  return x ? x.label : f;
}

function renderJobs() {
  const active = S.jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  $("jobsBadge").textContent = active;
  $("jobsBadge").classList.toggle("hidden", !active);
  if (!S.jobs.length) return $("jobs").replaceChildren(h("div", { class: "muted small empty" }, "Todavía no hay renders."));
  const ST = { queued: "En cola", running: "Renderizando", done: "Listo", error: "Error", canceled: "Cancelado" };
  $("jobs").replaceChildren(...S.jobs.map((j) => {
    const info = [];
    info.push(j.media_name);
    if (j.width) info.push(`${j.width}×${j.height}`);
    info.push(fmtDur(j.duration));
    info.push(jobLabel(j));
    const live = j.status === "running" || j.status === "queued";
    let prog = null;
    if (live) {
      const p = Math.round((j.progress || 0) * 100);
      const extra = j.status === "running" ? [`${p}%`, j.speed ? `${j.speed.toFixed(2)}×` : null, j.eta ? `quedan ${fmtDur(j.eta)}` : null].filter(Boolean).join(" · ") : "Esperando turno";
      prog = [h("div", { class: "bar" }, h("i", { style: `width:${p}%` })), h("div", { class: "muted small mono" }, extra)];
    } else if (j.status === "done") {
      const took = j.finished && j.started ? ` · en ${fmtDur(j.finished - j.started)}` : "";
      prog = [h("div", { class: "muted small mono" }, `${fmtSize(j.size)}${took}${j.note ? " · " + j.note : ""}`)];
    }
    const acts = [];
    if (j.status === "done" && j.has_file) {
      acts.push(h("a", { class: "btn sm primary", href: `/api/jobs/${j.id}/file?dl=1` }, "Descargar"));
      acts.push(h("a", { class: "btn sm", href: `/api/jobs/${j.id}/file`, target: "_blank", rel: "noopener" }, "Ver"));
    }
    if (j.settings && S.media && S.media.id === j.media_id && !live) acts.push(h("button", { class: "btn sm ghost", onclick: () => applySettings(j.settings), title: "Cargar estos ajustes en el editor" }, "Reusar ajustes"));
    if (live) acts.push(h("button", { class: "btn sm", onclick: async () => { await api("POST", `/api/jobs/${j.id}/cancel`); pollJobs(); } }, "Cancelar"));
    else acts.push(h("button", { class: "btn sm ghost", onclick: async () => { if (await confirmBox(`¿Borrar «${j.name}»${j.has_file ? " y su archivo" : ""}?`)) { await api("DELETE", `/api/jobs/${j.id}`); pollJobs(); } } }, "Borrar"));
    return h("div", { class: "job" },
      h("div", { class: "min0" },
        h("div", { class: "ellipsis" }, h("span", { class: "t" }, j.name), h("span", { class: "pill " + j.status }, ST[j.status] || j.status)),
        h("div", { class: "muted small ellipsis" }, info.join(" · ")),
        prog),
      h("div", { class: "acts" }, acts),
      j.status === "error" && j.error ? h("div", { class: "errtxt" }, j.error) : null);
  }));
}

function applySettings(s) {
  S.segs = s.segments.map((x) => ({ ...x }));
  S.sel = 0;
  S.crop = { ...S.crop, ...s.crop, aspect: null };
  S.rotate = s.rotate || 0; S.flip_h = !!s.flip_h; S.flip_v = !!s.flip_v;
  S.grade = { ...GRADE_DEFAULT, ...Object.fromEntries(Object.entries(s.grade || {}).filter(([, v]) => v !== null)), sharpen: s.sharpen || 0 };
  if (!S.grade.lut) S.grade.lut = "";
  const o = s.output;
  Object.assign(S.out, { format: o.format, height: o.height, fps: o.fps, mode: o.mode, size_mb: o.size_mb, preset: o.preset, encoder: o.encoder,
    tonemap: o.tonemap, slowmo: o.slowmo, audioMode: o.audio.mode, abr: o.audio.bitrate, volume: o.audio.volume, fade_in: o.fade_in, fade_out: o.fade_out });
  if (o.crf != null) S.out.crfBy[o.format] = o.crf;
  S.out.tenBy[o.format] = o.ten_bit;
  S.atrack = o.audio.track || 0;
  S.subs = { ...S.subs, key: s.subs ? s.subs.key : "", mode: s.subs ? s.subs.mode : "burn", size: s.subs ? s.subs.size : 1 };
  S.tracks = Array.isArray(s.tracks) ? s.tracks.map(normTrack).filter(Boolean) : s.music && s.music.id ? legacyTracks(s.music) : [];
  S.msel = null;
  S.aregs = s.aregions && s.aregions.length ? s.aregions.map((r) => ({ ...r })) : [{ start: 0, end: S.media.info.duration, vol: 1 }];
  normAregs();
  changed();
  gradeChanged();
  toast("Ajustes cargados");
}

$("clearDone").onclick = async () => {
  const done = S.jobs.filter((j) => ["done", "error", "canceled"].includes(j.status));
  if (!done.length) return;
  if (!(await confirmBox(`¿Borrar ${done.length} render(s) terminados y sus archivos?`))) return;
  await Promise.all(done.map((j) => api("DELETE", `/api/jobs/${j.id}`)));
  pollJobs();
};
$("jobsBtn").onclick = () => $("jobsCard").scrollIntoView({ behavior: "smooth", block: "start" });

const CHUNK = 16 * 1024 * 1024;
const upQueue = [];
let uploading = false;
let navNext = false;
function enqueueUploads(files) {
  if (!uploading && !upQueue.length) navNext = true;
  for (const f of files) upQueue.push(f);
  if (!uploading) nextUpload();
}
async function nextUpload() {
  const f = upQueue.shift();
  if (!f) { uploading = false; return; }
  uploading = true;
  try { await uploadFile(f); } catch (e) { toast(`Error subiendo «${f.name}»: ${e.message}`, "err"); }
  nextUpload();
}
async function uploadFile(file) {
  if (S.config && file.size > S.config.max_upload) throw new Error(`supera el máximo de ${fmtSize(S.config.max_upload)}`);
  const key = `vt-up:${file.name}:${file.size}:${file.lastModified}`;
  let saved = store.get(key), id = null, mid = null, pid = null, offset = 0;
  if (saved && typeof saved === "object") { id = saved.id; mid = saved.mid; pid = saved.pid; } else if (saved) id = saved;
  if (id) {
    try { offset = (await api("GET", `/api/uploads/${id}`)).offset; } catch { id = null; mid = null; pid = null; }
  }
  let local = null;
  if (!id || mid) {
    try { local = await probeLocal(file); } catch { local = null; }
  }
  if (!id) {
    const r = await api("POST", "/api/uploads", { name: file.name, size: file.size, local: local ? local.meta : null });
    id = r.id; mid = r.media_id || null; pid = r.project_id || null;
    store.set(key, { id, mid, pid });
  }
  if (mid && local) {
    LOCAL.set(mid, { file, url: local.url, moov: local.moov, audio: null, peaks: null });
    if (navNext || !S.project) { navNext = false; location.hash = `#/p/${pid}`; }
    else refreshHome();
  } else {
    if (local) URL.revokeObjectURL(local.url);
    if (S.project) location.hash = "#/";
  }
  let cancel = false;
  const bar = h("i");
  const stat = h("span", { class: "muted small mono" });
  const row = h("div", { class: "upl" },
    h("div", { class: "min0 ellipsis" }, h("b", {}, file.name), " ", stat),
    h("button", { class: "btn sm ghost", onclick: async () => { cancel = true; try { await api("DELETE", `/api/uploads/${id}`); } catch {} store.del(key); row.remove(); if (mid && S.media && S.media.id === mid) location.hash = "#/"; } }, "Cancelar"),
    h("div", { class: "bar" }, bar));
  $("uploads").append(row);
  if (offset) toast(`Reanudando «${file.name}» desde ${fmtSize(offset)}`);
  const t0 = performance.now(), off0 = offset;
  let fails = 0;
  while (offset < file.size && !cancel) {
    const chunk = file.slice(offset, offset + CHUNK);
    try {
      const r = await fetch(`/api/uploads/${id}?offset=${offset}`, { method: "PUT", body: chunk, headers: { "content-type": "application/octet-stream" } });
      if (r.status === 409) { offset = (await r.json()).offset; continue; }
      if (r.status === 401) { showLogin(); throw new Error("sesión caducada"); }
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
      offset = (await r.json()).offset;
      fails = 0;
    } catch (e) {
      if (cancel) break;
      if (++fails > 30) throw e;
      stat.textContent = `· sin conexión, reintentando (${fails})…`;
      await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * fails)));
      try { offset = (await api("GET", `/api/uploads/${id}`)).offset; } catch {}
      continue;
    }
    const el = (performance.now() - t0) / 1000;
    const rate = (offset - off0) / Math.max(el, 0.001);
    const eta = rate > 0 ? (file.size - offset) / rate : 0;
    bar.style.width = (offset / file.size) * 100 + "%";
    stat.textContent = `· ${fmtSize(offset)} de ${fmtSize(file.size)} · ${fmtSize(rate)}/s · quedan ${fmtDur(eta)}`;
    if (mid && S.media && S.media.id === mid && S.media.proxy_status === "uploading") {
      S.media.upload_progress = offset / file.size;
      localBadge(S.media);
      renderOutput();
    }
  }
  if (cancel) return;
  stat.textContent = "· analizando…";
  const m = await api("POST", `/api/uploads/${id}/complete`);
  store.del(key);
  row.remove();
  if (mid) {
    if (S.media && S.media.id === mid) pollMedia();
    else if (!S.project) refreshHome();
  } else await newProject(m);
}

const drone = { items: [], seq: 0 };
function droneOpen() {
  drone.items = [];
  droneRender();
  $("droneModal").classList.remove("hidden");
}
function droneClose() { $("droneModal").classList.add("hidden"); }
function droneCut(it) { return [Math.max(0, parseFloat(it.a) || 0), Math.max(0, parseFloat(it.b) || 0)]; }
function droneItemRes(it) {
  const [a, b] = droneCut(it);
  if (!it.dur) return [true, a || b ? `Se quitan ${a} s del inicio y ${b} s del final` : "Vídeo entero"];
  const left = it.dur - a - b;
  if (left < 0.5) return [false, "Quitas más de lo que dura el vídeo"];
  return [true, a || b ? `Quedará de ${fmtT(a)} a ${fmtT(it.dur - b)} · ${fmtT(left)}` : `Vídeo entero · ${fmtT(it.dur)}`];
}
function droneCheck() {
  let ok = drone.items.length > 0;
  for (const it of drone.items) {
    const [good, msg] = droneItemRes(it);
    if (!good) ok = false;
    if (it.resEl) { it.resEl.textContent = msg; it.resEl.classList.toggle("bad", !good); }
  }
  const n = drone.items.length;
  $("droneGo").disabled = !ok;
  $("droneGo").textContent = n > 1 ? `Subir y renderizar ${n} vídeos` : "Subir y renderizar";
}
function droneRender() {
  $("droneList").replaceChildren(...drone.items.map((it) => {
    const num = (key) => {
      const inp = h("input", { type: "number", min: "0", step: "0.1", placeholder: "0", class: "num" });
      inp.value = it[key];
      inp.addEventListener("input", () => { it[key] = inp.value; droneCheck(); });
      return inp;
    };
    it.resEl = h("div", { class: "muted res" });
    it.infoEl = h("div", { class: "muted small mono" }, fmtSize(it.file.size) + (it.dur ? " · " + fmtT(it.dur) : ""));
    return h("div", { class: "drone-item" },
      h("div", { class: "nm min0" }, h("div", { class: "ellipsis", title: it.file.name }, it.file.name), it.infoEl),
      h("label", { class: "mini" }, "Inicio", num("a"), "s"),
      h("label", { class: "mini" }, "Final", num("b"), "s"),
      h("button", { class: "icon", title: "Quitar de la lista", onclick: () => { drone.items = drone.items.filter((x) => x !== it); droneRender(); } }, "✕"),
      it.resEl);
  }));
  droneCheck();
}
function droneAdd(files) {
  for (const f of files) {
    if (!(VIDEO_RE.test(f.name) || f.type.startsWith("video/"))) { toast(`«${f.name}» no es un vídeo`, "err"); continue; }
    const it = { id: ++drone.seq, file: f, dur: 0, a: "", b: "" };
    drone.items.push(it);
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = () => { URL.revokeObjectURL(url); v.removeAttribute("src"); };
    v.onloadedmetadata = () => {
      if (isFinite(v.duration) && v.duration > 0) {
        it.dur = v.duration;
        if (it.infoEl) it.infoEl.textContent = `${fmtSize(f.size)} · ${fmtT(it.dur)}`;
        droneCheck();
      }
      done();
    };
    v.onerror = done;
    v.src = url;
  }
  droneRender();
}
$("droneBtn").onclick = droneOpen;
$("droneClose").onclick = droneClose;
$("droneCancel").onclick = droneClose;
$("droneModal").addEventListener("pointerdown", (e) => { if (e.target === $("droneModal")) droneClose(); });
$("droneFile").onchange = () => { droneAdd([...$("droneFile").files]); $("droneFile").value = ""; };
(function droneDnd() {
  const d = $("droneDrop");
  d.addEventListener("dragover", (e) => { e.preventDefault(); d.classList.add("over"); });
  d.addEventListener("dragleave", () => d.classList.remove("over"));
})();
const droneQ = [];
let droneBusy = false;
$("droneGo").onclick = () => {
  const items = drone.items.map((it) => ({ file: it.file, cut: droneCut(it) }));
  if (!items.length) return;
  drone.items = [];
  droneClose();
  if (location.hash !== "#/" && location.hash !== "") location.hash = "#/";
  droneQ.push(...items);
  droneNext();
};
async function droneNext() {
  if (droneBusy) return;
  const it = droneQ.shift();
  if (!it) return;
  droneBusy = true;
  try { await droneRun(it.file, it.cut[0], it.cut[1]); }
  catch (e) { toast(`Edición rápida de «${it.file.name}»: ${e.message}`, "err"); }
  droneBusy = false;
  droneNext();
}

async function droneRun(file, cutIn, cutOut) {
  if (S.config && file.size > S.config.max_upload) throw new Error(`supera el máximo de ${fmtSize(S.config.max_upload)}`);
  const lut = S.luts.find((l) => l.name.toLowerCase() === "berry") || S.luts.find((l) => l.id === "builtin:Dron punch");
  if (!lut) throw new Error("no encuentro la LUT «Berry»");
  const stat = h("span", { class: "muted small mono" });
  const bar = h("i");
  let cancel = false, id = null;
  const row = h("div", { class: "upl" },
    h("div", { class: "min0 ellipsis" }, h("b", {}, file.name), " ", stat),
    h("button", { class: "btn sm ghost", onclick: async () => { cancel = true; if (id) { try { await api("DELETE", `/api/uploads/${id}`); } catch {} } row.remove(); } }, "Cancelar"),
    h("div", { class: "bar" }, bar));
  $("uploads").append(row);
  try {
    const r0 = await api("POST", "/api/uploads", { name: file.name, size: file.size, quick: true });
    id = r0.id;
    let offset = 0, fails = 0;
    const t0 = performance.now();
    while (offset < file.size && !cancel) {
      try {
        const r = await fetch(`/api/uploads/${id}?offset=${offset}`, { method: "PUT", body: file.slice(offset, offset + CHUNK), headers: { "content-type": "application/octet-stream" } });
        if (r.status === 409) { offset = (await r.json()).offset; continue; }
        if (r.status === 401) { showLogin(); throw new Error("sesión caducada"); }
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
        offset = (await r.json()).offset;
        fails = 0;
      } catch (e) {
        if (cancel) break;
        if (++fails > 30) throw e;
        stat.textContent = `· sin conexión, reintentando (${fails})…`;
        await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * fails)));
        try { offset = (await api("GET", `/api/uploads/${id}`)).offset; } catch {}
        continue;
      }
      const rate = offset / Math.max((performance.now() - t0) / 1000, 0.001);
      bar.style.width = (offset / file.size) * 100 + "%";
      stat.textContent = `· subiendo ${fmtSize(offset)} de ${fmtSize(file.size)} · ${fmtSize(rate)}/s · quedan ${fmtDur(rate > 0 ? (file.size - offset) / rate : 0)}`;
    }
    if (cancel) return;
    stat.textContent = "· analizando…";
    const m = await api("POST", `/api/uploads/${id}/complete`);
    id = null;
    const d = m.info.duration;
    const start = Math.min(cutIn, Math.max(0, d - 0.5)), end = Math.max(start + 0.5, d - cutOut);
    const v = m.info.video;
    const short = Math.min(v.width, v.height);
    const base = file.name.replace(/\.[^.]+$/, "");
    const mk = (mode) => ({
      segments: [{ start: +start.toFixed(3), end: +end.toFixed(3), speed: 1 }], aregions: [],
      crop: { enabled: false, x: 0, y: 0, w: 1, h: 1 }, rotate: 0, flip_h: false, flip_v: false,
      grade: { lut: lut.id, intensity: 1, exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, temperature: 0, tint: 0 }, sharpen: 0,
      output: { format: "h264", height: short > 720 ? 720 : 0, fps: 30, mode, crf: 22, size_mb: 95, preset: "slow", encoder: "cpu", ten_bit: false, tonemap: true, slowmo: "dup",
        audio: { mode: "mute", bitrate: 160, volume: 1, track: 0 }, fade_in: 0, fade_out: 0 },
      subs: null, tracks: [],
    });
    stat.textContent = "· calculando tamaño…";
    const est = await api("POST", `/api/media/${m.id}/estimate`, mk("crf"));
    const mode = est.size > 100 * 1024 * 1024 ? "size" : "crf";
    await api("POST", "/api/jobs", { media_id: m.id, settings: mk(mode), name: `${base}_dron` });
    row.remove();
    refreshQuick();
  } catch (e) {
    row.remove();
    throw e;
  }
}

let quickTimer = null;
async function refreshQuick() {
  clearTimeout(quickTimer);
  let jobs = [];
  try { jobs = await api("GET", "/api/jobs?quick=1"); } catch { quickTimer = setTimeout(refreshQuick, 5000); return; }
  $("quickBox").classList.toggle("hidden", !jobs.length);
  const ST = { queued: "En cola", running: "Renderizando", done: "Listo", error: "Error", canceled: "Cancelado" };
  $("quickJobs").replaceChildren(...jobs.map((j) => {
    const live = j.status === "running" || j.status === "queued";
    const p = Math.round((j.progress || 0) * 100);
    const o = (j.settings && j.settings.output) || {};
    const info = [j.media_name, j.width ? `${j.width}×${j.height}` : null, fmtDur(j.duration), o.mode === "size" ? "95 MB objetivo" : "CRF 22"].filter(Boolean).join(" · ");
    const extra = j.status === "running" ? [`${p}%`, j.speed ? `${j.speed.toFixed(2)}×` : null, j.eta ? `quedan ${fmtDur(j.eta)}` : null].filter(Boolean).join(" · ")
      : j.status === "queued" ? "Esperando turno"
      : j.status === "done" ? `${fmtSize(j.size)}${j.finished && j.started ? ` · en ${fmtDur(j.finished - j.started)}` : ""}` : "";
    const acts = [];
    if (j.status === "done" && j.has_file) {
      acts.push(h("a", { class: "btn sm primary", href: `/api/jobs/${j.id}/file?dl=1` }, "Descargar"));
      acts.push(h("a", { class: "btn sm", href: `/api/jobs/${j.id}/file`, target: "_blank", rel: "noopener" }, "Ver"));
    }
    if (live) acts.push(h("button", { class: "btn sm", onclick: async () => { await api("POST", `/api/jobs/${j.id}/cancel`); refreshQuick(); } }, "Cancelar"));
    else acts.push(h("button", { class: "btn sm ghost", onclick: async () => { if (await confirmBox(`¿Borrar «${j.name}»${j.has_file ? " y su archivo" : ""}?`)) { await api("DELETE", `/api/jobs/${j.id}`); refreshQuick(); } } }, "Borrar"));
    return h("div", { class: "job" },
      h("div", { class: "min0" },
        h("div", { class: "ellipsis" }, h("span", { class: "t" }, j.name), h("span", { class: "pill " + j.status }, ST[j.status] || j.status)),
        h("div", { class: "muted small ellipsis" }, info),
        live ? h("div", { class: "bar" }, h("i", { style: `width:${p}%` })) : null,
        extra ? h("div", { class: "muted small mono" }, extra) : null),
      h("div", { class: "acts" }, acts),
      j.status === "error" && j.error ? h("div", { class: "errtxt" }, j.error) : null);
  }));
  for (const j of jobs) {
    const prev = S.jobsSeen["q" + j.id];
    if (prev && prev !== j.status && j.status === "done") toast(`✓ «${j.name}» listo · ${fmtSize(j.size)}`, "ok");
    if (prev && prev !== j.status && j.status === "error") toast(`«${j.name}» falló`, "err");
    S.jobsSeen["q" + j.id] = j.status;
  }
  const active = jobs.some((j) => j.status === "running" || j.status === "queued");
  if (active || !$("homeView").classList.contains("hidden")) quickTimer = setTimeout(refreshQuick, active ? 1500 : 15000);
}

$("fileInput").onchange = () => { enqueueUploads([...$("fileInput").files]); $("fileInput").value = ""; };
(function dnd() {
  const d = $("drop");
  let depth = 0, internal = false;
  document.addEventListener("dragstart", () => { internal = true; });
  document.addEventListener("dragend", () => { internal = false; });
  window.addEventListener("dragenter", (e) => { if (!internal && e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { depth++; d.classList.add("over"); } });
  window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) d.classList.remove("over"); });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    d.classList.remove("over");
    if (internal) { internal = false; return; }
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    if (!$("droneModal").classList.contains("hidden")) { $("droneDrop").classList.remove("over"); return droneAdd(files); }
    const vids = [];
    for (const f of files) {
      if (VIDEO_RE.test(f.name) || (f.type.startsWith("video/") && !SUB_RE.test(f.name))) vids.push(f);
      else if (SUB_RE.test(f.name)) uploadSub(f);
      else if (AUDIO_RE.test(f.name) || f.type.startsWith("audio/")) uploadMusic(f);
      else if (/\.cube$/i.test(f.name)) uploadLut(f);
      else toast(`«${f.name}» no es un vídeo, audio, subtítulo ni LUT`, "err");
    }
    if (vids.length) enqueueUploads(vids);
  });
})();

const lib = { root: null, path: "" };
$("libBtn").onclick = () => {
  $("libModal").classList.remove("hidden");
  const saved = store.get("vt-lib");
  if (saved && S.config.library.includes(saved.root)) { lib.root = saved.root; lib.path = saved.path; }
  else { lib.root = S.config.library[0]; lib.path = ""; }
  $("rootChips").replaceChildren(...S.config.library.map((r) => h("button", { class: "chip", "data-r": r, onclick: () => { lib.root = r; lib.path = ""; browse(); } }, r)));
  $("rootChips").classList.toggle("hidden", S.config.library.length < 2);
  browse();
};
$("libClose").onclick = () => $("libModal").classList.add("hidden");
$("libModal").addEventListener("pointerdown", (e) => { if (e.target === $("libModal")) $("libModal").classList.add("hidden"); });

async function browse() {
  setOn("#rootChips .chip", (b) => b.dataset.r === lib.root);
  const list = $("libList");
  list.replaceChildren(h("div", { class: "lib-item muted" }, "Cargando…"));
  let r;
  try { r = await api("GET", `/api/library?root=${encodeURIComponent(lib.root)}&path=${encodeURIComponent(lib.path)}`); }
  catch (e) {
    if (lib.path) { lib.path = ""; return browse(); }
    return list.replaceChildren(h("div", { class: "lib-item err" }, e.message));
  }
  lib.path = r.path;
  store.set("vt-lib", { root: lib.root, path: lib.path });
  const parts = r.path ? r.path.split("/") : [];
  const crumbs = [h("a", { onclick: () => { lib.path = ""; browse(); } }, lib.root)];
  parts.forEach((p, i) => { crumbs.push(h("span", { class: "muted" }, " / ")); crumbs.push(h("a", { onclick: () => { lib.path = parts.slice(0, i + 1).join("/"); browse(); } }, p)); });
  $("crumbs").replaceChildren(...crumbs);
  const items = [];
  if (r.path) items.push(h("div", { class: "lib-item", onclick: () => { lib.path = parts.slice(0, -1).join("/"); browse(); } }, h("span", { class: "ic" }, "↑"), h("span", { class: "muted" }, "Subir un nivel")));
  for (const d of r.dirs) items.push(h("div", { class: "lib-item", onclick: () => { lib.path = (r.path ? r.path + "/" : "") + d.name; browse(); } }, h("span", { class: "ic" }, "📁"), h("span", { class: "grow ellipsis" }, d.name)));
  for (const f of r.files) items.push(h("div", { class: "lib-item", onclick: (e) => importFile(f, e.currentTarget) }, h("span", { class: "ic" }, "🎞"), h("span", { class: "grow ellipsis" }, f.name), h("span", { class: "muted small mono" }, fmtSize(f.size))));
  if (!r.dirs.length && !r.files.length) items.push(h("div", { class: "lib-item muted" }, "No hay vídeos en esta carpeta"));
  list.replaceChildren(...items);
}
async function importFile(f, el) {
  el.classList.add("dim");
  el.lastChild.textContent = "abriendo…";
  try {
    const m = await api("POST", "/api/library/import", { root: lib.root, path: (lib.path ? lib.path + "/" : "") + f.name });
    $("libModal").classList.add("hidden");
    await newProject(m);
  } catch (e) { toast(e.message, "err"); el.classList.remove("dim"); el.lastChild.textContent = fmtSize(f.size); }
}

document.addEventListener("keydown", (e) => {
  if (!S.media || !S.project) return;
  const tg = e.target;
  const typing = tg && (tg.tagName === "TEXTAREA" || (tg.tagName === "INPUT" && !["range", "checkbox", "radio"].includes(tg.type)));
  if (!$("libModal").classList.contains("hidden") || !$("confirmModal").classList.contains("hidden")) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing) {
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); return undo(); }
    if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); return redo(); }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (tg && (tg.tagName === "INPUT" || tg.tagName === "SELECT" || tg.tagName === "TEXTAREA")) return;
  const k = e.key;
  if (k === " ") { e.preventDefault(); togglePlay(); }
  else if (k === "i" || k === "I") setIn();
  else if (k === "o" || k === "O") setOut();
  else if (k === "s" || k === "S") cutSelected();
  else if (k === "Delete" || k === "Backspace") {
    e.preventDefault();
    const c = S.lane === "music" && trackBy(S.msel);
    if (c) removeTrack(c.uid);
    else if (S.lane === "audio") { const r = S.aregs[S.asel]; if (r) { r.vol = r.vol === 0 ? 1 : 0; changed(); } }
    else removeSeg(S.sel);
  }
  else if (k === "Escape") { hideMenu(); if (S.msel) { S.msel = null; renderMusic(); } }
  else if (k === "ArrowLeft") { e.preventDefault(); video.pause(); seek(curSrc() - (e.shiftKey ? 1 : frameDur())); }
  else if (k === "ArrowRight") { e.preventDefault(); video.pause(); seek(curSrc() + (e.shiftKey ? 1 : frameDur())); }
  else if (k === "Home") seekOut(0);
  else if (k === "End") seekOut(outTotal());
});

boot().catch((e) => toast(e.message, "err"));
