import json, math, struct, sys, zlib

data_dir, out_path = sys.argv[1], sys.argv[2]
LAT0, LON0 = 57.3555, 14.4756
S = 2200.0            # square side in metres
HALF = S / 2
N = 89                # elevation grid (25 m spacing)
MLAT = 111360.0
MLON = 111320.0 * math.cos(math.radians(LAT0))


def proj(lat, lon):
    return ((lon - LON0) * MLON, (LAT0 - lat) * MLAT)   # x east, z south


# ---------- elevation tile (terrarium PNG, pure-python decode) ----------
def read_png(path):
    raw = open(path, 'rb').read()
    assert raw[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat = 8, b''
    while pos < len(raw):
        ln, typ = struct.unpack('>I4s', raw[pos:pos + 8])
        body = raw[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', body[:10])
        elif typ == b'IDAT':
            idat += body
        pos += 12 + ln
    assert depth == 8 and ctype in (2, 6), (depth, ctype)
    bpp = 3 if ctype == 2 else 4
    buf = zlib.decompress(idat)
    stride = w * bpp
    rows, prev, p = [], bytearray(stride), 0
    for _ in range(h):
        f = buf[p]; line = bytearray(buf[p + 1:p + 1 + stride]); p += 1 + stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + ((a + b) >> 1)) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        rows.append(line); prev = line
    return w, h, bpp, rows


TW, TH, BPP, ROWS = read_png(data_dir + '/tile.png')
Z, TX, TY = 12, 2212, 1247


def tile_h(px, py):
    px = min(max(px, 0), TW - 1); py = min(max(py, 0), TH - 1)
    r = ROWS[py]; i = px * BPP
    return r[i] * 256 + r[i + 1] + r[i + 2] / 256 - 32768


def elev(lat, lon):
    n = 2 ** Z
    fx = ((lon + 180) / 360 * n - TX) * TW - 0.5
    fy = ((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n - TY) * TH - 0.5
    x0, y0 = math.floor(fx), math.floor(fy)
    u, v = fx - x0, fy - y0
    return (tile_h(x0, y0) * (1 - u) * (1 - v) + tile_h(x0 + 1, y0) * u * (1 - v)
            + tile_h(x0, y0 + 1) * (1 - u) * v + tile_h(x0 + 1, y0 + 1) * u * v)


grid = []
for j in range(N):
    z = -HALF + S * j / (N - 1)
    row = []
    for i in range(N):
        x = -HALF + S * i / (N - 1)
        row.append(elev(LAT0 - z / MLAT, LON0 + x / MLON))
    grid.append(row)
# one 3x3 smoothing pass
sm = []
for j in range(N):
    row = []
    for i in range(N):
        acc = cnt = 0
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                jj, ii = j + dj, i + di
                if 0 <= jj < N and 0 <= ii < N:
                    wgt = 4 if (dj == 0 and di == 0) else 1
                    acc += grid[jj][ii] * wgt; cnt += wgt
        row.append(acc / cnt)
    sm.append(row)
elev_flat = [round(v * 10) for row in sm for v in row]   # decimetres

# ---------- geometry helpers ----------
def inside(p):
    return abs(p[0]) <= HALF and abs(p[1]) <= HALF


def clip_poly(pts):
    def clip(pts, axis, sign):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = sign * a[axis] <= HALF, sign * b[axis] <= HALF
            if ia != ib:
                t = (sign * HALF - a[axis]) / (b[axis] - a[axis])
                out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
            if ib:
                out.append(b)
        return out
    for axis in (0, 1):
        for sign in (1, -1):
            if not pts:
                return []
            pts = clip(pts, axis, sign)
    return pts


def clip_seg(a, b):
    t0, t1 = 0.0, 1.0
    dx, dz = b[0] - a[0], b[1] - a[1]
    for p, q in ((-dx, a[0] + HALF), (dx, HALF - a[0]), (-dz, a[1] + HALF), (dz, HALF - a[1])):
        if p == 0:
            if q < 0: return None
        else:
            t = q / p
            if p < 0:
                if t > t1: return None
                t0 = max(t0, t)
            else:
                if t < t0: return None
                t1 = min(t1, t)
    return ((a[0] + t0 * dx, a[1] + t0 * dz), (a[0] + t1 * dx, a[1] + t1 * dz))


def clip_line(pts):
    pieces, cur = [], []
    for i in range(1, len(pts)):
        c = clip_seg(pts[i - 1], pts[i])
        if not c:
            if len(cur) > 1: pieces.append(cur)
            cur = []
            continue
        if cur and cur[-1] == c[0]:
            cur.append(c[1])
        else:
            if len(cur) > 1: pieces.append(cur)
            cur = [c[0], c[1]]
    if len(cur) > 1: pieces.append(cur)
    return pieces


def area(pts):
    return abs(sum(pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1] for i in range(len(pts)))) / 2


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def length(pts):
    return sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts)))


def gable(ring):
    """Ridge [ax, az, bx, bz, half-width] of a pitched roof over the footprint's bounding rectangle, or None if the footprint is not roughly a rectangle."""
    n = len(ring)
    i = max(range(n), key=lambda i: math.dist(ring[i - 1], ring[i]))
    d = math.dist(ring[i - 1], ring[i])
    ux, uz = (ring[i][0] - ring[i - 1][0]) / d, (ring[i][1] - ring[i - 1][1]) / d
    us, vs = [x * ux + z * uz for x, z in ring], [z * ux - x * uz for x, z in ring]
    cu, cv, L, W = (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2, (max(us) - min(us)) / 2, (max(vs) - min(vs)) / 2
    if area(ring) < 0.85 * 4 * L * W: return None
    if W > L: ux, uz, cu, cv, L, W = -uz, ux, cv, -cu, W, L   # ridge runs along the long side
    px, pz = cu * ux - cv * uz, cu * uz + cv * ux
    return [round(v, 1) for v in (px - L * ux, pz - L * uz, px + L * ux, pz + L * uz, W)]


assert gable([(0, 0), (4, 0), (4, 10), (0, 10)]) in ([2, 0, 2, 10, 2], [2, 10, 2, 0, 2])
assert gable([(0, 0), (10, 0), (10, 4), (4, 4), (4, 10), (0, 10)]) is None


def flat(pts):
    out = []
    for p in pts:
        out += [round(p[0], 1), round(p[1], 1)]
    return out


def geom(e):
    return [proj(g['lat'], g['lon']) for g in e['geometry']]


def closed_ring(pts):
    if len(pts) > 3 and pts[0] == pts[-1]:
        return pts[:-1]
    return None


def stitch(ways):
    ways = [list(w) for w in ways]
    rings = []
    while ways:
        cur = ways.pop(0)
        while cur[0] != cur[-1]:
            for k, w in enumerate(ways):
                if w[0] == cur[-1]: cur += w[1:]; ways.pop(k); break
                if w[-1] == cur[-1]: cur += w[-2::-1]; ways.pop(k); break
            else:
                break
        if cur[0] == cur[-1] and len(cur) > 3:
            rings.append(cur[:-1])
    return rings


# ---------- features ----------
d = json.load(open(data_dir + '/osm.json'))
ROAD = {'primary': 0, 'primary_link': 0, 'secondary': 1, 'tertiary': 1,
        'residential': 2, 'unclassified': 2, 'living_street': 2, 'road': 2,
        'service': 3, 'pedestrian': 3, 'raceway': 3, 'track': 4, 'path': 5, 'footway': 5, 'cycleway': 5}
LAND = {'residential': 0, 'farmland': 1, 'meadow': 1, 'industrial': 2, 'recreation_ground': 3, 'grass': 3,
        'cemetery': 4, 'forest': 5}
LEIS = {'pitch': 6, 'playground': 3, 'sports_centre': 3, 'park': 3}
SHORT = {'Best Western Hotell Vrigstad Värdshus': 'Vrigstad Värdshus', 'Torget Vrigstad': 'Torget',
         'Tallåsen, Vrigstads Idrottsplats': 'Tallåsen idrottsplats', 'Hagabanan - Vrigstad Motorklubb': 'Hagabanan'}
buildings, roads, water, waterways, land, labels = [], [], [], [], [], {}


def add_label(name, pt, kind, weight):
    if not inside(pt): return
    name = SHORT.get(name, name)
    if name not in labels or labels[name][3] < weight:
        labels[name] = (round(pt[0], 1), round(pt[1], 1), kind, weight)


for e in d['elements']:
    t = e.get('tags', {})
    name = t.get('name')
    if e['type'] == 'relation':
        if t.get('natural') != 'water': continue
        outers = stitch([[proj(g['lat'], g['lon']) for g in m['geometry']] for m in e['members']
                         if m['type'] == 'way' and m.get('role') != 'inner' and 'geometry' in m])
        inners = stitch([[proj(g['lat'], g['lon']) for g in m['geometry']] for m in e['members']
                         if m['type'] == 'way' and m.get('role') == 'inner' and 'geometry' in m])
        rings = [r for r in (clip_poly(r) for r in outers + inners) if len(r) > 2]
        if rings:
            water.append([flat(r) for r in rings])
            if name: add_label(name, centroid(rings[0]), 'w', area(rings[0]))
        continue
    pts = geom(e)
    ring = closed_ring(pts)
    if 'building' in t:
        if not ring or not inside(centroid(ring)): continue
        a = area(ring)
        kind = {'church': 1, 'hotel': 2}.get(t['building'], 0)
        h = 2.8 if a < 40 else 5.5 if a < 150 else 6.5 if a < 400 else 8 if a < 1500 else 9
        if t['building'] == 'church': h = 12 if a > 300 else 8
        if t['building'] == 'hotel': h = 9
        b = {'p': flat(ring), 'h': h, 'k': kind}
        if gable(ring): b['g'] = gable(ring)
        buildings.append(b)
        if name == 'Vrigstad Kyrka':
            # shortcut: tower corners picked by index from OSM way 48762655, redo if the way is re-mapped
            assert len(ring) == 13, len(ring)
            buildings.append({'p': flat([ring[i] for i in (7, 8, 10, 11)]), 'h': 25, 'k': 1, 's': 13})   # s = spire height
        if name: add_label(name, centroid(ring), 'p', a)
    elif 'highway' in t:
        if ring and (t.get('area') == 'yes') and name:
            add_label(name, centroid(ring), 'p', area(ring))
        c = ROAD.get(t['highway'])
        if c is None: continue
        for piece in clip_line(pts):
            roads.append({'c': c, 'n': name or '', 'p': flat(piece)})
        if name and t['highway'] == 'pedestrian':
            add_label(name, centroid(pts), 'p', 1)
    elif 'waterway' in t:
        k = 0 if t['waterway'] == 'river' else 1
        best = None
        for piece in clip_line(pts):
            waterways.append({'k': k, 'p': flat(piece)})
            if best is None or length(piece) > length(best): best = piece
        if name and best:
            add_label(name, best[len(best) // 2], 'w', length(best))
    elif ring:
        k = None
        if t.get('natural') == 'water':
            r = clip_poly(ring)
            if len(r) > 2:
                water.append([flat(r)])
                if name: add_label(name, centroid(r), 'w', area(r))
            continue
        if t.get('natural') == 'wood': k = 5
        elif 'landuse' in t: k = LAND.get(t['landuse'])
        elif 'leisure' in t:
            k = LEIS.get(t['leisure'])
            if name:
                c = clip_poly(ring)
                if len(c) > 2: add_label(name, centroid(c), 'p', area(c))
        if k is None: continue
        r = clip_poly(ring)
        if len(r) > 2:
            land.append({'k': k, 'p': flat(r)})

out = {'size': S, 'n': N, 'elev': elev_flat, 'b': buildings, 'r': roads, 'w': water, 'ww': waterways, 'l': land,
       'labels': [{'t': k, 'x': v[0], 'z': v[1], 'k': v[2]} for k, v in labels.items()]}
json.dump(out, open(out_path, 'w'), ensure_ascii=False, separators=(',', ':'))
print('elev m', min(elev_flat) / 10, max(elev_flat) / 10)
print('buildings', len(buildings), 'roads', len(roads), 'water', len(water), 'waterways', len(waterways), 'land', len(land))
import collections
print(collections.Counter(l['k'] for l in land))
print('forest area', [round(area(list(zip(l['p'][::2], l['p'][1::2])))) for l in land if l['k'] == 5])
print(out['labels'])
