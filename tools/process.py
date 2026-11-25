import collections, json, math, os, re, struct, sys, zlib

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


def point_along(pts, dist):
    """The point dist metres along the polyline, clamped to its ends."""
    for i in range(1, len(pts)):
        d = math.dist(pts[i - 1], pts[i])
        if dist <= d and d > 0:
            u = dist / d
            return (pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u)
        dist -= d
    return pts[-1]


def area(pts):
    return abs(sum(pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1] for i in range(len(pts)))) / 2


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def area_centroid(ring):
    """The centroid of the shape, not of its corners: a corner added on an edge doesn't move it."""
    a = cx = cz = 0.0
    for i in range(len(ring)):
        (x0, z0), (x1, z1) = ring[i - 1], ring[i]
        c = x0 * z1 - x1 * z0
        a += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c
    return cx / (3 * a), cz / (3 * a)


def length(pts):
    return sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts)))


def gable(ring):
    """Ridge [ax, az, bx, bz, half-width] of a pitched roof over the footprint's bounding rectangle, or None if the footprint is not roughly a rectangle. The pages cut the roof to the footprint."""
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


def complete(e):
    """True when the element carries the geometry its type needs: a node lat/lon, a way a full geometry, a relation member geometries."""
    if e['type'] == 'node': return 'lat' in e and 'lon' in e
    if e['type'] == 'way':
        g = e.get('geometry')
        return bool(g) and len(g) > 1 and all(isinstance(x, dict) and 'lat' in x for x in g)
    return any('geometry' in m for m in e.get('members', []))


def relation_rings(e):
    """Outer and inner rings of a multipolygon relation, stitched from its way members and clipped to the world."""
    def rings(inner):
        return stitch([[proj(g['lat'], g['lon']) for g in m['geometry'] if g] for m in e['members']
                       if m['type'] == 'way' and (m.get('role') == 'inner') == inner and m.get('geometry')])
    return ([r for r in (clip_poly(r) for r in rings(False)) if len(r) > 2],
            [r for r in (clip_poly(r) for r in rings(True)) if len(r) > 2])


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


# ---------- streetscape codes (named in src/world/data.ts; change both together) ----------
USE = {'driveway': 1, 'parking_aisle': 2, 'alley': 3}                 # RoadUse; other service=* is SERVICE_OTHER
USE_SERVICE_OTHER, USE_SIDEWALK, USE_CROSSING = 4, 5, 6
UNKNOWN, PRESENT, ABSENT, SEPARATE = 0, 1, 2, 3                         # SideState
SURF = {'asphalt': 1, 'paving_stones': 2, 'sett': 2, 'cobblestone': 2, 'unhewn_cobblestone': 2,
        'concrete': 3, 'concrete:plates': 3, 'concrete:lanes': 3, 'gravel': 4, 'fine_gravel': 4, 'compacted': 4,
        'unpaved': 5, 'dirt': 5, 'ground': 5, 'earth': 5, 'grass': 6, 'grass_paver': 6}
PARK = {'no': 1, 'lane': 2, 'street_side': 3, 'on_kerb': 4, 'half_on_kerb': 5, 'shoulder': 6, 'separate': 7}   # StreetParking
PARK_OLD = {'on_street': 2, 'street_side': 3, 'lay_by': 3, 'on_kerb': 4, 'half_on_kerb': 5}
ORIENT = {'parallel': 1, 'diagonal': 2, 'perpendicular': 3}                                        # ParkingOrientation
PARK_KIND = {'surface': 0, 'street_side': 1, 'carports': 2, 'garage_boxes': 3}                     # ParkingKind
PARK_DROPPED = {'underground', 'multi-storey', 'rooftop'}               # no ground surface to draw
CROSS_UNKNOWN, CROSS_MARKED, CROSS_UNMARKED, CROSS_SIGNALS = 0, 1, 2, 3                            # CrossingKind
KERB = {'raised': 1, 'lowered': 2, 'flush': 3, 'no': 3, 'rolled': 4}                               # Kerb; 0 unknown
SIDES = ('left', 'right')


def surface(v):
    return SURF.get((v or '').strip(), 0)


def metres(v):
    """width=* in metres, clamped to the sidewalk range by the caller; None when unparseable."""
    try:
        v = v.strip().lower()
        if v.endswith('m'): v = v[:-1].strip()
        return float(v.replace(',', '.'))
    except (AttributeError, ValueError):
        return None


def side_tag(t, key, side):
    """The most specific of key:<side>, key:both, key; None when none is set."""
    for k in (f'{key}:{side}', f'{key}:both', key):
        if k in t: return t[k]
    return None


def sidewalks(t):
    """[left, right] SideState, [left, right] width (0 unmapped) and surface, in the way's own direction."""
    whole = {'both': (PRESENT, PRESENT), 'yes': (PRESENT, PRESENT), 'left': (PRESENT, ABSENT), 'right': (ABSENT, PRESENT),
             'no': (ABSENT, ABSENT), 'none': (ABSENT, ABSENT), 'separate': (SEPARATE, SEPARATE)}.get(t.get('sidewalk'), (UNKNOWN, UNKNOWN))
    per = {'yes': PRESENT, 'no': ABSENT, 'none': ABSENT, 'separate': SEPARATE}
    sw = list(whole)
    for i, side in enumerate(SIDES):
        for k in (f'sidewalk:{side}', 'sidewalk:both'):
            if t.get(k) in per: sw[i] = per[t[k]]; break
    ww = []
    for side in SIDES:
        w = None
        for k in (f'sidewalk:{side}:width', 'sidewalk:both:width', 'sidewalk:width'):
            if k in t:
                w = metres(t[k])
                if w is not None: break
        ww.append(round(min(6, max(0.8, w)), 1) if w is not None else 0)
    sf = [surface(next((t[k] for k in (f'sidewalk:{side}:surface', 'sidewalk:both:surface', 'sidewalk:surface') if k in t), None)) for side in SIDES]
    return sw, ww, sf


def street_parking(t):
    """[left, right] StreetParking and ParkingOrientation; the current parking:<side> schema wins over parking:lane:*."""
    pk, po = [0, 0], [0, 0]
    for i, side in enumerate(SIDES):
        v = side_tag(t, 'parking', side)
        if v is not None:
            pk[i] = PARK.get(v, 0)
            po[i] = ORIENT.get(t.get(f'parking:{side}:orientation') or t.get('parking:both:orientation') or '', 0)
            continue
        o = side_tag(t, 'parking:lane', side)
        if o is None: continue
        if o in ('no_parking', 'no_stopping', 'fire_lane', 'no'): pk[i] = 1; continue
        po[i] = ORIENT.get(o, 0)
        pos = next((t[k] for k in (f'parking:lane:{side}:{o}', f'parking:lane:both:{o}') if k in t), None)
        pk[i] = PARK_OLD.get(pos, 0)
    return pk, po


assert sidewalks({'sidewalk': 'left'})[0] == [PRESENT, ABSENT]
assert sidewalks({'sidewalk': 'both', 'sidewalk:right': 'no'})[0] == [PRESENT, ABSENT]
assert sidewalks({})[0] == [UNKNOWN, UNKNOWN]
assert sidewalks({'sidewalk:both:width': '9', 'sidewalk:left:width': '1,6 m'})[1] == [1.6, 6]
assert street_parking({'parking:both': 'lane', 'parking:both:orientation': 'parallel', 'parking:lane:left': 'perpendicular'}) == ([2, 2], [1, 1])
assert street_parking({'parking:lane:right': 'diagonal', 'parking:lane:right:diagonal': 'half_on_kerb'}) == ([0, 5], [0, 2])


def crossing_kind(t):
    c = t.get('crossing')
    if c in ('marked', 'zebra', 'uncontrolled') or t.get('crossing:markings') not in (None, 'no'): return CROSS_MARKED
    if c == 'traffic_signals': return CROSS_SIGNALS
    if c in ('unmarked', 'no') or t.get('crossing:markings') == 'no': return CROSS_UNMARKED
    return CROSS_UNKNOWN


# street furniture (#144): codes as src/world/data.ts FurnitureCode; bus stops are context, not drawn
FU_LAMP, FU_BENCH, FU_BIN, FU_BUS_STOP = 0, 1, 2, 3
LIT = {'yes': 1, 'no': 2}   # lit=* on a road; anything else (24/7, automatic, ...) is left out as not plainly yes or no
CARDINAL = {k: i * 22.5 for i, k in enumerate('N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW'.split())}


def furniture_code(t):
    if t.get('highway') == 'street_lamp': return FU_LAMP
    if t.get('amenity') == 'bench': return FU_BENCH
    if t.get('amenity') == 'waste_basket': return FU_BIN
    if t.get('highway') == 'bus_stop': return FU_BUS_STOP
    return None


def direction(v):
    """direction=* in degrees clockwise from north (a number or a cardinal), or None when it doesn't parse."""
    if v is None: return None
    v = v.strip().upper()
    if v in CARDINAL: return CARDINAL[v]
    try: return round(float(v) % 360, 1)
    except ValueError: return None


def add_furniture(e, t, pt):
    k = furniture_code(t)
    if k is None:
        if t.get('leisure') == 'picnic_table' and inside(pt): report['picnic tables'] += 1
        return False
    if not inside(pt): report['furniture outside the world'] += 1; return True
    f = {'i': e['id'], 'k': k, 'x': round(pt[0], 1), 'z': round(pt[1], 1)}
    if e['type'] != 'node': f['e'] = e['type'][0]   # nodes and ways number separately
    d = direction(t.get('direction')) if k == FU_BENCH else None
    if d is not None: f['d'] = d
    furniture.append(f)
    return True


# ---------- features ----------
d = json.load(open(data_dir + '/osm.json'))
seen, elements, skipped = set(), [], collections.Counter()
for e in d['elements']:                       # de-duplicate by (type, id), so the result never depends on Overpass doing it
    key = (e['type'], e['id'])
    if key in seen: continue
    seen.add(key)
    if not complete(e): skipped[e['type']] += 1; continue
    elements.append(e)
ROAD = {'primary': 0, 'primary_link': 0, 'secondary': 1, 'tertiary': 1,
        'residential': 2, 'unclassified': 2, 'living_street': 2, 'road': 2,
        'service': 3, 'pedestrian': 3, 'raceway': 3, 'track': 4, 'path': 5, 'footway': 5, 'cycleway': 5}
LAND = {'residential': 0, 'farmland': 1, 'meadow': 1, 'industrial': 2, 'recreation_ground': 3, 'grass': 3,
        'cemetery': 4, 'forest': 5}
LEIS = {'pitch': 6, 'playground': 3, 'sports_centre': 3, 'park': 3}
SHORT = {'Best Western Hotell Vrigstad Värdshus': 'Vrigstad Värdshus', 'Torget Vrigstad': 'Torget',
         'Tallåsen, Vrigstads Idrottsplats': 'Tallåsen idrottsplats', 'Hagabanan - Vrigstad Motorklubb': 'Hagabanan'}
CHURCH_WAY = 48762655   # Vrigstad kyrka; its tower is split out of this way's outline
# outlines moved (dx, dz) m off the carriageway they were traced onto, each with the area centroid (cx, cz) of the
# outline it was tuned on. shortcut: a fixed offset; a re-traced way moves its centroid and fails the build, so re-check the
# offset then (our roads are wider than the real ones, so a correct outline may still need a small one). list the
# centroid to 0.1 m: the check allows RETRACE_TOL_M, since the offsets are tuned to clearances of centimetres
BUILDING_SHIFT = {
    # the old bank museum on Jönköpingsvägen, west of the Emån bridge: traced in 2010 (v1) about 3 m south, onto
    # the road; moved north until a full sidewalk fits between its front wall and the 9 m carriageway (the road is
    # drawn wider than it is, so further than the aerial alone), and west so it only grazes the driveway behind it
    48807861: (-1.5, -5, -75.5, -21.1),
    # sheds traced in 2011 and 2012 (v1) about 4 m south of their roofs in the aerial, onto the road beside them
    99634081: (0, -4, -618.3, 75.6),
    173869280: (0, -4, 650.9, -988.2),
    # the Tegnervägen row house (2011, v1) where the road, re-mapped in 2025, passes 0.5 m from its wall; the house
    # matches the aerial, so the road is off, but moving the house is what this table can do: away from the road, up
    # to 0.3 m from the row behind it
    99634083: (0.8, -2.4, -584.5, 87.6),
    # corners clipped by up to 0.7 m where a street bends or ends beside them; nudged clear
    48400728: (-0.4, 1.6, -15.8, 76.2),     # the long house south of Torget, by the living street through the car park
    100345766: (0, -0.8, -20.6, 53.3),      # the small house inside that car park
    99738592: (0.6, 0, -61.9, -132.5),      # on Kristina Nilssons Väg
    103000690: (-1.3, 0, -90.7, 121.5),     # where an unnamed street ends at its corner
}
RETRACE_TOL_M = 0.1
if os.environ.get('BUILDING_SHIFT'):   # the unit tests' own table, as JSON, so their small world needn't hold these ways
    BUILDING_SHIFT = {int(i): tuple(v) for i, v in json.loads(os.environ['BUILDING_SHIFT']).items()}
    print('BUILDING_SHIFT taken from the environment, not from process.py', file=sys.stderr)
shifted = set()   # BUILDING_SHIFT ways kept as buildings
buildings, roads, water, waterways, land, labels = [], [], [], [], [], {}
parking_areas, parking_spaces, crossings, kerbs, trees, furniture = [], [], [], [], [], []
road_nodes = []              # per road: the OSM node id of each kept vertex, None where clipping made the vertex
report = collections.Counter()
nodes_by_id = {}             # crossing and kerb nodes, matched to road vertices once every road is in


def add_label(name, pt, kind, weight):
    if not inside(pt): return
    name = SHORT.get(name, name)
    if name not in labels or labels[name][3] < weight:
        labels[name] = (round(pt[0], 1), round(pt[1], 1), kind, weight)


def add_parking(e, t, outers, inners):
    """amenity=parking (an area) or amenity=parking_space (a space), already clipped; areas get their holes."""
    if t.get('parking') in PARK_DROPPED: report['parking dropped (not on the ground)'] += 1; return
    for o in outers:
        if t.get('amenity') == 'parking_space':
            parking_spaces.append({'i': e['id'], 'p': flat(o)}); continue
        a = {'i': e['id'], 'p': flat(o), 'k': PARK_KIND.get(t.get('parking', 'surface'), 0)}
        holes = [flat(h) for h in inners if point_in(o, centroid(h))]
        if holes: a['h'] = holes
        if surface(t.get('surface')): a['sf'] = surface(t['surface'])
        try: a['cap'] = int(t['capacity'])
        except (KeyError, ValueError): pass
        parking_areas.append(a)


def point_in(ring, p):
    inside = False
    for i in range(len(ring)):
        (ax, az), (bx, bz) = ring[i - 1], ring[i]
        if (az > p[1]) != (bz > p[1]) and p[0] < (bx - ax) * (p[1] - az) / (bz - az) + ax: inside = not inside
    return inside


for e in elements:
    t = e.get('tags', {})
    name = t.get('name')
    if e['type'] == 'node':
        pt = proj(e['lat'], e['lon'])
        add_furniture(e, t, pt)   # and on: a bus stop can carry kerb=raised too
        if not inside(pt): continue
        if t.get('natural') == 'tree': trees.append(pt)
        if t.get('amenity') == 'parking_space': report['parking space nodes'] += 1
        if t.get('highway') == 'crossing' or 'crossing' in t or 'kerb' in t or t.get('barrier') == 'kerb':
            nodes_by_id[e['id']] = (pt, t)
        continue
    if e['type'] == 'relation':
        if t.get('type', 'multipolygon') != 'multipolygon': continue
        if t.get('natural') == 'water':
            outers, inners = relation_rings(e)
            rings = outers + inners
            if rings:
                water.append([flat(r) for r in rings])
                if name: add_label(name, centroid(rings[0]), 'w', area(rings[0]))
        elif t.get('amenity') in ('parking', 'parking_space'):
            add_parking(e, t, *relation_rings(e))
        continue
    pts = geom(e)
    ring = closed_ring(pts)
    if (furniture_code(t) is not None or t.get('leisure') == 'picnic_table') and 'highway' not in t and 'building' not in t:
        add_furniture(e, t, centroid(ring) if ring else point_along(pts, length(pts) / 2))   # a way-mapped bench or bin: its middle
        continue
    if t.get('amenity') in ('parking', 'parking_space') and 'highway' not in t and 'building' not in t:
        r = clip_poly(ring) if ring else []
        if len(r) > 2: add_parking(e, t, [r], [])
        continue
    if t.get('natural') == 'tree_row':
        for piece in clip_line(pts):
            for n in range(int(length(piece) / 8 + 1e-6) + 1):   # one tree every 8 m along the row
                trees.append(point_along(piece, n * 8))
        report['tree rows'] += 1
        continue
    if t.get('barrier') == 'kerb' and 'highway' not in t:
        report['kerb ways'] += 1
        continue
    if 'building' in t:
        if ring and e['type'] == 'way' and e['id'] in BUILDING_SHIFT:
            dx, dz, cx, cz = BUILDING_SHIFT[e['id']]
            assert area(ring) > 1, f'way {e["id"]} has no area: re-check its BUILDING_SHIFT'
            mx, mz = area_centroid(ring)
            assert math.hypot(mx - cx, mz - cz) < RETRACE_TOL_M, f'way {e["id"]} was re-traced: re-check its BUILDING_SHIFT'
            ring = [(x + dx, z + dz) for x, z in ring]
            # the check below would drop it without a word
            assert inside(centroid(ring)), f'way {e["id"]} is moved out of the world: re-check its BUILDING_SHIFT'
            shifted.add(e['id'])
        if not ring or not inside(centroid(ring)): continue
        a = area(ring)
        kind = {'church': 1, 'hotel': 2}.get(t['building'], 0)
        h = 2.8 if a < 40 else 5.5 if a < 150 else 6.5 if a < 400 else 8 if a < 1500 else 9
        if t['building'] == 'church': h = 12 if a > 300 else 8
        if t['building'] == 'hotel': h = 9
        walls, tower = ring, None
        if e['type'] == 'way' and e['id'] == CHURCH_WAY:
            # shortcut: tower corners picked by index, redo if the way is re-mapped
            assert len(ring) == 13, len(ring)
            tower = [ring[i] for i in (7, 8, 10, 11)]
            walls = [p for i, p in enumerate(ring) if i not in (8, 9, 10)]   # the nave, closed along the tower's south wall
        b = {'p': flat(walls), 'h': h, 'k': kind}
        g = gable(walls)
        if g: b['g'] = g
        buildings.append(b)
        if tower:
            buildings.append({'p': flat(tower), 'h': 25, 'k': 1, 's': 13})   # s = spire height
        if name: add_label(name, centroid(ring), 'p', a)
    elif 'highway' in t:
        if ring and (t.get('area') == 'yes') and name:
            add_label(name, centroid(ring), 'p', area(ring))
        c = ROAD.get(t['highway'])
        if c is None: continue
        extra = {}
        if t['highway'] == 'service': extra['s'] = USE.get(t.get('service'), USE_SERVICE_OTHER) if 'service' in t else 0
        elif t.get('footway') == 'sidewalk': extra['s'] = USE_SIDEWALK
        elif t.get('footway') == 'crossing' or t.get('path') == 'crossing' or t.get('cycleway') == 'crossing': extra['s'] = USE_CROSSING
        if not extra.get('s'): extra.pop('s', None)
        if surface(t.get('surface')): extra['sf'] = surface(t['surface'])
        if t.get('lit') in LIT: extra['lt'] = LIT[t['lit']]
        w = metres(t.get('width'))
        if w and 0 < w < 40: extra['w'] = round(w, 1)
        sw, ww, ssf = sidewalks(t)
        if any(sw): extra['sw'] = sw
        if any(ww): extra['sww'] = ww
        if any(ssf): extra['ssf'] = ssf
        pk, po = street_parking(t)
        if any(pk): extra['pk'] = pk
        if any(po): extra['po'] = po
        if t.get('bridge', 'no') != 'no':
            br = {}                                # layer is kept to confirm grade separation, never read as height
            if re.fullmatch(r'-?\d+', t.get('layer', '')): br['l'] = int(t['layer'])
            if t.get('bicycle') == 'designated': br['cy'] = 1
            extra['br'] = br
        ids = dict(zip(pts, e['nodes']))       # unclipped vertices keep their exact projected coordinates
        pieces = clip_line(pts)
        for j, piece in enumerate(pieces):
            r = {'c': c, 'n': name or '', 'p': flat(piece), 'i': e['id']}
            if len(pieces) > 1: r['j'] = j
            r.update(extra)
            roads.append(r)
            road_nodes.append([ids.get(q) for q in piece])
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

assert sum('s' in b for b in buildings) == 1, f'church way {CHURCH_WAY} missing from osm.json'
assert shifted == set(BUILDING_SHIFT), f'BUILDING_SHIFT ways not found as building outlines in osm.json (a relation is not matched): {sorted(set(BUILDING_SHIFT) - shifted)}'

# ---------- crossing and kerb nodes, tied to road vertices through the ways' node lists ----------
on_roads = collections.defaultdict(list)          # node id -> [(class, road index, vertex index)], carriageways only
for ri, ids in enumerate(road_nodes):
    if roads[ri].get('s') in (USE_SIDEWALK, USE_CROSSING) or roads[ri]['c'] > 3: continue
    for vi, nid in enumerate(ids):
        if nid in nodes_by_id: on_roads[nid].append((roads[ri]['c'], ri, vi))
for nid in sorted(nodes_by_id):
    (x, z), t = nodes_by_id[nid]
    kb = KERB.get(t.get('kerb'), 0)
    if t.get('highway') == 'crossing' or 'crossing' in t:
        if t.get('crossing') == 'no': continue
        c = {'i': nid, 'x': round(x, 1), 'z': round(z, 1), 'k': crossing_kind(t)}
        if kb: c['kb'] = kb
        if on_roads[nid]:
            _, c['r'], c['v'] = min(on_roads[nid])    # the biggest road through the node
        crossings.append(c)
    else:
        kerbs.append({'i': nid, 'x': round(x, 1), 'z': round(z, 1), 'kb': kb})

out = {'size': S, 'n': N, 'elev': elev_flat, 'b': buildings, 'r': roads, 'w': water, 'ww': waterways, 'l': land,
       'labels': [{'t': k, 'x': v[0], 'z': v[1], 'k': v[2]} for k, v in labels.items()]}
if parking_areas: out['pa'] = parking_areas
if parking_spaces: out['ps'] = parking_spaces
if crossings: out['x'] = crossings
if kerbs: out['kb'] = kerbs
if trees: out['t'] = flat(trees)
if furniture: out['fu'] = sorted(furniture, key=lambda f: (f['k'], f.get('e', 'n'), f['i']))
# Label order is draw priority on the map: these first, the rest as found.
order = ['Vrigstad Kyrka', 'Torget', 'Vrigstad Värdshus', 'Slättsjön', 'Lundholmssjön', 'Vrigstadsån']
out['labels'].sort(key=lambda l: order.index(l['t']) if l['t'] in order else 99)
json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('elev m', min(elev_flat) / 10, max(elev_flat) / 10)
print('buildings', len(buildings), 'roads', len(roads), 'water', len(water), 'waterways', len(waterways), 'land', len(land))
print(collections.Counter(l['k'] for l in land))
print('forest area', [round(area(list(zip(l['p'][::2], l['p'][1::2])))) for l in land if l['k'] == 5])
print(out['labels'])
if skipped: print('skipped, incomplete geometry:', dict(skipped))

# ---------- streetscape coverage: what OSM says, inside the world square (tools/streetscape-report.mjs adds what the game infers) ----------
def km(rs):
    return round(sum(length(list(zip(r['p'][::2], r['p'][1::2]))) for r in rs) / 1000, 2)


def pct(a, b):
    return f'{100 * a / b:.0f} %' if b else '-'


carriage = [r for r in roads if r['c'] <= 3 and r.get('s', 0) in (0, 1, 2, 3, 4)]
streets = [r for r in roads if r['c'] <= 2]
print('\n## Streetscape coverage (OSM, in the world square)')
print(f'roads class <= SERVICE: {len(carriage)} pieces, {km(carriage)} km')
state = {0: 'unknown', 1: 'yes', 2: 'no', 3: 'separate'}
for side_i, side in enumerate(SIDES):
    by = collections.defaultdict(list)
    for r in carriage: by[state[r.get('sw', [0, 0])[side_i]]].append(r)
    print(f'  sidewalk {side:5}: ' + ', '.join(f'{k} {km(v)} km' for k, v in sorted(by.items())))
tagged = [r for r in carriage if any(r.get('sw', [0, 0]))]
print(f'  any sidewalk tag: {len(tagged)} pieces, {km(tagged)} km ({pct(km(tagged), km(carriage))} of the length)')
both = collections.Counter()
for r in carriage:
    sw = r.get('sw')
    if not sw: continue
    l, rr = sw
    key = 'both' if l == rr == 1 else 'no' if l == rr == 2 else 'separate' if l == rr == 3 else 'left' if l == 1 and rr != 1 else 'right' if rr == 1 else 'mixed'
    both[key] += km([r])
print('  by value (km): ' + ', '.join(f'{k} {round(v, 2)}' for k, v in sorted(both.items())))
print(f'streets class <= STREET with no sidewalk information: {km([r for r in streets if not any(r.get("sw", [0, 0]))])} km '
      '(built-up split: tools/streetscape-report.mjs)')
sep = [r for r in roads if r.get('s') == USE_SIDEWALK]
print(f'separately mapped sidewalks (footway=sidewalk): {len(sep)} pieces, {km(sep)} km')
print(f'footway=crossing ways: {len([r for r in roads if r.get("s") == USE_CROSSING])}')
for name_, code in (('driveways', 1), ('parking aisles', 2), ('alleys', 3), ('other service', 4)):
    rs = [r for r in roads if r.get('s') == code]
    print(f'{name_}: {len(rs)}, {km(rs)} km')
print(f'service roads with no service=*: {len([r for r in roads if r["c"] == 3 and "s" not in r])}')
kinds = {v: k for k, v in PARK_KIND.items()}
pa_area = lambda a: area(list(zip(a['p'][::2], a['p'][1::2]))) - sum(area(list(zip(h[::2], h[1::2]))) for h in a.get('h', []))
print(f'parking areas: {len(parking_areas)}, {round(sum(pa_area(a) for a in parking_areas))} m², '
      f'{sum("sf" in a for a in parking_areas)} with surface, {sum("sf" not in a for a in parking_areas)} without; '
      f'by kind {dict(collections.Counter(kinds[a["k"]] for a in parking_areas))}; '
      f'{sum("h" in a for a in parking_areas)} with holes; {report["parking dropped (not on the ground)"]} dropped (underground, multi-storey, rooftop)')
print(f'parking spaces: {len(parking_spaces)} polygons, {report["parking space nodes"]} nodes (counted only)')
sp = [r for r in roads if 'pk' in r]
print(f'street parking tags: {len(sp)} pieces, {km(sp)} km')
ck = collections.Counter(crossings[i]['k'] for i in range(len(crossings)))
print(f'crossing nodes: {len(crossings)} ({sum("r" in c for c in crossings)} on a carriageway vertex, {sum("r" not in c for c in crossings)} free-standing); '
      f'by kind marked {ck[1]}, unmarked {ck[2]}, signals {ck[3]}, unknown {ck[0]}')
# a crossing's footway connects on both sides when the node is inside a footway, or ends two of them
foot_ends = collections.Counter()
for ri, ids in enumerate(road_nodes):
    if roads[ri]['c'] < 4: continue
    for vi, nid in enumerate(ids):
        if nid is not None: foot_ends[nid] += 1 if vi in (0, len(ids) - 1) else 2
print(f'crossing nodes whose footway does not connect on both sides: {sum(foot_ends[c["i"]] < 2 for c in crossings)} of {len(crossings)}')
print(f'kerb nodes: {len(kerbs)}, by kerb {dict(collections.Counter(k["kb"] for k in kerbs))}; crossings with kerb=*: {sum("kb" in c for c in crossings)}; kerb ways: {report["kerb ways"]}')
print(f'trees: {len(trees)} points ({report["tree rows"]} tree rows, sampled every 8 m)')
surf = collections.Counter(r.get('sf', 0) for r in carriage)
br = [r for r in roads if 'br' in r]
print(f'bridges: {len(br)} pieces ' + ', '.join(f"{r['i']} (class {r['c']}, {round(length(list(zip(r['p'][::2], r['p'][1::2]))), 1)} m)" for r in br))
print(f'carriageway surface tags: {sum(v for k, v in surf.items() if k)} of {len(carriage)} pieces')

# ---------- street furniture coverage (#144; tools/furniture-report.ts adds what the game generates) ----------
print('\n## Street furniture coverage (OSM, in the world square)')
fk = collections.Counter(f['k'] for f in furniture)
print(f'mapped: street lamps {fk[FU_LAMP]}, benches {fk[FU_BENCH]} ({sum("d" in f for f in furniture)} with direction), '
      f'waste baskets {fk[FU_BIN]}, bus stops {fk[FU_BUS_STOP]}; picnic tables {report["picnic tables"]} (counted only); '
      f'{report["furniture outside the world"]} outside the world')
for v, label in ((1, 'yes'), (2, 'no')):
    rs = [r for r in roads if r.get('lt') == v]
    print(f'roads with lit={label}: {len(rs)} pieces, {km(rs)} km')
