#!/bin/sh
# Downloads the raw inputs: OpenStreetMap features (Overpass API) and one Mapzen terrarium elevation tile.
set -e
cd "$(dirname "$0")/../data/raw"
cat > query.txt <<'Q'
[out:json][timeout:90];
(
 way["building"](57.3455,14.4556,57.3655,14.4956);
 way["highway"](57.3455,14.4556,57.3655,14.4956);
 way["natural"~"water|wood"](57.3455,14.4556,57.3655,14.4956);
 way["landuse"~"forest|farmland|meadow|residential|grass|cemetery|industrial|recreation_ground"](57.3455,14.4556,57.3655,14.4956);
 way["waterway"](57.3455,14.4556,57.3655,14.4956);
 way["railway"](57.3455,14.4556,57.3655,14.4956);
 relation["natural"="water"](57.3455,14.4556,57.3655,14.4956);
 way["leisure"](57.3455,14.4556,57.3655,14.4956);
 nwr["amenity"~"^(parking|parking_space)$"](57.3455,14.4556,57.3655,14.4956);
 node["highway"="crossing"](57.3455,14.4556,57.3655,14.4956);
 node["crossing"](57.3455,14.4556,57.3655,14.4956);
 node["kerb"](57.3455,14.4556,57.3655,14.4956);
 node["barrier"="kerb"](57.3455,14.4556,57.3655,14.4956);
 way["barrier"="kerb"](57.3455,14.4556,57.3655,14.4956);
 node["natural"="tree"](57.3455,14.4556,57.3655,14.4956);
 way["natural"="tree_row"](57.3455,14.4556,57.3655,14.4956);
 node["highway"="street_lamp"](57.3455,14.4556,57.3655,14.4956);
 nwr["amenity"="bench"](57.3455,14.4556,57.3655,14.4956);
 nwr["amenity"="waste_basket"](57.3455,14.4556,57.3655,14.4956);
 node["highway"="bus_stop"](57.3455,14.4556,57.3655,14.4956);
 nwr["leisure"="picnic_table"](57.3455,14.4556,57.3655,14.4956);
 node["man_made"="street_cabinet"](57.3455,14.4556,57.3655,14.4956);
);
out geom;
Q
curl -sf --max-time 180 -A "curl-map-client/1.0" --data-urlencode "data@query.txt" https://overpass-api.de/api/interpreter -o osm.json
curl -sf --max-time 60 -A "curl-map-client/1.0" -o tile.png https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/2212/1247.png
rm query.txt
echo "Fetched osm.json and tile.png"
