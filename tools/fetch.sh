#!/bin/sh
# Downloads the raw inputs: OpenStreetMap features (Overpass API) and one Mapzen terrarium elevation tile.
set -e
cd "$(dirname "$0")/../data/raw"
# south, west, north, east; the east edge reaches past the world's (x 1500) so whole ways come back at Hagabanan
BBOX='57.3455,14.4556,57.3655,14.5036'
cat > query.txt <<Q
[out:json][timeout:90];
(
 way["building"]($BBOX);
 way["highway"]($BBOX);
 way["natural"~"water|wood"]($BBOX);
 way["landuse"~"forest|farmland|meadow|residential|grass|cemetery|industrial|recreation_ground"]($BBOX);
 way["waterway"]($BBOX);
 way["railway"]($BBOX);
 relation["natural"="water"]($BBOX);
 way["leisure"]($BBOX);
 nwr["amenity"~"^(parking|parking_space)$"]($BBOX);
 node["highway"="crossing"]($BBOX);
 node["crossing"]($BBOX);
 node["kerb"]($BBOX);
 node["barrier"="kerb"]($BBOX);
 way["barrier"="kerb"]($BBOX);
 node["natural"="tree"]($BBOX);
 way["natural"="tree_row"]($BBOX);
 node["highway"="street_lamp"]($BBOX);
 nwr["amenity"="bench"]($BBOX);
 nwr["amenity"="waste_basket"]($BBOX);
 node["highway"="bus_stop"]($BBOX);
 nwr["leisure"="picnic_table"]($BBOX);
 node["man_made"="street_cabinet"]($BBOX);
);
out geom;
Q
curl -sf --max-time 180 -A "curl-map-client/1.0" --data-urlencode "data@query.txt" https://overpass-api.de/api/interpreter -o osm.json
curl -sf --max-time 60 -A "curl-map-client/1.0" -o tile.png https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/2212/1247.png
rm query.txt
echo "Fetched osm.json and tile.png"
