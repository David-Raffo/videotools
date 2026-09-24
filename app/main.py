import asyncio
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import shutil
import signal
import sqlite3
import subprocess
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import ff
from .grade import LutStore

DATA = Path(os.environ.get("DATA_DIR", "/data"))
STATIC = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))
PASSWORD = os.environ.get("APP_PASSWORD", "")
MAX_UPLOAD = int(float(os.environ.get("MAX_UPLOAD_GB", "20")) * 1024 ** 3)
RETENTION_DAYS = float(os.environ.get("RETENTION_DAYS", "0"))
NICE = os.environ.get("NICE", "10")
HW_DECODE = os.environ.get("HW_DECODE", "0") == "1"
SUB_EXT = {".srt", ".ass", ".ssa", ".vtt"}
PROXY_VERSION = "11"
MUSIC_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wma", ".aif", ".aiff", ".mp4", ".mov", ".mkv", ".webm", ".m4v"}
MAX_AUDIO_TRACKS = 8
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mts", ".m2ts", ".ts", ".mpg", ".mpeg", ".wmv", ".flv", ".3gp", ".mxf", ".lrv", ".insv", ".dv"}

for d in ["media", "uploads", "outputs", "luts", "cache/luts", "tmp", "fonts"]:
    (DATA / d).mkdir(parents=True, exist_ok=True)


def _roots():
    roots = {}
    for part in os.environ.get("LIBRARY_ROOTS", "").split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            if k.strip() and Path(v.strip()).is_dir():
                roots[k.strip()] = Path(v.strip()).resolve()
    return roots


ROOTS = _roots()
SECRET_FILE = DATA / "secret"
if not SECRET_FILE.exists():
    SECRET_FILE.write_text(secrets.token_hex(32))
SECRET = SECRET_FILE.read_text().strip()
TOKEN = hmac.new(SECRET.encode(), ("auth:" + PASSWORD).encode(), hashlib.sha256).hexdigest()

CAPS = ff.detect_caps()
LUTS = LutStore(DATA / "luts", DATA / "cache/luts")


class DB:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.c = sqlite3.connect(path, check_same_thread=False)
        self.c.row_factory = sqlite3.Row
        self.c.executescript("""
        create table if not exists media(id text primary key, name text, source text, origin text, info text,
          proxy text, proxy_status text, proxy_progress real, thumbs integer default 0, error text, created real);
        create table if not exists jobs(id text primary key, media_id text, media_name text, name text, settings text,
          status text, progress real default 0, speed real, eta real, error text, note text, output text, size integer,
          duration real, width integer, height integer, created real, started real, finished real);
        create table if not exists projects(id text primary key, name text, media_id text, state text, created real, updated real);
        """)
        cols = [r[1] for r in self.c.execute("pragma table_info(jobs)").fetchall()]
        if "project_id" not in cols:
            self.c.execute("alter table jobs add column project_id text")
        self.c.commit()

    def q(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.c.execute(sql, args).fetchall()]

    def one(self, sql, args=()):
        r = self.q(sql, args)
        return r[0] if r else None

    def x(self, sql, args=()):
        with self.lock:
            self.c.execute(sql, args)
            self.c.commit()


db = DB(DATA / "app.db")
proxy_q = queue.Queue()
render_q = queue.Queue()
running = {}


def ext_subs(mid):
    p = DATA / "media" / mid / "subs.json"
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return []


def safe_src(m):
    src = m["source"]
    if re.fullmatch(r"[A-Za-z0-9_./-]+", src):
        return src
    mdir = DATA / "media" / m["id"]
    mdir.mkdir(parents=True, exist_ok=True)
    link = mdir / ("srclink" + re.sub(r"[^A-Za-z0-9.]", "", Path(src).suffix.lower()))
    if not link.is_symlink() or os.readlink(link) != src:
        link.unlink(missing_ok=True)
        link.symlink_to(src)
    return str(link)


def resolve_sub(m, info, s):
    cfg = s.get("subs") or {}
    key = cfg.get("key") or ""
    if not key:
        return None
    mode = "soft" if cfg.get("mode") == "soft" else "burn"
    size = float(cfg.get("size") or 1)
    if key.startswith("e:"):
        subs = info.get("subtitles") or []
        k = int(key[2:])
        if k < 0 or k >= len(subs):
            raise ValueError("Esa pista de subtítulos no existe")
        x = subs[k]
        if not x["text"] and not x["image"]:
            raise ValueError(f"No sé usar subtítulos en formato {x['codec']}")
        return {"path": safe_src(m), "si": k, "ass": x["codec"] in ("ass", "ssa"), "image": x["image"], "external": False,
                "mode": mode, "size": size, "lang": x.get("lang")}
    if key.startswith("x:"):
        sid = key[2:]
        for x in ext_subs(m["id"]):
            if x["id"] == sid:
                path = DATA / "media" / m["id"] / "subs" / f"{sid}{x['ext']}"
                if not path.exists():
                    break
                return {"path": str(path), "si": None, "ass": x["ext"] in (".ass", ".ssa"), "image": False, "external": True,
                        "mode": mode, "size": size, "lang": None}
        raise ValueError("El archivo de subtítulos ya no existe")
    raise ValueError("Subtítulos no válidos")


def music_items(mid):
    p = DATA / "media" / mid / "music.json"
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return []


def resolve_music(m, s):
    clips = s.get("tracks")
    if clips is None:
        legacy = s.get("music") or {}
        clips = [dict(legacy, asset=legacy.get("id"))] if legacy.get("id") else []
    if not isinstance(clips, list):
        raise ValueError("Pistas de audio no válidas")
    items = {x["id"]: x for x in music_items(m["id"])}
    out = []
    for cfg in clips[:32]:
        if not isinstance(cfg, dict):
            continue
        aid = str(cfg.get("asset") or "")
        x = items.get(aid)
        if not x:
            raise ValueError("Un audio de la línea de tiempo ya no existe")
        path = DATA / "media" / m["id"] / "music" / f"{aid}{x['ext']}"
        if not path.exists():
            raise ValueError("Un audio de la línea de tiempo ya no existe")
        dur = float(x.get("duration") or 0)

        def num(k, d, lo, hi):
            try:
                v = float(cfg.get(k, d) if cfg.get(k) is not None else d)
            except (TypeError, ValueError):
                v = d
            return min(max(v, lo), hi)

        ti = num("trim_in", 0, 0, max(0, dur - 0.05))
        to = num("trim_out", dur, ti + 0.05, dur) if dur else ti + 0.05
        out.append({"path": str(path), "offset": num("offset", 0, 0, 86400), "trim_in": ti, "trim_out": to,
                    "vol": num("vol", 1, 0, 4), "fade_in": num("fade_in", 0, 0, 30), "fade_out": num("fade_out", 0, 0, 30)})
    return out


def media_out(m):
    if not m:
        return None
    m = dict(m)
    m["info"] = json.loads(m["info"]) if m.get("info") else None
    m["ext_subs"] = ext_subs(m["id"])
    m["music"] = music_items(m["id"])
    mdir = DATA / "media" / m["id"]
    m["preview_audio"] = [k for k in range(MAX_AUDIO_TRACKS) if (mdir / f"audio-{k}.mp3").exists()] if m.get("proxy_status") == "ready" else []
    m["wave"] = (mdir / "wave.png").exists()
    m["upload_progress"] = None
    if m.get("proxy_status") == "uploading":
        try:
            uid = json.loads((mdir / "upload.json").read_text())["uid"]
            um = json.loads((DATA / "uploads" / f"{uid}.json").read_text())
            m["upload_progress"] = round((DATA / "uploads" / f"{uid}.part").stat().st_size / max(1, um["size"]), 4)
        except (OSError, ValueError, KeyError):
            m["upload_progress"] = 0
    try:
        m["scrub"] = json.loads((mdir / "scrub.json").read_text())
    except (OSError, ValueError):
        m["scrub"] = None
    pv = m.get("proxy") if m.get("proxy_status") == "ready" else (m.get("source") if m.get("proxy_status") == "direct" else None)
    try:
        st = os.stat(pv) if pv else None
        m["preview_v"] = int(st.st_mtime) if st else 0
        m["preview_size"] = st.st_size if st else 0
    except OSError:
        m["preview_v"] = 0
        m["preview_size"] = 0
    m.pop("proxy", None)
    m["source_name"] = Path(m.pop("source")).name
    return m


def job_out(j):
    j = dict(j)
    j["settings"] = json.loads(j["settings"]) if j.get("settings") else None
    j["has_file"] = bool(j.get("output")) and Path(j["output"]).exists()
    j.pop("output", None)
    return j


def run_ff(cmd, total, on_progress=None, key=None):
    full = ["nice", "-n", NICE] + cmd if NICE and NICE != "0" else cmd
    errf = open(DATA / "tmp" / f"err-{uuid.uuid4().hex}.log", "w+")
    p = subprocess.Popen(full, stdout=subprocess.PIPE, stderr=errf, text=True, start_new_session=True)
    if key:
        running[key] = p
    t0 = time.time()
    cur = {}
    try:
        for line in p.stdout:
            line = line.strip()
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            cur[k] = v
            if k == "progress" and on_progress:
                us = cur.get("out_time_us") or cur.get("out_time_ms") or "0"
                try:
                    done = max(0.0, int(us) / 1e6)
                except ValueError:
                    done = 0.0
                frac = min(1.0, done / total) if total > 0 else 0.0
                el = time.time() - t0
                eta = (el / frac - el) if frac > 0.01 else None
                sp = cur.get("speed", "").rstrip("x").strip()
                try:
                    sp = float(sp)
                except ValueError:
                    sp = None
                on_progress(frac, sp, eta)
        p.wait()
    finally:
        if key:
            running.pop(key, None)
        errf.seek(0)
        err = errf.read()
        errf.close()
        try:
            os.unlink(errf.name)
        except OSError:
            pass
    return p.returncode, err


def proxy_worker():
    while True:
        mid = proxy_q.get()
        m = db.one("select * from media where id=?", (mid,))
        if not m:
            continue
        info = json.loads(m["info"])
        src = Path(m["source"])
        mdir = DATA / "media" / mid
        mdir.mkdir(parents=True, exist_ok=True)
        try:
            preview = src
            if m["proxy_status"] != "direct":
                db.x("update media set proxy_status='running', proxy_progress=0 where id=?", (mid,))
                out = mdir / "proxy.mp4"
                tmp = mdir / "proxy.tmp.mp4"
                for old in list(mdir.glob("audio-*.m4a")) + list(mdir.glob("audio-*.mp3")) + [mdir / "wave.png"]:
                    old.unlink(missing_ok=True)
                ntr = min(len(info.get("audios") or []), MAX_AUDIO_TRACKS)
                aouts = [(k, mdir / f"audio-{k}.part.mp3") for k in range(ntr)]

                def prog(f, sp, eta):
                    db.x("update media set proxy_progress=? where id=?", (round(f, 4), mid))

                rc, err = 1, ""
                for hw in ([True, False] if CAPS["vaapi"]["decode"] and HW_DECODE else [False]):
                    rc, err = run_ff(ff.build_proxy(info, src, tmp, CAPS, hw=hw, audio_outs=aouts), info["duration"], prog, key="proxy:" + mid)
                    if rc == 0:
                        break
                if rc != 0:
                    raise RuntimeError(err.strip()[-400:] or "fallo generando la vista previa")
                for k, p in aouts:
                    if p.exists():
                        p.rename(mdir / f"audio-{k}.mp3")
                tmp.rename(out)
                (mdir / "proxy.ver").write_text(PROXY_VERSION)
                preview = out
                db.x("update media set proxy=?, proxy_status='ready', proxy_progress=1 where id=?", (str(out), mid))
            if (mdir / "audio-0.mp3").exists():
                ff.run(ff.build_wave(mdir / "audio-0.mp3", mdir / "wave.png"), timeout=600)
            r = ff.run(ff.build_thumbs(preview, info["duration"], mdir / "thumbs.jpg"), timeout=600)
            db.x("update media set thumbs=? where id=?", (1 if r.returncode == 0 else 0, mid))
            plan = ff.scrub_plan(info, info["duration"])
            r = ff.run(ff.build_scrub(preview, plan, mdir / "scrub.jpg"), timeout=1200)
            if r.returncode == 0:
                (mdir / "scrub.json").write_text(json.dumps(plan))
            if m["proxy_status"] == "direct":
                (mdir / "proxy.ver").write_text(PROXY_VERSION)
        except Exception as e:
            db.x("update media set proxy_status='error', error=? where id=?", (str(e)[:500], mid))


def set_job(jid, **kw):
    keys = ", ".join(f"{k}=?" for k in kw)
    db.x(f"update jobs set {keys} where id=?", (*kw.values(), jid))


def sanitize(name, fallback="video"):
    name = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", name or "").strip(" .")
    return name[:150] or fallback


def render_worker():
    while True:
        jid = render_q.get()
        j = db.one("select * from jobs where id=?", (jid,))
        if not j or j["status"] != "queued":
            continue
        m = db.one("select * from media where id=?", (j["media_id"],))
        if not m or not Path(m["source"]).exists():
            set_job(jid, status="error", error="El vídeo original ya no existe", finished=time.time())
            continue
        set_job(jid, status="running", started=time.time(), progress=0)
        try:
            do_render(j, m)
        except Exception as e:
            cur = db.one("select status from jobs where id=?", (jid,))
            if not (cur and cur["status"] == "canceled"):
                set_job(jid, status="error", error=str(e)[-800:], finished=time.time())
        drop_quick_media(m["id"])


def drop_quick_media(mid):
    m = db.one("select * from media where id=?", (mid,))
    if not m or m["origin"] != "quick":
        return
    if db.one("select id from jobs where media_id=? and status in ('queued','running')", (mid,)):
        return
    if db.one("select id from projects where media_id=?", (mid,)):
        return
    remove_media(m)


def do_render(j, m):
    jid = j["id"]
    s = json.loads(j["settings"])
    info = json.loads(m["info"])
    src = Path(m["source"])
    out = s.get("output") or {}
    fmt = out.get("format", "h264")
    odir = DATA / "outputs" / jid
    odir.mkdir(parents=True, exist_ok=True)
    work = DATA / "tmp" / jid
    work.mkdir(parents=True, exist_ok=True)
    base = sanitize(j["name"], Path(m["name"]).stem)

    def canceled():
        r = db.one("select status from jobs where id=?", (jid,))
        return r and r["status"] == "canceled"

    try:
        if fmt == "copy":
            cmds, files, ext = ff.build_copy_parts(info, src, s, work)
            total = sum(d for _, d in cmds)
            acc = 0.0
            for c, d in cmds:
                def prog(f, sp, eta, acc=acc, d=d):
                    set_job(jid, progress=round((acc + f * d) / total * 0.95, 4), speed=sp)
                rc, err = run_ff(c, d, prog, key=jid)
                if canceled():
                    return
                if rc != 0:
                    raise RuntimeError(err.strip()[-600:])
                acc += d
            outfile = odir / f"{base}.{ext}"
            if len(files) == 1:
                shutil.move(str(files[0]), outfile)
            else:
                lst = work / "list.txt"
                lst.write_text("".join(f"file '{str(p).replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'\n" for p in files))
                r = ff.run(ff.build_concat(lst, outfile, ext))
                if r.returncode != 0:
                    raise RuntimeError(r.stderr.strip()[-600:])
            finish(jid, outfile, None)
            return

        ext = ff.FORMATS[fmt]["ext"]
        outfile = odir / f"{base}.{ext}"
        cube = None
        if fmt != "mp3":
            cube = LUTS.build(s.get("grade") or {})
        sub = None if fmt == "mp3" else resolve_sub(m, info, s)
        music = resolve_music(m, s)
        enc_probe = None if fmt in ("gif", "mp3") else ff.video_encoder(out, CAPS, out.get("encoder") == "gpu")
        two_pass = out.get("mode") == "size" and enc_probe in ("libx264", "libx265", "libvpx-vp9")
        attempts = []
        want_hw_enc = out.get("encoder") == "gpu"
        want_hw_dec = CAPS["vaapi"]["decode"] and HW_DECODE and out.get("hw_decode", True) and fmt != "mp3"
        attempts.append((want_hw_dec, want_hw_enc))
        if want_hw_dec or want_hw_enc:
            attempts.append((False, False))
        last_err = ""
        for n, (hd, he) in enumerate(attempts):
            passes = [1, 2] if two_pass else [0]
            ok = True
            for pn in passes:
                cmd, total = ff.build_render(info, src, s, CAPS, outfile, str(cube) if cube else None,
                                             hw_dec=hd, hw_enc=he, pass_no=pn, passlog=work / "pass", sub=sub, music=music)
                lo, span = ((0, 0.5) if pn == 1 else (0.5, 0.5)) if two_pass else (0, 1)

                def prog(f, sp, eta, lo=lo, span=span, pn=pn):
                    extra = None
                    if eta is not None and two_pass and pn == 1:
                        extra = eta * 2
                    set_job(jid, progress=round((lo + f * span) * 0.99, 4), speed=sp, eta=extra if extra is not None else eta)

                rc, err = run_ff(cmd, total, prog, key=jid)
                if canceled():
                    return
                if rc != 0:
                    ok = False
                    last_err = err.strip()[-800:]
                    break
            if ok:
                note = None
                if n > 0:
                    note = "La GPU dio un error; se renderizó con CPU."
                finish(jid, outfile, note, total)
                return
            outfile.unlink(missing_ok=True)
        raise RuntimeError(last_err or "ffmpeg falló")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def finish(jid, outfile, note, duration=None):
    size = outfile.stat().st_size
    w = h = None
    try:
        pi = ff.probe(outfile)
        duration = pi["duration"] or duration
        if pi.get("video"):
            w, h = pi["video"]["width"], pi["video"]["height"]
    except Exception:
        pass
    set_job(jid, status="done", progress=1, eta=0, output=str(outfile), size=size, finished=time.time(),
            note=note, duration=duration, width=w, height=h)


def cleanup_worker():
    while True:
        time.sleep(3600)
        for meta in (DATA / "uploads").glob("*.json"):
            if meta.stat().st_mtime < time.time() - 3 * 86400:
                meta.with_suffix(".part").unlink(missing_ok=True)
                meta.unlink(missing_ok=True)
        used = {p["media_id"] for p in db.q("select media_id from projects")}
        for m in db.q("select * from media where created<?", (time.time() - 86400,)):
            if m["id"] not in used:
                remove_media(m)
        for m in db.q("select * from media where proxy_status='uploading' and created<?", (time.time() - 3 * 86400,)):
            for p in db.q("select * from projects where media_id=?", (m["id"],)):
                remove_project(p)
            remove_media(m)
        if RETENTION_DAYS <= 0:
            continue
        limit = time.time() - RETENTION_DAYS * 86400
        busy = {j["project_id"] for j in db.q("select project_id from jobs where status in ('queued','running')")}
        for p in db.q("select * from projects where coalesce(updated,created)<?", (limit,)):
            last = db.one("select max(coalesce(finished,created)) as t from jobs where project_id=?", (p["id"],))
            if p["id"] not in busy and (not last or not last["t"] or last["t"] < limit):
                remove_project(p)
        for j in db.q("select * from jobs where project_id is null and coalesce(finished,created)<?", (limit,)):
            remove_job(j)


def remove_project(p, keep_media=False):
    for j in db.q("select * from jobs where project_id=?", (p["id"],)):
        if j["status"] in ("queued", "running"):
            set_job(j["id"], status="canceled", finished=time.time())
            proc = running.get(j["id"])
            if proc:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except OSError:
                    pass
        remove_job(j)
    db.x("delete from projects where id=?", (p["id"],))
    if not keep_media and not db.one("select id from projects where media_id=?", (p["media_id"],)):
        m = db.one("select * from media where id=?", (p["media_id"],))
        if m:
            proc = running.get("proxy:" + m["id"])
            if proc:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except OSError:
                    pass
            remove_media(m)


def remove_media(m):
    shutil.rmtree(DATA / "media" / m["id"], ignore_errors=True)
    db.x("delete from media where id=?", (m["id"],))


def remove_job(j):
    shutil.rmtree(DATA / "outputs" / j["id"], ignore_errors=True)
    db.x("delete from jobs where id=?", (j["id"],))


for m in db.q("select * from media where coalesce(origin,'')!='quick' and id not in (select media_id from projects where media_id is not null)"):
    pid = uuid.uuid4().hex[:12]
    t = time.time()
    db.x("insert into projects(id,name,media_id,state,created,updated) values(?,?,?,?,?,?)",
         (pid, Path(m["name"]).stem, m["id"], None, m["created"] or t, m["created"] or t))
    db.x("update jobs set project_id=? where media_id=? and project_id is null", (pid, m["id"]))
for m in db.q("select id, proxy_status, info from media where proxy_status in ('ready','direct')"):
    ver = DATA / "media" / m["id"] / "proxy.ver"
    old = ver.read_text().strip() if ver.exists() else ""
    if old == PROXY_VERSION:
        continue
    if old in ("8", "9", "10") and m["proxy_status"] == "ready" and not (json.loads(m["info"] or "{}").get("audio")):
        ver.write_text(PROXY_VERSION)
        continue
    db.x("update media set proxy_status='pending', proxy_progress=0 where id=?", (m["id"],))
for m in db.q("select id from media where proxy_status in ('pending','running')"):
    db.x("update media set proxy_status='pending' where id=?", (m["id"],))
    proxy_q.put(m["id"])
for j in db.q("select id from jobs where status in ('queued','running') order by created"):
    db.x("update jobs set status='queued', progress=0 where id=?", (j["id"],))
    render_q.put(j["id"])
for fn in (proxy_worker, render_worker, cleanup_worker):
    threading.Thread(target=fn, daemon=True).start()

app = FastAPI(docs_url=None, redoc_url=None)


@app.middleware("http")
async def auth(request: Request, call_next):
    p = request.url.path
    if PASSWORD and p.startswith("/api/") and p not in ("/api/login", "/api/me"):
        if not hmac.compare_digest(request.cookies.get("vt", ""), TOKEN):
            return JSONResponse({"detail": "No autorizado"}, status_code=401)
    resp = await call_next(request)
    if not p.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/api/me")
def me(request: Request):
    ok = not PASSWORD or hmac.compare_digest(request.cookies.get("vt", ""), TOKEN)
    return {"auth_required": bool(PASSWORD), "authenticated": ok}


@app.post("/api/login")
async def login(request: Request):
    body = await request.json()
    if not PASSWORD or hmac.compare_digest(str(body.get("password", "")), PASSWORD):
        r = JSONResponse({"ok": True})
        r.set_cookie("vt", TOKEN, max_age=60 * 60 * 24 * 60, httponly=True, samesite="lax")
        return r
    time.sleep(1)
    raise HTTPException(401, "Contraseña incorrecta")


@app.post("/api/logout")
def logout():
    r = JSONResponse({"ok": True})
    r.delete_cookie("vt")
    return r


@app.get("/api/config")
def config():
    formats = []
    for k, v in ff.FORMATS.items():
        avail = True
        if k in ("h264", "mkv"):
            avail = CAPS["encoders"]["libx264"]
        elif k == "h265":
            avail = CAPS["encoders"]["libx265"]
        elif k == "av1":
            avail = CAPS["encoders"]["libsvtav1"]
        elif k == "vp9":
            avail = CAPS["encoders"]["libvpx-vp9"]
        elif k == "mp3":
            avail = CAPS["encoders"]["libmp3lame"]
        if avail:
            formats.append({"id": k, "label": v["label"], "ext": v["ext"]})
    return {"formats": formats, "gpu": CAPS["vaapi"], "hdr_tonemap": CAPS["zscale"], "library": list(ROOTS.keys()),
            "max_upload": MAX_UPLOAD, "retention_days": RETENTION_DAYS}


def provisional_info(local, size):
    def num(k, d=0.0):
        try:
            v = float(local.get(k) or d)
            return v if v == v and 0 <= v < 1e7 else d
        except (TypeError, ValueError):
            return d
    dur = num("duration")
    w, h = int(num("width")), int(num("height"))
    if dur <= 0 or w <= 0 or h <= 0:
        return None
    has_audio = bool(local.get("audio"))
    return {"duration": dur, "size": size, "container": "", "bitrate": 0, "provisional": True,
            "video": {"codec": "", "width": w, "height": h, "coded_width": w, "coded_height": h, "rotation": 0,
                      "fps": num("fps", 30) or 30, "pix_fmt": "", "bits": 8, "transfer": None, "primaries": None,
                      "matrix": None, "hdr": False, "bitrate": 0},
            "audio": {"codec": "", "channels": 2, "rate": 0, "bitrate": 0} if has_audio else None,
            "audios": [{"index": 0, "codec": "", "channels": 2, "lang": None, "title": None, "default": True}] if has_audio else [],
            "subtitles": []}


def create_media(name, source, origin, mid=None, existing=False, quick=False):
    info = ff.probe(source)
    if not info.get("video"):
        raise ValueError("El archivo no contiene vídeo")
    if existing:
        db.x("update media set source=?, info=?, proxy_status='pending', proxy_progress=0, error=null where id=?",
             (str(source), json.dumps(info), mid))
        (DATA / "media" / mid / "upload.json").unlink(missing_ok=True)
        proxy_q.put(mid)
        return mid
    mid = mid or uuid.uuid4().hex[:12]
    (DATA / "media" / mid).mkdir(parents=True, exist_ok=True)
    status = "quick" if quick else "pending"
    db.x("insert into media(id,name,source,origin,info,proxy_status,proxy_progress,created) values(?,?,?,?,?,?,?,?)",
         (mid, name, str(source), "quick" if quick else origin, json.dumps(info), status, 0, time.time()))
    if not quick:
        proxy_q.put(mid)
    return mid


@app.post("/api/uploads")
async def upload_init(request: Request):
    b = await request.json()
    size = int(b.get("size", 0))
    if size <= 0 or size > MAX_UPLOAD:
        raise HTTPException(400, "Tamaño de archivo no permitido")
    name = sanitize(Path(str(b.get("name", "video"))).name)
    if Path(name).suffix.lower() not in VIDEO_EXT:
        raise HTTPException(400, "Formato no soportado")
    uid = uuid.uuid4().hex
    meta = {"name": name, "size": size, "t": time.time(), "quick": bool(b.get("quick"))}
    out = {"id": uid, "offset": 0}
    info = provisional_info(b.get("local") or {}, size) if isinstance(b.get("local"), dict) and not meta["quick"] else None
    if info:
        mid = uuid.uuid4().hex[:12]
        mdir = DATA / "media" / mid
        mdir.mkdir(parents=True, exist_ok=True)
        (mdir / "upload.json").write_text(json.dumps({"uid": uid}))
        t = time.time()
        db.x("insert into media(id,name,source,origin,info,proxy_status,proxy_progress,created) values(?,?,?,?,?,?,?,?)",
             (mid, name, str(mdir / ("source" + Path(name).suffix.lower())), "upload", json.dumps(info), "uploading", 0, t))
        pid = uuid.uuid4().hex[:12]
        db.x("insert into projects(id,name,media_id,state,created,updated) values(?,?,?,?,?,?)", (pid, Path(name).stem[:120], mid, None, t, t))
        meta["mid"] = mid
        meta["pid"] = pid
        out.update({"media_id": mid, "project_id": pid})
    (DATA / "uploads" / f"{uid}.json").write_text(json.dumps(meta))
    (DATA / "uploads" / f"{uid}.part").touch()
    return out


def _upload(uid):
    if not re.fullmatch(r"[0-9a-f]{32}", uid):
        raise HTTPException(404, "Subida no encontrada")
    meta = DATA / "uploads" / f"{uid}.json"
    part = DATA / "uploads" / f"{uid}.part"
    if not meta.exists() or not part.exists():
        raise HTTPException(404, "Subida no encontrada")
    return json.loads(meta.read_text()), part


@app.get("/api/uploads/{uid}")
def upload_status(uid: str):
    meta, part = _upload(uid)
    return {"id": uid, "offset": part.stat().st_size, "size": meta["size"]}


@app.put("/api/uploads/{uid}")
async def upload_chunk(uid: str, offset: int, request: Request):
    meta, part = _upload(uid)
    cur = part.stat().st_size
    if offset != cur:
        return JSONResponse({"offset": cur}, status_code=409)
    data = await request.body()
    if cur + len(data) > meta["size"]:
        raise HTTPException(400, "Datos de más")

    def w():
        with open(part, "ab") as f:
            f.write(data)
    await run_in_threadpool(w)
    return {"offset": cur + len(data)}


@app.post("/api/uploads/{uid}/complete")
def upload_complete(uid: str):
    meta, part = _upload(uid)
    if part.stat().st_size != meta["size"]:
        raise HTTPException(400, "La subida no está completa")
    if meta.get("mid"):
        mid = meta["mid"]
        m = db.one("select * from media where id=?", (mid,))
        if not m:
            raise HTTPException(404, "El proyecto de esta subida ya no existe")
        dest = DATA / "media" / mid / ("source" + Path(meta["name"]).suffix.lower())
        shutil.move(str(part), dest)
        (DATA / "uploads" / f"{uid}.json").unlink(missing_ok=True)
        try:
            create_media(meta["name"], dest, "upload", mid=mid, existing=True)
        except Exception as e:
            db.x("update media set proxy_status='error', error=? where id=?", (str(e)[:500], mid))
            raise HTTPException(400, str(e))
        return media_out(db.one("select * from media where id=?", (mid,)))
    mid = uuid.uuid4().hex[:12]
    mdir = DATA / "media" / mid
    mdir.mkdir(parents=True, exist_ok=True)
    dest = mdir / ("source" + Path(meta["name"]).suffix.lower())
    shutil.move(str(part), dest)
    (DATA / "uploads" / f"{uid}.json").unlink(missing_ok=True)
    try:
        create_media(meta["name"], dest, "upload", mid=mid, quick=bool(meta.get("quick")))
    except Exception as e:
        shutil.rmtree(mdir, ignore_errors=True)
        raise HTTPException(400, str(e))
    return media_out(db.one("select * from media where id=?", (mid,)))


@app.delete("/api/uploads/{uid}")
def upload_abort(uid: str):
    meta, _ = _upload(uid)
    if meta.get("pid"):
        p = db.one("select * from projects where id=?", (meta["pid"],))
        if p:
            remove_project(p)
    (DATA / "uploads" / f"{uid}.json").unlink(missing_ok=True)
    (DATA / "uploads" / f"{uid}.part").unlink(missing_ok=True)
    return {"ok": True}


def _lib_path(root, rel):
    if root not in ROOTS:
        raise HTTPException(404, "Carpeta no encontrada")
    base = ROOTS[root]
    p = (base / (rel or "")).resolve()
    if p != base and base not in p.parents:
        raise HTTPException(400, "Ruta no válida")
    return base, p


@app.get("/api/library")
def library(root: str, path: str = ""):
    base, p = _lib_path(root, path)
    if not p.is_dir():
        raise HTTPException(404, "Carpeta no encontrada")
    dirs, files = [], []
    try:
        for e in os.scandir(p):
            if e.name.startswith("."):
                continue
            try:
                if e.is_dir():
                    dirs.append({"name": e.name})
                elif e.is_file() and Path(e.name).suffix.lower() in VIDEO_EXT:
                    st = e.stat()
                    files.append({"name": e.name, "size": st.st_size, "mtime": st.st_mtime})
            except OSError:
                pass
    except PermissionError:
        raise HTTPException(403, "Sin permiso para leer esta carpeta")
    dirs.sort(key=lambda d: d["name"].lower())
    files.sort(key=lambda f: f["name"].lower())
    return {"root": root, "path": str(p.relative_to(base)) if p != base else "", "dirs": dirs, "files": files}


@app.post("/api/library/import")
async def library_import(request: Request):
    b = await request.json()
    base, p = _lib_path(b.get("root"), b.get("path"))
    if not p.is_file():
        raise HTTPException(404, "Archivo no encontrado")
    ex = db.one("select * from media where source=?", (str(p),))
    if ex:
        return media_out(ex)
    try:
        mid = await run_in_threadpool(create_media, p.name, p, "library")
    except Exception as e:
        raise HTTPException(400, str(e))
    return media_out(db.one("select * from media where id=?", (mid,)))


@app.get("/api/media")
def media_list():
    used = {}
    for p in db.q("select media_id from projects"):
        used[p["media_id"]] = used.get(p["media_id"], 0) + 1
    out = []
    for m in db.q("select * from media where coalesce(origin,'')!='quick' order by created desc"):
        x = media_out(m)
        x["projects"] = used.get(m["id"], 0)
        out.append(x)
    return out


def _media(mid):
    m = db.one("select * from media where id=?", (mid,))
    if not m:
        raise HTTPException(404, "Vídeo no encontrado")
    return m


@app.get("/api/media/{mid}")
def media_get(mid: str):
    return media_out(_media(mid))


@app.delete("/api/media/{mid}")
def media_delete(mid: str):
    m = _media(mid)
    if db.one("select id from projects where media_id=?", (mid,)):
        raise HTTPException(400, "Este vídeo lo usa algún proyecto; borra antes el proyecto")
    p = running.get("proxy:" + mid)
    if p:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
    remove_media(m)
    return {"ok": True}


@app.get("/api/media/{mid}/preview")
def media_preview(mid: str, v: int = 0):
    m = _media(mid)
    if m["proxy_status"] == "direct":
        path, mt = m["source"], ("video/mp4" if Path(m["source"]).suffix.lower() != ".webm" else "video/webm")
    elif m["proxy_status"] == "ready" and m["proxy"] and Path(m["proxy"]).exists():
        path, mt = m["proxy"], "video/mp4"
    else:
        raise HTTPException(409, "La vista previa aún no está lista")
    cur = int(os.stat(path).st_mtime)
    if v and v != cur:
        raise HTTPException(410, "La vista previa ha cambiado")
    headers = {"Cache-Control": "private, max-age=31536000, immutable"} if v else {"Cache-Control": "no-store"}
    return FileResponse(path, media_type=mt, headers=headers)


@app.get("/api/media/{mid}/audio/{k}")
def media_audio(mid: str, k: int):
    _media(mid)
    p = DATA / "media" / mid / f"audio-{int(k)}.mp3"
    if not p.exists():
        raise HTTPException(404, "Sin audio de vista previa")
    return FileResponse(p, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/media/{mid}/wave.png")
def media_wave(mid: str):
    p = DATA / "media" / mid / "wave.png"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


@app.post("/api/media/{mid}/music")
async def music_upload(mid: str, file: UploadFile = File(...)):
    _media(mid)
    name = sanitize(Path(file.filename or "audio.mp3").name, "audio")
    ext = Path(name).suffix.lower()
    if ext not in MUSIC_EXT:
        raise HTTPException(400, "Usa un archivo de audio: mp3, wav, m4a, aac, flac, ogg, opus…")
    adir = DATA / "media" / mid / "music"
    adir.mkdir(parents=True, exist_ok=True)
    aid = uuid.uuid4().hex[:8]
    path = adir / f"{aid}{ext}"
    size = 0
    with open(path, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > 500 * 1024 * 1024:
                f.close()
                path.unlink(missing_ok=True)
                raise HTTPException(400, "Archivo de audio demasiado grande")
            f.write(chunk)

    def work():
        info = ff.probe(path)
        if not info.get("audio"):
            raise ValueError("Ese archivo no tiene audio")
        r = ff.run(ff.build_audio_preview(path, adir / f"{aid}.prev.mp3"), timeout=900)
        if r.returncode != 0:
            raise ValueError("No se pudo leer el audio")
        return info

    try:
        info = await run_in_threadpool(work)
    except Exception as e:
        path.unlink(missing_ok=True)
        (adir / f"{aid}.prev.mp3").unlink(missing_ok=True)
        raise HTTPException(400, str(e) if isinstance(e, ValueError) else "No se pudo leer el audio")
    item = {"id": aid, "name": name, "ext": ext, "duration": info["duration"]}
    items = music_items(mid) + [item]
    (DATA / "media" / mid / "music.json").write_text(json.dumps(items))
    return {"item": item, "items": items}


@app.delete("/api/media/{mid}/music/{aid}")
def music_delete(mid: str, aid: str):
    _media(mid)
    items = music_items(mid)
    for x in items:
        if x["id"] == aid:
            (DATA / "media" / mid / "music" / f"{aid}{x['ext']}").unlink(missing_ok=True)
            (DATA / "media" / mid / "music" / f"{aid}.prev.m4a").unlink(missing_ok=True)
            (DATA / "media" / mid / "music" / f"{aid}.prev.mp3").unlink(missing_ok=True)
    items = [x for x in items if x["id"] != aid]
    (DATA / "media" / mid / "music.json").write_text(json.dumps(items))
    return items


@app.get("/api/media/{mid}/music/{aid}/preview")
async def music_preview(mid: str, aid: str):
    _media(mid)
    if not re.fullmatch(r"[0-9a-f]{8}", aid):
        raise HTTPException(404)
    p = DATA / "media" / mid / "music" / f"{aid}.prev.mp3"
    if not p.exists():
        item = next((x for x in music_items(mid) if x["id"] == aid), None)
        src = DATA / "media" / mid / "music" / f"{aid}{item['ext']}" if item else None
        if not src or not src.exists():
            raise HTTPException(404, "Audio no encontrado")
        r = await run_in_threadpool(ff.run, ff.build_audio_preview(src, p), 900)
        if r.returncode != 0 or not p.exists():
            raise HTTPException(500, "No se pudo preparar el audio")
        (DATA / "media" / mid / "music" / f"{aid}.prev.m4a").unlink(missing_ok=True)
    return FileResponse(p, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/media/{mid}/scrub.jpg")
def media_scrub(mid: str):
    p = DATA / "media" / mid / "scrub.jpg"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/media/{mid}/thumbs")
def media_thumbs(mid: str):
    p = DATA / "media" / mid / "thumbs.jpg"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


@app.get("/api/media/{mid}/source")
def media_source(mid: str):
    m = _media(mid)
    return FileResponse(m["source"], filename=m["name"])


@app.post("/api/media/{mid}/frame")
async def media_frame(mid: str, request: Request):
    b = await request.json()
    m = _media(mid)
    if m["proxy_status"] == "uploading":
        raise HTTPException(409, "Disponible cuando termine la subida")
    info = json.loads(m["info"])
    s = b.get("settings") or {}
    graded = bool(b.get("graded", True))

    def work():
        cube = LUTS.build(s.get("grade") or {}) if graded else None
        sub = resolve_sub(m, info, s) if graded else None
        if sub and sub["mode"] != "burn":
            sub = None
        cmd = ff.build_frame(info, safe_src(m) if sub else m["source"], float(b.get("t", 0)), s, CAPS, str(cube) if cube else None, graded, sub)
        return subprocess.run(cmd, capture_output=True, timeout=120)

    try:
        r = await run_in_threadpool(work)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if r.returncode != 0 or not r.stdout:
        raise HTTPException(500, r.stderr.decode(errors="replace")[-400:] or "No se pudo extraer el fotograma")
    return Response(r.stdout, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.post("/api/media/{mid}/estimate")
async def media_estimate(mid: str, request: Request):
    s = await request.json()
    m = _media(mid)
    info = json.loads(m["info"])
    try:
        segs = ff.segments(info, s)
        g = ff.geometry(info, s)
        return {"duration": ff.out_duration(segs), "width": g["w"], "height": g["h"], "fps": g["fps"],
                "size": ff.estimate_size(info, s)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/media/{mid}/subs")
async def subs_upload(mid: str, file: UploadFile = File(...)):
    _media(mid)
    name = Path(file.filename or "subs.srt").name
    ext = Path(name).suffix.lower()
    if ext not in SUB_EXT:
        raise HTTPException(400, "Usa un archivo .srt, .ass, .ssa o .vtt")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(400, "Archivo de subtítulos demasiado grande")
    sdir = DATA / "media" / mid / "subs"
    sdir.mkdir(parents=True, exist_ok=True)
    sid = uuid.uuid4().hex[:8]
    path = sdir / f"{sid}{ext}"
    path.write_bytes(data)
    r = ff.run(["ffprobe", "-v", "error", "-select_streams", "s", "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(path)], timeout=30)
    if r.returncode != 0 or not r.stdout.strip():
        path.unlink(missing_ok=True)
        raise HTTPException(400, "No parece un archivo de subtítulos válido")
    items = ext_subs(mid) + [{"id": sid, "name": name, "ext": ext}]
    (DATA / "media" / mid / "subs.json").write_text(json.dumps(items))
    return {"id": sid, "items": items}


@app.delete("/api/media/{mid}/subs/{sid}")
def subs_delete(mid: str, sid: str):
    _media(mid)
    items = [x for x in ext_subs(mid) if x["id"] != sid]
    for x in ext_subs(mid):
        if x["id"] == sid:
            (DATA / "media" / mid / "subs" / f"{sid}{x['ext']}").unlink(missing_ok=True)
            (DATA / "media" / mid / f"vtt-x{sid}.vtt").unlink(missing_ok=True)
    (DATA / "media" / mid / "subs.json").write_text(json.dumps(items))
    return items


@app.get("/api/media/{mid}/vtt/{key}")
async def subs_vtt(mid: str, key: str):
    m = _media(mid)
    info = json.loads(m["info"])
    try:
        sub = resolve_sub(m, info, {"subs": {"key": key}})
    except ValueError as e:
        raise HTTPException(404, str(e))
    if not sub or sub["image"]:
        raise HTTPException(404, "Sin vista previa para estos subtítulos")
    out = DATA / "media" / mid / f"vtt-{re.sub(r'[^a-z0-9]', '', key)}.vtt"
    if not out.exists():
        tmp = out.with_suffix(".tmp")
        r = await run_in_threadpool(ff.run, ff.build_vtt(sub["path"], sub["si"], tmp), 600)
        if r.returncode != 0 or not tmp.exists():
            tmp.unlink(missing_ok=True)
            raise HTTPException(500, "No se pudieron convertir los subtítulos")
        tmp.rename(out)
    return FileResponse(out, media_type="text/vtt")


def project_out(p, full=False):
    p = dict(p)
    p["state"] = json.loads(p["state"]) if (full and p.get("state")) else None
    m = db.one("select * from media where id=?", (p["media_id"],))
    p["media"] = media_out(m) if m else None
    c = db.one("select count(*) as n, sum(case when status in ('queued','running') then 1 else 0 end) as act from jobs where project_id=?", (p["id"],))
    p["renders"] = c["n"] or 0
    p["active"] = c["act"] or 0
    return p


def _project(pid):
    p = db.one("select * from projects where id=?", (pid,))
    if not p:
        raise HTTPException(404, "Proyecto no encontrado")
    return p


@app.get("/api/projects")
def projects_list():
    return [project_out(p) for p in db.q("select * from projects order by updated desc")]


@app.post("/api/projects")
async def project_create(request: Request):
    b = await request.json()
    m = _media(b.get("media_id", ""))
    pid = uuid.uuid4().hex[:12]
    t = time.time()
    name = (str(b.get("name") or "").strip() or Path(m["name"]).stem)[:120]
    db.x("insert into projects(id,name,media_id,state,created,updated) values(?,?,?,?,?,?)", (pid, name, m["id"], None, t, t))
    return project_out(_project(pid), True)


@app.get("/api/projects/{pid}")
def project_get(pid: str):
    return project_out(_project(pid), True)


@app.put("/api/projects/{pid}")
async def project_update(pid: str, request: Request):
    _project(pid)
    b = await request.json()
    if "name" in b:
        name = str(b.get("name") or "").strip()[:120]
        if name:
            db.x("update projects set name=? where id=?", (name, pid))
    if "state" in b:
        st = json.dumps(b.get("state"))
        if len(st) > 2_000_000:
            raise HTTPException(400, "Estado demasiado grande")
        db.x("update projects set state=? where id=?", (st, pid))
    db.x("update projects set updated=? where id=?", (time.time(), pid))
    return {"ok": True, "updated": time.time()}


@app.delete("/api/projects/{pid}")
def project_delete(pid: str):
    remove_project(_project(pid))
    return {"ok": True}


@app.post("/api/grade/lut3d")
async def grade_lut3d(request: Request):
    b = await request.json()
    try:
        c = await asyncio.to_thread(LUTS.grid, b.get("grade") or {})
    except ValueError as e:
        raise HTTPException(400, str(e))
    return Response(content=c.tobytes(), media_type="application/octet-stream", headers={"X-Lut-Size": str(c.shape[0]), "Cache-Control": "no-store"})


@app.get("/api/luts")
def luts_list():
    return LUTS.list()


@app.post("/api/luts")
async def luts_upload(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(400, "LUT demasiado grande")
    try:
        lid = LUTS.save_user(file.filename or "lut.cube", data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": lid, "items": LUTS.list()}


@app.delete("/api/luts")
def luts_delete(id: str):
    try:
        LUTS.delete_user(id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return LUTS.list()


@app.post("/api/jobs")
async def job_create(request: Request):
    b = await request.json()
    m = _media(b.get("media_id", ""))
    if m["proxy_status"] == "uploading":
        raise HTTPException(400, "Espera a que termine de subirse el vídeo")
    s = b.get("settings") or {}
    info = json.loads(m["info"])
    fmt = (s.get("output") or {}).get("format", "h264")
    if fmt not in ff.FORMATS:
        raise HTTPException(400, "Formato desconocido")
    try:
        segs = ff.segments(info, s)
        if fmt == "copy" and any(abs(x["speed"] - 1) > 1e-6 for x in segs):
            raise ValueError("«Sin recodificar» no admite cambios de velocidad")
        music = resolve_music(m, s)
        if fmt == "copy" and (music or any(abs(x["vol"] - 1) > 1e-3 for x in segs) or any(abs(v - 1) > 1e-3 for _, _, v in ff.aregions(info, s))):
            raise ValueError("«Sin recodificar» no admite cambios de audio (volumen por tramo o pista añadida)")
        if fmt == "mp3" and not info.get("audio") and not music:
            raise ValueError("Este vídeo no tiene audio")
        if fmt not in ("mp3", "copy"):
            sub = resolve_sub(m, info, s)
            if sub and sub["mode"] == "soft":
                ok, why = ff.soft_sub_ok(fmt, segs, sub)
                if not ok:
                    raise ValueError(why)
        g = ff.geometry(info, s)
    except ValueError as e:
        raise HTTPException(400, str(e))
    pid = b.get("project_id")
    if pid:
        pr = _project(pid)
        if pr["media_id"] != m["id"]:
            raise HTTPException(400, "El proyecto no corresponde a este vídeo")
        db.x("update projects set updated=? where id=?", (time.time(), pid))
    jid = uuid.uuid4().hex[:12]
    name = sanitize(b.get("name") or "", Path(m["name"]).stem)
    db.x("insert into jobs(id,media_id,media_name,name,settings,status,created,duration,width,height,project_id) values(?,?,?,?,?,?,?,?,?,?,?)",
         (jid, m["id"], m["name"], name, json.dumps(s), "queued", time.time(), ff.out_duration(segs),
          None if fmt == "mp3" else g["w"], None if fmt == "mp3" else g["h"], pid))
    render_q.put(jid)
    return job_out(db.one("select * from jobs where id=?", (jid,)))


@app.get("/api/jobs")
def jobs_list(project: str = "", quick: int = 0):
    if quick:
        return [job_out(j) for j in db.q("select * from jobs where project_id is null order by created desc limit 50")]
    if project:
        return [job_out(j) for j in db.q("select * from jobs where project_id=? order by created desc limit 200", (project,))]
    return [job_out(j) for j in db.q("select * from jobs order by created desc limit 200")]


@app.post("/api/jobs/{jid}/cancel")
def job_cancel(jid: str):
    j = db.one("select * from jobs where id=?", (jid,))
    if not j:
        raise HTTPException(404)
    if j["status"] in ("queued", "running"):
        set_job(jid, status="canceled", finished=time.time())
        p = running.get(jid)
        if p:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except OSError:
                pass
        if j["status"] == "queued":
            drop_quick_media(j["media_id"])
    return job_out(db.one("select * from jobs where id=?", (jid,)))


@app.delete("/api/jobs/{jid}")
def job_delete(jid: str):
    j = db.one("select * from jobs where id=?", (jid,))
    if not j:
        raise HTTPException(404)
    if j["status"] in ("queued", "running"):
        job_cancel(jid)
    remove_job(j)
    return {"ok": True}


@app.get("/api/jobs/{jid}/file")
def job_file(jid: str, dl: int = 0):
    j = db.one("select * from jobs where id=?", (jid,))
    if not j or not j["output"] or not Path(j["output"]).exists():
        raise HTTPException(404, "Archivo no disponible")
    p = Path(j["output"])
    if dl:
        return FileResponse(p, filename=p.name)
    return FileResponse(p)


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
