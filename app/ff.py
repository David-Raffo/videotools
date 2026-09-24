import json
import os
import subprocess
from fractions import Fraction
from pathlib import Path

VAAPI_DEVICE = os.environ.get("VAAPI_DEVICE", "/dev/dri/renderD128")
HDR_TRC = {"smpte2084", "arib-std-b67"}
BROWSER_AUDIO = {None, "aac", "mp3", "opus", "vorbis"}
TEXT_SUBS = {"ass", "ssa", "subrip", "srt", "mov_text", "webvtt", "text"}
IMAGE_SUBS = {"hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub"}
FONTS_DIR = os.environ.get("FONTS_DIR", "/data/fonts")

FORMATS = {
    "h264": {"ext": "mp4", "label": "MP4 · H.264"},
    "h265": {"ext": "mp4", "label": "MP4 · H.265"},
    "av1": {"ext": "mp4", "label": "MP4 · AV1"},
    "vp9": {"ext": "webm", "label": "WebM · VP9"},
    "mkv": {"ext": "mkv", "label": "MKV · H.264"},
    "gif": {"ext": "gif", "label": "GIF"},
    "mp3": {"ext": "mp3", "label": "MP3"},
    "copy": {"ext": None, "label": "Sin recodificar"},
}

PRESETS = {
    "libx264": {"fast": "veryfast", "medium": "medium", "slow": "slow"},
    "libx265": {"fast": "veryfast", "medium": "medium", "slow": "slow"},
    "libvpx-vp9": {"fast": "5", "medium": "3", "slow": "1"},
    "libsvtav1": {"fast": "10", "medium": "7", "slow": "4"},
}


def run(cmd, timeout=None):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def detect_caps():
    enc = run(["ffmpeg", "-hide_banner", "-encoders"]).stdout
    flt = run(["ffmpeg", "-hide_banner", "-filters"]).stdout
    caps = {
        "encoders": {e: (f" {e} " in enc) for e in ["libx264", "libx265", "libvpx-vp9", "libsvtav1", "libopus", "libmp3lame"]},
        "zscale": " zscale " in flt,
        "vaapi": {"h264": False, "hevc": False, "decode": False},
    }
    if os.path.exists(VAAPI_DEVICE):
        for key, codec in [("h264", "h264_vaapi"), ("hevc", "hevc_vaapi")]:
            r = run(["ffmpeg", "-hide_banner", "-v", "error", "-init_hw_device", f"vaapi=va:{VAAPI_DEVICE}", "-filter_hw_device", "va",
                     "-f", "lavfi", "-i", "testsrc2=d=0.2:s=640x360:r=30", "-vf", "format=nv12,hwupload", "-c:v", codec, "-f", "null", "-"], timeout=30)
            caps["vaapi"][key] = r.returncode == 0
        caps["vaapi"]["decode"] = caps["vaapi"]["h264"] or caps["vaapi"]["hevc"]
    return caps


def _fps(s):
    for k in ("avg_frame_rate", "r_frame_rate"):
        v = s.get(k)
        if v and v != "0/0":
            try:
                f = float(Fraction(v))
                if 0 < f < 1000:
                    return f
            except (ValueError, ZeroDivisionError):
                pass
    return 30.0


def _rotation(s):
    for sd in s.get("side_data_list", []) or []:
        if "rotation" in sd:
            try:
                return int(float(sd["rotation"]))
            except ValueError:
                pass
    r = (s.get("tags") or {}).get("rotate")
    return int(r) if r and r.lstrip("-").isdigit() else 0


def probe(path):
    r = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)], timeout=60)
    if r.returncode != 0:
        raise ValueError("No se pudo leer el archivo: " + r.stderr.strip()[-300:])
    d = json.loads(r.stdout)
    vs = [s for s in d.get("streams", []) if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")]
    as_ = [s for s in d.get("streams", []) if s.get("codec_type") == "audio"]
    ss = [s for s in d.get("streams", []) if s.get("codec_type") == "subtitle"]
    fmt = d.get("format", {})
    dur = float(fmt.get("duration") or 0)
    info = {"duration": dur, "size": int(fmt.get("size") or os.path.getsize(path)), "container": fmt.get("format_name", ""),
            "bitrate": int(fmt.get("bit_rate") or 0), "video": None, "audio": None, "audios": [], "subtitles": []}
    if vs:
        v = vs[0]
        w, h = int(v.get("width") or 0), int(v.get("height") or 0)
        rot = _rotation(v)
        dw, dh = (h, w) if abs(rot) % 180 == 90 else (w, h)
        pix = v.get("pix_fmt") or ""
        bits = 10 if ("10" in pix or "12" in pix) else 8
        if not dur:
            dur = float(v.get("duration") or 0)
            info["duration"] = dur
        info["video"] = {"codec": v.get("codec_name"), "width": dw, "height": dh, "coded_width": w, "coded_height": h, "rotation": rot,
                         "fps": round(_fps(v), 3), "pix_fmt": pix, "bits": bits, "transfer": v.get("color_transfer"),
                         "primaries": v.get("color_primaries"), "matrix": v.get("color_space"),
                         "hdr": v.get("color_transfer") in HDR_TRC, "bitrate": int(v.get("bit_rate") or 0)}
    if as_:
        a = as_[0]
        info["audio"] = {"codec": a.get("codec_name"), "channels": a.get("channels"), "rate": int(a.get("sample_rate") or 0),
                         "bitrate": int(a.get("bit_rate") or 0)}
    for k, a in enumerate(as_):
        t = a.get("tags") or {}
        info["audios"].append({"index": k, "codec": a.get("codec_name"), "channels": a.get("channels"),
                               "lang": t.get("language"), "title": t.get("title"),
                               "default": bool((a.get("disposition") or {}).get("default"))})
    for k, x in enumerate(ss):
        t = x.get("tags") or {}
        c = x.get("codec_name")
        info["subtitles"].append({"index": k, "codec": c, "lang": t.get("language"), "title": t.get("title"),
                                  "text": c in TEXT_SUBS, "image": c in IMAGE_SUBS,
                                  "default": bool((x.get("disposition") or {}).get("default")),
                                  "forced": bool((x.get("disposition") or {}).get("forced"))})
    return info


def browser_playable(info, path):
    v = info.get("video")
    if not v:
        return False
    ext = Path(path).suffix.lower()
    a = info.get("audio")
    acodec = a["codec"] if a else None
    if acodec not in BROWSER_AUDIO:
        return False
    if v["hdr"] or v["bits"] != 8 or min(v["width"], v["height"]) > 1080:
        return False
    if v["codec"] == "h264" and ext in {".mp4", ".m4v", ".mov"} and v["pix_fmt"] in {"yuv420p", "yuvj420p"}:
        return True
    if v["codec"] in {"vp9", "vp8", "av1"} and ext in {".webm", ".mp4"}:
        return True
    return False


def even(x):
    return max(2, int(round(x / 2.0)) * 2)


def tonemap_chain():
    return ["zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=hable:desat=0",
            "zscale=t=bt709:m=bt709:r=tv", "format=yuv420p10le"]


def geometry(info, s):
    v = info["video"]
    W, H = v["width"], v["height"]
    crop = s.get("crop") or {}
    cw, ch, cx, cy = W, H, 0, 0
    if crop.get("enabled"):
        nx = min(max(float(crop.get("x", 0)), 0), 1)
        ny = min(max(float(crop.get("y", 0)), 0), 1)
        nw = min(max(float(crop.get("w", 1)), 0.02), 1 - nx)
        nh = min(max(float(crop.get("h", 1)), 0.02), 1 - ny)
        cw, ch = even(nw * W), even(nh * H)
        cw, ch = min(cw, W - W % 2), min(ch, H - H % 2)
        cx = max(0, min(int(nx * W) // 2 * 2, W - cw))
        cy = max(0, min(int(ny * H) // 2 * 2, H - ch))
    rot = int(s.get("rotate", 0)) % 360
    rw, rh = (ch, cw) if rot in (90, 270) else (cw, ch)
    out = s.get("output") or {}
    target = int(out.get("height") or 0)
    ow, oh = rw, rh
    if target and target < min(rw, rh):
        k = target / min(rw, rh)
        ow, oh = even(rw * k), even(rh * k)
    else:
        ow, oh = rw - rw % 2, rh - rh % 2
    fps = float(out.get("fps") or 0) or v["fps"]
    if out.get("format") == "gif":
        fps = min(fps, float(out.get("fps") or 15))
    return {"crop": (cw, ch, cx, cy), "crop_on": bool(crop.get("enabled")) and (cw, ch) != (W, H), "rot": rot,
            "rw": rw, "rh": rh, "w": ow, "h": oh, "fps": round(fps, 3), "scaled": (ow, oh) != (rw - rw % 2, rh - rh % 2)}


def segments(info, s):
    dur = info["duration"]
    out = []
    for seg in s.get("segments") or [{"start": 0, "end": dur, "speed": 1}]:
        a = max(0.0, float(seg.get("start", 0)))
        b = min(dur, float(seg.get("end", dur))) if dur else float(seg.get("end", 0))
        sp = min(max(float(seg.get("speed", 1) or 1), 0.1), 16)
        vol = seg.get("vol", 1)
        vol = min(max(float(1 if vol is None else vol), 0.0), 4.0)
        if b - a >= 0.05:
            out.append({"start": a, "end": b, "speed": sp, "vol": vol})
    if not out:
        raise ValueError("No hay ningún tramo válido")
    return out


def aregions(info, s):
    dur = info["duration"] or 0
    out = []
    for r in s.get("aregions") or []:
        try:
            a = max(0.0, float(r.get("start", 0)))
            b = min(dur, float(r.get("end", dur))) if dur else float(r.get("end", 0))
            v = min(max(float(r.get("vol", 1)), 0.0), 4.0)
        except (TypeError, ValueError):
            continue
        if b - a > 0.001:
            out.append((a, b, v))
    out.sort()
    return out


def region_volume(regs, a, b):
    parts = [(max(x, a) - a, min(y, b) - a, v) for x, y, v in regs if y > a and x < b]
    if not parts or all(abs(v - 1) < 1e-3 for _, _, v in parts):
        return None
    expr = "1"
    for x, y, v in reversed(parts):
        expr = f"if(between(t\\,{x:.4f}\\,{y:.4f})\\,{v:.4f}\\,{expr})"
    return f"volume='{expr}':eval=frame"


def out_duration(segs):
    return sum((x["end"] - x["start"]) / x["speed"] for x in segs)


def _esc(v):
    return str(v).replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")


def sub_filter(sub, offset):
    if not sub or sub.get("mode") != "burn" or sub.get("image"):
        return []
    args = [f"filename='{_esc(sub['path'])}'"]
    if sub.get("si") is not None:
        args.append(f"si={int(sub['si'])}")
    if os.path.isdir(FONTS_DIR):
        args.append(f"fontsdir='{_esc(FONTS_DIR)}'")
    if not sub.get("ass"):
        size = max(0.3, min(3.0, float(sub.get("size") or 1)))
        args.append(f"force_style='FontName=DejaVu Sans,Fontsize={round(18 * size)},Outline=1.6,Shadow=0.6,MarginV=22,BorderStyle=1'")
    return [f"setpts=PTS+{offset:.3f}/TB", "subtitles=" + ":".join(args), "setpts=PTS-STARTPTS"]


def soft_sub_ok(fmt, segs, sub):
    if not sub:
        return False, ""
    if fmt not in ("h264", "h265", "av1", "mkv", "vp9"):
        return False, "Este formato no admite pistas de subtítulos"
    if len(segs) != 1 or abs(segs[0]["speed"] - 1) > 1e-6:
        return False, "Como pista solo funciona con un único tramo a velocidad normal"
    if sub.get("image") and fmt != "mkv":
        return False, "Los subtítulos de imagen (PGS/DVD) como pista solo van en MKV"
    return True, ""


def atempo(speed):
    parts = []
    s = speed
    while s > 2.0:
        parts.append("atempo=2.0")
        s /= 2.0
    while s < 0.5:
        parts.append("atempo=0.5")
        s /= 0.5
    if abs(s - 1) > 1e-6:
        parts.append(f"atempo={s:.6f}")
    return parts


def video_encoder(out, caps, hw):
    fmt = out.get("format", "h264")
    codec = {"h264": "h264", "mkv": "h264", "h265": "hevc", "av1": "av1", "vp9": "vp9"}.get(fmt)
    if hw and codec in ("h264", "hevc") and caps["vaapi"].get(codec):
        return f"{codec}_vaapi"
    return {"h264": "libx264", "hevc": "libx265", "av1": "libsvtav1", "vp9": "libvpx-vp9"}[codec]


def pix_for(out, enc):
    ten = bool(out.get("ten_bit"))
    if enc == "libx264":
        return "yuv420p"
    if enc.endswith("_vaapi"):
        return "p010" if (ten and enc == "hevc_vaapi") else "nv12"
    return "yuv420p10le" if ten else "yuv420p"


def estimate_size(info, s):
    out = s.get("output") or {}
    fmt = out.get("format", "h264")
    segs = segments(info, s)
    d = out_duration(segs)
    music = bool(s.get("tracks")) or bool((s.get("music") or {}).get("id"))
    audio = (info.get("audio") and (out.get("audio") or {}).get("mode", "keep") != "mute") or music
    abr = int((out.get("audio") or {}).get("bitrate", 160)) if audio else 0
    if fmt == "mp3":
        return int(d * abr * 1000 / 8) if (info.get("audio") or music) else 0
    if fmt == "copy":
        src = sum(x["end"] - x["start"] for x in segs)
        return int(info["size"] * src / max(info["duration"], 0.001))
    if out.get("mode") == "size":
        return int(float(out.get("size_mb") or 0) * 1024 * 1024)
    g = geometry(info, s)
    if fmt == "gif":
        return int(g["w"] * g["h"] * g["fps"] * d * 0.08)
    base = {"h264": 0.11, "mkv": 0.11, "h265": 0.075, "vp9": 0.075, "av1": 0.06}[fmt]
    ref = {"h264": 18, "mkv": 18, "h265": 20, "vp9": 28, "av1": 28}[fmt]
    crf = float(out.get("crf") or ref)
    step = 6.0 if fmt in ("h264", "mkv", "h265") else 9.0
    pixels = g["w"] * g["h"] * g["fps"]
    scale = (pixels / (1920 * 1080 * 30)) ** 0.85 * (1920 * 1080 * 30) / max(pixels, 1)
    vbps = pixels * base * scale * 2 ** ((ref - crf) / step)
    return int(d * (vbps + abr * 1000) / 8)


def music_chain(music, total, idx, k=0):
    L = max(0.05, music["trim_out"] - music["trim_in"])
    offset = min(max(0.0, music["offset"]), total)
    mlen = min(L, max(0.0, total - offset))
    if mlen < 0.05:
        return None
    fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    f = [f"atrim=start={music['trim_in']:.3f}:end={music['trim_in'] + mlen:.3f}", "asetpts=PTS-STARTPTS", "aresample=48000", fmt]
    if abs(music["vol"] - 1) > 1e-3:
        f.append(f"volume={music['vol']:.3f}")
    fi = min(music["fade_in"], mlen / 2)
    fo = min(music["fade_out"], mlen / 2)
    if fi > 0:
        f.append(f"afade=t=in:st=0:d={fi:.3f}")
    if fo > 0:
        f.append(f"afade=t=out:st={max(0, mlen - fo):.3f}:d={fo:.3f}")
    tail = f"apad=whole_dur={total:.3f},atrim=end={total:.3f}"
    if offset < 0.001:
        return f"[{idx}:a:0]" + ",".join(f) + "," + tail
    return (f"[{idx}:a:0]" + ",".join(f) + f"[mraw{k}];"
            f"anullsrc=r=48000:cl=stereo,{fmt},atrim=end={offset:.3f}[msil{k}];"
            f"[msil{k}][mraw{k}]concat=n=2:v=0:a=1," + tail)


def build_render(info, src, s, caps, outfile, cube, hw_dec=False, hw_enc=False, pass_no=0, passlog=None, sub=None, music=None):
    out = s.get("output") or {}
    fmt = out.get("format", "h264")
    segs = segments(info, s)
    total = out_duration(segs)
    audio_cfg = out.get("audio") or {}
    only_audio = fmt == "mp3"
    audio_ok = fmt != "gif" and pass_no != 1
    music = list(music or []) if audio_ok else []
    orig_audio = bool(info.get("audio")) and audio_cfg.get("mode", "keep") != "mute" and audio_ok
    if only_audio and not info.get("audio") and not music:
        raise ValueError("Este vídeo no tiene audio")
    has_audio = orig_audio or bool(music)
    aregs = aregions(info, s)
    enc = None if only_audio or fmt == "gif" else video_encoder(out, caps, hw_enc)
    use_hw = (hw_dec and caps["vaapi"]["decode"] and not only_audio) or (enc or "").endswith("_vaapi")
    atrack = int(audio_cfg.get("track") or 0)
    if atrack >= max(1, len(info.get("audios") or [])):
        atrack = 0
    if only_audio:
        sub = None
    soft = None
    if sub and sub.get("mode") == "soft":
        ok, why = soft_sub_ok(fmt, segs, sub)
        if not ok:
            raise ValueError(why)
        soft = sub

    cmd = ["ffmpeg", "-hide_banner", "-y", "-nostdin", "-progress", "pipe:1", "-nostats", "-loglevel", "error"]
    if use_hw:
        cmd += ["-init_hw_device", f"vaapi=va:{VAAPI_DEVICE}", "-filter_hw_device", "va"]
    for sg in segs:
        cmd += ["-ss", f"{sg['start']:.3f}", "-t", f"{sg['end'] - sg['start']:.3f}"]
        if hw_dec and caps["vaapi"]["decode"] and not only_audio:
            cmd += ["-hwaccel", "vaapi", "-hwaccel_device", "va"]
        cmd += ["-i", str(src)]
    sub_input = None
    if soft and soft.get("external") and pass_no != 1:
        sub_input = len(segs)
        sg = segs[0]
        cmd += ["-ss", f"{sg['start']:.3f}", "-t", f"{sg['end'] - sg['start']:.3f}", "-i", str(soft["path"])]
    music_input = len(segs) + (1 if sub_input is not None else 0)
    for mc in music:
        cmd += ["-i", str(mc["path"])]

    parts = []
    labels = []
    fade_in = float(out.get("fade_in") or 0)
    fade_out = float(out.get("fade_out") or 0)
    vol = float(audio_cfg.get("volume", 1) if audio_cfg.get("volume") is not None else 1)

    if not only_audio:
        v = info["video"]
        g = geometry(info, s)
        tonemap = v["hdr"] and out.get("tonemap", True) and caps["zscale"]
        pix = "yuv420p" if fmt == "gif" else pix_for(out, enc)
        work_pix = "yuv420p10le" if pix in ("p010", "yuv420p10le") else "yuv420p"
        slowmo = out.get("slowmo", "dup")
        sharpen = float(s.get("sharpen") or 0)
        burn_img = sub and sub.get("mode") == "burn" and sub.get("image") and sub.get("si") is not None
        for i, sg in enumerate(segs):
            f = ["setpts=PTS-STARTPTS"]
            head = f"[{i}:v:0][{i}:s:{int(sub['si'])}]overlay=eof_action=pass," if burn_img else f"[{i}:v:0]"
            if tonemap:
                f += tonemap_chain()
            if g["crop_on"]:
                cw, ch, cx, cy = g["crop"]
                f.append(f"crop={cw}:{ch}:{cx}:{cy}")
            if g["rot"] == 90:
                f.append("transpose=clock")
            elif g["rot"] == 270:
                f.append("transpose=cclock")
            elif g["rot"] == 180:
                f += ["hflip", "vflip"]
            if s.get("flip_h"):
                f.append("hflip")
            if s.get("flip_v"):
                f.append("vflip")
            if g["scaled"] or (g["rw"] % 2 or g["rh"] % 2):
                f.append(f"scale={g['w']}:{g['h']}:flags=lanczos+accurate_rnd+full_chroma_int")
            if cube:
                f += ["format=gbrp16le", f"lut3d=file='{cube}':interp=tetrahedral"]
            if sharpen > 0:
                f.append(f"cas=strength={min(sharpen, 1):.3f}")
            f += [f"format={work_pix}", "setsar=1"]
            f += sub_filter(sub, sg["start"])
            if abs(sg["speed"] - 1) > 1e-6:
                f.append(f"setpts=PTS/{sg['speed']:.6f}")
                if sg["speed"] < 1 and slowmo == "blend":
                    f.append(f"framerate=fps={g['fps']}")
                elif sg["speed"] < 1 and slowmo == "interp":
                    f.append(f"minterpolate=fps={g['fps']}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1")
            f.append(f"fps={g['fps']}")
            parts.append(head + ",".join(f) + f"[v{i}]")
    if orig_audio:
        for i, sg in enumerate(segs):
            f = ["asetpts=PTS-STARTPTS"] + atempo(sg["speed"]) + ["aresample=48000", "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"]
            rv = region_volume(aregs, sg["start"], sg["end"])
            f = ["asetpts=PTS-STARTPTS"] + ([rv] if rv else []) + f[1:]
            if abs(sg.get("vol", 1) - 1) > 1e-3:
                f.append(f"volume={sg['vol']:.3f}")
            parts.append(f"[{i}:a:{atrack}]" + ",".join(f) + f"[a{i}]")

    n = len(segs)
    want_v = not only_audio
    want_a = has_audio
    if n > 1 and (want_v or orig_audio):
        ins = "".join((f"[v{i}]" if want_v else "") + (f"[a{i}]" if orig_audio else "") for i in range(n))
        outs = ("[vc]" if want_v else "") + ("[ac]" if orig_audio else "")
        parts.append(f"{ins}concat=n={n}:v={int(want_v)}:a={int(orig_audio)}{outs}")
        vsrc, asrc = "[vc]", "[ac]"
    else:
        vsrc, asrc = "[v0]", "[a0]"
    mchains = [c for c in (music_chain(mc, total, music_input + k, k) for k, mc in enumerate(music)) if c]

    if want_v:
        post = []
        if fade_in > 0:
            post.append(f"fade=t=in:st=0:d={fade_in:.3f}")
        if fade_out > 0:
            post.append(f"fade=t=out:st={max(0, total - fade_out):.3f}:d={fade_out:.3f}")
        if fmt == "gif":
            chain = ",".join(post) + "," if post else ""
            parts.append(f"{vsrc}{chain}split[g0][g1];[g0]palettegen=max_colors=256:stats_mode=diff[gp];[g1][gp]paletteuse=dither=sierra2_4a:diff_mode=rectangle[vout]")
        else:
            if enc.endswith("_vaapi"):
                post += [f"format={pix}", "hwupload"]
            else:
                post.append(f"format={pix}")
            parts.append(f"{vsrc}{','.join(post)}[vout]")
        labels.append("[vout]")
    if want_a:
        if orig_audio:
            parts.append(f"{asrc}{f'volume={vol:.3f}' if abs(vol - 1) > 1e-3 else 'anull'}[ao]")
        mix = ["[ao]"] if orig_audio else []
        for k, c in enumerate(mchains):
            parts.append(c + f"[mu{k}]")
            mix.append(f"[mu{k}]")
        if len(mix) > 1:
            parts.append("".join(mix) + f"amix=inputs={len(mix)}:duration=first:dropout_transition=0:normalize=0[am]")
        elif mchains:
            parts.append("[mu0]anull[am]")
        elif orig_audio:
            parts.append("[ao]anull[am]")
        else:
            parts.append(f"anullsrc=r=48000:cl=stereo,atrim=end={total:.3f}[am]")
        post = []
        if fade_in > 0:
            post.append(f"afade=t=in:st=0:d={fade_in:.3f}")
        if fade_out > 0:
            post.append(f"afade=t=out:st={max(0, total - fade_out):.3f}:d={fade_out:.3f}")
        parts.append(f"[am]{','.join(post) if post else 'anull'}[aout]")
        labels.append("[aout]")

    cmd += ["-filter_complex", ";".join(parts)]
    for l in labels:
        cmd += ["-map", l]
    cmd += ["-map_chapters", "-1"]

    abr = int(audio_cfg.get("bitrate", 160))
    if only_audio:
        cmd += ["-c:a", "libmp3lame", "-b:a", f"{abr}k"]
        return cmd + [str(outfile)], total

    if fmt == "gif":
        cmd += ["-loop", "0"]
        return cmd + [str(outfile)], total

    mode = out.get("mode", "crf")
    preset = out.get("preset", "medium")
    crf = out.get("crf")
    vk = None
    if mode == "size":
        size_mb = float(out.get("size_mb") or 50)
        vk = max(150, int(size_mb * 1024 * 1024 * 8 / max(total, 0.1) / 1000 * 0.97 - (abr if has_audio else 0)))

    cmd += ["-c:v", enc]
    if enc == "libx264":
        cmd += ["-preset", PRESETS[enc][preset], "-profile:v", "high"]
        cmd += ["-crf", str(crf if crf is not None else 23)] if vk is None else ["-b:v", f"{vk}k"]
        if vk is not None and pass_no:
            cmd += ["-pass", str(pass_no), "-passlogfile", str(passlog)]
    elif enc == "libx265":
        xp = ["log-level=error"]
        cmd += ["-preset", PRESETS[enc][preset], "-tag:v", "hvc1"]
        if vk is None:
            cmd += ["-crf", str(crf if crf is not None else 28)]
        else:
            cmd += ["-b:v", f"{vk}k"]
            if pass_no:
                xp += [f"pass={pass_no}", f"stats={passlog}.x265"]
        cmd += ["-x265-params", ":".join(xp)]
    elif enc == "libvpx-vp9":
        cmd += ["-deadline", "good", "-cpu-used", PRESETS[enc][preset], "-row-mt", "1", "-tile-columns", "2"]
        cmd += ["-crf", str(crf if crf is not None else 30), "-b:v", "0"] if vk is None else ["-b:v", f"{vk}k"]
        if vk is not None and pass_no:
            cmd += ["-pass", str(pass_no), "-passlogfile", str(passlog)]
    elif enc == "libsvtav1":
        cmd += ["-preset", PRESETS[enc][preset]]
        cmd += ["-crf", str(crf if crf is not None else 30)] if vk is None else ["-b:v", f"{vk}k"]
    else:
        if vk is None:
            q = int(crf if crf is not None else (23 if enc == "h264_vaapi" else 28))
            cmd += ["-rc_mode", "CQP", "-qp", str(q)]
        else:
            cmd += ["-rc_mode", "VBR", "-b:v", f"{vk}k", "-maxrate", f"{int(vk * 1.5)}k"]
        if enc == "hevc_vaapi":
            cmd += ["-tag:v", "hvc1"]

    if info["video"]["hdr"] and out.get("tonemap", True) and caps["zscale"]:
        cmd += ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]

    if pass_no == 1:
        return cmd + ["-an", "-f", "null", os.devnull], total

    if has_audio:
        if fmt == "vp9":
            cmd += ["-c:a", "libopus", "-b:a", f"{abr}k"]
        else:
            cmd += ["-c:a", "aac", "-b:a", f"{abr}k"]
    if soft:
        ext = FORMATS[fmt]["ext"]
        if sub_input is not None:
            cmd += ["-map", f"{sub_input}:s:0"]
        else:
            cmd += ["-map", f"0:s:{int(soft['si'])}"]
            if ext == "mkv" and soft.get("ass"):
                cmd += ["-map", "0:t?"]
        cmd += ["-c:s", {"mp4": "mov_text", "webm": "webvtt"}.get(ext, "copy"), "-disposition:s:0", "default"]
        if soft.get("lang"):
            cmd += ["-metadata:s:s:0", f"language={soft['lang']}"]
    if FORMATS[fmt]["ext"] == "mp4":
        cmd += ["-movflags", "+faststart"]
    return cmd + [str(outfile)], total


def copy_ext(src):
    ext = Path(src).suffix.lower()
    return "mp4" if ext in (".mp4", ".mov", ".m4v") else "mkv"


def build_copy_parts(info, src, s, workdir):
    segs = segments(info, s)
    if any(abs(x["speed"] - 1) > 1e-6 for x in segs):
        raise ValueError("Sin recodificar no admite cambios de velocidad")
    if s.get("tracks") or (s.get("music") or {}).get("id") or any(abs(x["vol"] - 1) > 1e-3 for x in segs) or any(abs(v - 1) > 1e-3 for _, _, v in aregions(info, s)):
        raise ValueError("Sin recodificar no admite cambios de audio (volumen por tramo o pista añadida)")
    ext = copy_ext(src)
    cmds = []
    files = []
    audio = info.get("audio") and ((s.get("output") or {}).get("audio") or {}).get("mode", "keep") != "mute"
    for i, sg in enumerate(segs):
        p = Path(workdir) / f"part{i:03d}.{ext}"
        c = ["ffmpeg", "-hide_banner", "-y", "-nostdin", "-progress", "pipe:1", "-nostats", "-loglevel", "error",
             "-ss", f"{sg['start']:.3f}", "-i", str(src), "-t", f"{sg['end'] - sg['start']:.3f}", "-map", "0:v:0"]
        if ext == "mkv":
            if audio:
                c += ["-map", "0:a?"]
            c += ["-map", "0:s?", "-map", "0:t?"]
        else:
            if audio:
                c += ["-map", "0:a:0?"]
            if any(x["codec"] == "mov_text" for x in info.get("subtitles") or []):
                c += ["-map", "0:s?"]
        c += ["-c", "copy", "-avoid_negative_ts", "make_zero", "-map_chapters", "-1", str(p)]
        cmds.append((c, sg["end"] - sg["start"]))
        files.append(p)
    return cmds, files, ext


def build_concat(listfile, outfile, ext):
    c = ["ffmpeg", "-hide_banner", "-y", "-nostdin", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listfile), "-map", "0", "-c", "copy"]
    if ext == "mp4":
        c += ["-movflags", "+faststart"]
    return c + [str(outfile)]


def build_proxy(info, src, outfile, caps, hw=False, audio_outs=()):
    v = info["video"]
    short = min(v["width"], v["height"])
    target = min(720, short)
    k = target / short
    w, h = even(v["width"] * k), even(v["height"] * k)
    cmd = ["ffmpeg", "-hide_banner", "-y", "-nostdin", "-progress", "pipe:1", "-nostats", "-loglevel", "error"]
    if hw and caps["vaapi"]["decode"]:
        cmd += ["-hwaccel", "vaapi", "-hwaccel_device", VAAPI_DEVICE]
    cmd += ["-i", str(src), "-map", "0:v:0"]
    f = []
    if v["hdr"] and caps["zscale"]:
        f += tonemap_chain()
    f += [f"scale={w}:{h}:flags=bilinear", "format=yuv420p"]
    cmd += ["-vf", ",".join(f), "-fpsmax", "60", "-c:v", "libx264", "-preset", "veryfast", "-tune", "fastdecode",
            "-profile:v", "baseline", "-crf", "25", "-g", "15", "-keyint_min", "15", "-sc_threshold", "0",
            "-an", "-sn", "-dn", "-movflags", "+faststart", str(outfile)]
    for k, path in audio_outs:
        cmd += ["-map", f"0:a:{k}", "-vn", "-sn", "-dn", "-c:a", "libmp3lame", "-b:a", "160k", "-ac", "2", "-ar", "44100",
                "-f", "mp3", str(path)]
    return cmd


def build_audio_preview(src, outfile):
    return ["ffmpeg", "-hide_banner", "-y", "-nostdin", "-loglevel", "error", "-i", str(src), "-map", "0:a:0", "-vn", "-sn", "-dn",
            "-c:a", "libmp3lame", "-b:a", "192k", "-ac", "2", "-ar", "44100", "-f", "mp3", str(outfile)]


def build_wave(src, outfile, width=2400, height=96):
    return ["ffmpeg", "-hide_banner", "-y", "-nostdin", "-loglevel", "error", "-i", str(src),
            "-filter_complex", f"aformat=channel_layouts=mono,showwavespic=s={width}x{height}:colors=white:scale=sqrt:filter=peak",
            "-frames:v", "1", str(outfile)]


def build_vtt(src, si, outfile):
    c = ["ffmpeg", "-hide_banner", "-y", "-nostdin", "-loglevel", "error", "-i", str(src)]
    c += ["-map", f"0:s:{int(si)}"] if si is not None else ["-map", "0:s:0"]
    return c + ["-c:s", "webvtt", "-f", "webvtt", str(outfile)]


def scrub_plan(info, duration):
    v = info["video"]
    h = 108
    w = even(v["width"] * h / max(1, v["height"]))
    interval = max(0.25, duration / 400.0)
    count = max(1, int(duration / interval) + 1)
    cols = 20 if count >= 20 else count
    rows = (count + cols - 1) // cols
    return {"interval": round(interval, 4), "count": count, "cols": cols, "rows": rows, "w": w, "h": h}


def build_scrub(src, plan, outfile):
    return ["ffmpeg", "-hide_banner", "-y", "-nostdin", "-loglevel", "error", "-i", str(src),
            "-vf", f"fps=1/{plan['interval']},scale={plan['w']}:{plan['h']}:flags=bilinear,tile={plan['cols']}x{plan['rows']}",
            "-frames:v", "1", "-q:v", "6", str(outfile)]


def build_thumbs(src, duration, outfile, count=24):
    fps = count / max(duration, 0.1)
    return ["ffmpeg", "-hide_banner", "-y", "-nostdin", "-loglevel", "error", "-i", str(src),
            "-vf", f"fps={fps:.6f},scale=-2:90:flags=bilinear,tile={count}x1", "-frames:v", "1", "-q:v", "5", str(outfile)]


def build_frame(info, src, t, s, caps, cube, graded, sub=None):
    v = info["video"]
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-ss", f"{max(0, t):.3f}", "-i", str(src), "-frames:v", "1", "-an"]
    f = []
    if v["hdr"] and ((s.get("output") or {}).get("tonemap", True)) and caps["zscale"]:
        f += tonemap_chain()
    short = min(v["width"], v["height"])
    k = min(1.0, 720 / short)
    f.append(f"scale={even(v['width'] * k)}:{even(v['height'] * k)}:flags=lanczos")
    if graded:
        if cube:
            f += ["format=gbrp16le", f"lut3d=file='{cube}':interp=tetrahedral"]
        sh = float(s.get("sharpen") or 0)
        if sh > 0:
            f.append(f"cas=strength={min(sh, 1):.3f}")
        if sub and not sub.get("image"):
            f += ["format=yuv420p"] + sub_filter(dict(sub, mode="burn"), max(0, t))
    f.append("format=yuvj420p")
    cmd += ["-vf", ",".join(f), "-q:v", "3", "-f", "mjpeg", "pipe:1"]
    return cmd
