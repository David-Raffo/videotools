import hashlib
import json
import re
from pathlib import Path

import numpy as np

GRID = 33
LUMA = np.array([0.2126, 0.7152, 0.0722])


def identity_grid(n=GRID):
    x = np.linspace(0.0, 1.0, n)
    b, g, r = np.meshgrid(x, x, x, indexing="ij")
    return np.stack([r, g, b], axis=-1)


def _smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def _sat(c, s):
    l = (c @ LUMA)[..., None]
    return l + (c - l) * s


def _contrast(c, k, pivot=0.5):
    return (c - pivot) * k + pivot


def _warm(c, t):
    c = c.copy()
    c[..., 0] *= 1 + 0.12 * t
    c[..., 2] *= 1 - 0.12 * t
    return c


BUILTIN = {
    "Cálido": lambda c: _sat(_warm(c, 0.6), 1.05),
    "Frío": lambda c: _warm(c, -0.6),
    "Vívido": lambda c: _sat(_contrast(c, 1.12), 1.35),
    "Dron punch": lambda c: _sat(_warm(_contrast(c, 1.15), 0.15), 1.25),
    "Teal & Orange": lambda c: _teal_orange(c),
    "Película suave": lambda c: _sat(0.06 + _contrast(c, 0.9) * 0.9, 0.85),
    "Atardecer": lambda c: _sat(_warm(_contrast(c, 1.08), 1.0) * np.array([1.0, 0.97, 0.9]), 1.15),
    "Blanco y negro": lambda c: np.repeat(_contrast((c @ LUMA)[..., None], 1.15), 3, axis=-1),
}


def _teal_orange(c):
    l = (c @ LUMA)[..., None]
    shadows = 1 - _smooth(l * 1.6)
    highs = _smooth((l - 0.35) * 1.6)
    teal = np.array([-0.06, 0.02, 0.07])
    orange = np.array([0.08, 0.02, -0.07])
    out = c + shadows * teal + highs * orange
    return _sat(_contrast(out, 1.08), 1.1)


def parse_cube(text):
    size = None
    one_d = False
    dmin = np.zeros(3)
    dmax = np.ones(3)
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        up = line.upper()
        if up.startswith("TITLE"):
            continue
        if up.startswith("LUT_3D_SIZE"):
            size = int(line.split()[1])
            continue
        if up.startswith("LUT_1D_SIZE"):
            size = int(line.split()[1])
            one_d = True
            continue
        if up.startswith("DOMAIN_MIN"):
            dmin = np.array([float(v) for v in line.split()[1:4]])
            continue
        if up.startswith("DOMAIN_MAX"):
            dmax = np.array([float(v) for v in line.split()[1:4]])
            continue
        if up.startswith("LUT_1D_INPUT_RANGE") or up.startswith("LUT_3D_INPUT_RANGE"):
            lo, hi = (float(v) for v in line.split()[1:3])
            dmin, dmax = np.full(3, lo), np.full(3, hi)
            continue
        if re.match(r"^[-+0-9.eE]", line):
            parts = line.split()
            if len(parts) >= 3:
                rows.append([float(v) for v in parts[:3]])
    if not size:
        raise ValueError("Archivo .cube sin LUT_3D_SIZE")
    data = np.array(rows, dtype=np.float64)
    if one_d:
        if len(data) != size:
            raise ValueError("LUT 1D incompleta")
        return {"kind": "1d", "size": size, "data": data, "min": dmin, "max": dmax}
    if len(data) != size ** 3:
        raise ValueError(f"LUT incompleta: {len(data)} de {size ** 3} valores")
    return {"kind": "3d", "size": size, "data": data.reshape(size, size, size, 3), "min": dmin, "max": dmax}


def apply_lut(lut, c):
    x = (c - lut["min"]) / (lut["max"] - lut["min"])
    x = np.clip(x, 0, 1)
    n = lut["size"]
    if lut["kind"] == "1d":
        pos = np.linspace(0, 1, n)
        return np.stack([np.interp(x[..., i], pos, lut["data"][:, i]) for i in range(3)], axis=-1)
    d = lut["data"]
    p = x * (n - 1)
    i0 = np.floor(p).astype(int)
    i0 = np.clip(i0, 0, n - 2)
    f = p - i0
    r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]
    fr, fg, fb = f[..., 0:1], f[..., 1:2], f[..., 2:3]

    def at(db, dg, dr):
        return d[b0 + db, g0 + dg, r0 + dr]

    c00 = at(0, 0, 0) * (1 - fr) + at(0, 0, 1) * fr
    c01 = at(0, 1, 0) * (1 - fr) + at(0, 1, 1) * fr
    c10 = at(1, 0, 0) * (1 - fr) + at(1, 0, 1) * fr
    c11 = at(1, 1, 0) * (1 - fr) + at(1, 1, 1) * fr
    c0 = c00 * (1 - fg) + c01 * fg
    c1 = c10 * (1 - fg) + c11 * fg
    return c0 * (1 - fb) + c1 * fb


def adjust(c, g):
    exp = float(g.get("exposure", 0))
    con = float(g.get("contrast", 0))
    sat = float(g.get("saturation", 0))
    tmp = float(g.get("temperature", 0))
    tint = float(g.get("tint", 0))
    hi = float(g.get("highlights", 0))
    sh = float(g.get("shadows", 0))
    if exp:
        c = c * (2.0 ** exp)
    if sh or hi:
        l = np.clip((c @ LUMA)[..., None], 0, 1)
        c = c + sh * 0.25 * (1 - _smooth(l * 2)) * (1 - l) + hi * 0.25 * _smooth(l * 2 - 1) * l
    if con:
        c = _contrast(c, 1 + con * 0.5, 0.45)
    if tmp or tint:
        c = c * np.array([1 + 0.1 * tmp, 1 - 0.08 * tint, 1 - 0.1 * tmp])
    if sat:
        c = _sat(c, max(0.0, 1 + sat))
    return c


def is_neutral(g):
    keys = ["exposure", "contrast", "saturation", "temperature", "tint", "highlights", "shadows"]
    return not g.get("lut") and all(abs(float(g.get(k, 0) or 0)) < 1e-6 for k in keys)


def write_cube(path, c):
    n = c.shape[0]
    flat = np.clip(c, 0, 1).reshape(-1, 3)
    lines = ["TITLE \"videotools\"", f"LUT_3D_SIZE {n}", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]
    lines += [f"{r:.6f} {g:.6f} {b:.6f}" for r, g, b in flat]
    Path(path).write_text("\n".join(lines) + "\n")


class LutStore:
    def __init__(self, user_dir, cache_dir):
        self.user_dir = Path(user_dir)
        self.cache_dir = Path(cache_dir)
        self.user_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._parsed = {}

    def list(self):
        items = [{"id": f"builtin:{k}", "name": k, "builtin": True} for k in BUILTIN]
        for p in sorted(self.user_dir.glob("*.cube"), key=lambda p: p.name.lower()):
            items.append({"id": f"user:{p.name}", "name": p.stem, "builtin": False})
        return items

    def save_user(self, filename, data):
        name = re.sub(r"[^\w\-. ()áéíóúñÁÉÍÓÚÑ]", "_", Path(filename).stem).strip() or "lut"
        text = data.decode("utf-8", errors="replace")
        try:
            parse_cube(text)
        except ValueError as e:
            msg = str(e)
            raise ValueError(msg if msg.startswith(("Archivo", "LUT")) else "El archivo no es un .cube válido")
        dest = self.user_dir / f"{name}.cube"
        dest.write_text(text)
        return f"user:{dest.name}"

    def delete_user(self, lut_id):
        if not lut_id.startswith("user:"):
            raise ValueError("Solo se pueden borrar LUTs subidas")
        p = self.user_dir / Path(lut_id[5:]).name
        p.unlink(missing_ok=True)
        self._parsed.pop(lut_id, None)

    def _fn(self, lut_id):
        if lut_id.startswith("builtin:"):
            fn = BUILTIN.get(lut_id[8:])
            if not fn:
                raise ValueError("LUT desconocida")
            return fn
        if lut_id.startswith("user:"):
            p = self.user_dir / Path(lut_id[5:]).name
            if not p.exists():
                raise ValueError("LUT no encontrada")
            key = (lut_id, p.stat().st_mtime)
            if key not in self._parsed:
                self._parsed = {k: v for k, v in self._parsed.items() if k[0] != lut_id}
                self._parsed[key] = parse_cube(p.read_text(errors="replace"))
            lut = self._parsed[key]
            return lambda c: apply_lut(lut, c)
        raise ValueError("LUT desconocida")

    def grid(self, g):
        c = adjust(identity_grid(), g or {})
        lut = (g or {}).get("lut")
        if lut:
            k = float(g.get("intensity", 1.0) if g.get("intensity") is not None else 1.0)
            graded = self._fn(lut)(np.clip(c, 0, 1))
            c = c * (1 - k) + graded * k
        return np.clip(c, 0, 1).astype(np.float32)

    def build(self, g):
        if not g or is_neutral(g):
            return None
        payload = {k: g.get(k) for k in ["lut", "intensity", "exposure", "contrast", "saturation", "temperature", "tint", "highlights", "shadows"]}
        if payload["lut"] and payload["lut"].startswith("user:"):
            p = self.user_dir / Path(payload["lut"][5:]).name
            payload["mtime"] = p.stat().st_mtime if p.exists() else 0
        h = hashlib.sha1(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]
        out = self.cache_dir / f"{h}.cube"
        if out.exists():
            return out
        c = adjust(identity_grid(), g)
        lut = g.get("lut")
        if lut:
            k = float(g.get("intensity", 1.0) if g.get("intensity") is not None else 1.0)
            graded = self._fn(lut)(np.clip(c, 0, 1))
            c = c * (1 - k) + graded * k
        tmp = out.with_suffix(".tmp")
        write_cube(tmp, c)
        tmp.rename(out)
        return out
