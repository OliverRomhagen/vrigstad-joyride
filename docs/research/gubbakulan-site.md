# Where Gubbakulan stood, and what it looked like

Research for [#630](https://github.com/OliverRomhagen/vrigstad-joyride/issues/630) (map [#629](https://github.com/OliverRomhagen/vrigstad-joyride/issues/629), contract [#38](https://github.com/OliverRomhagen/vrigstad-joyride/issues/38)). Researched 28 Nov 2026. This branch is never merged.

## Answer in short

Gubbakulan stood in pine and birch woodland just west of riksväg 30 (Växjövägen), about 1 km south of Torget. A short driveway off the road led to it. The best position is the OSM place node **57.34608° N, 14.47077° E**, which is **x ≈ −290, z ≈ +1049** in game metres. That is **inside** the playable square, but only 51 m from its southern edge (z = 1100). Confidence is **high** that the venue lay within about 100 m of this point, and **medium** for the exact centre of the dance floor.

Today the ground is forest in OSM. One 21 × 17 m building is still mapped on the site. It was traced in February 2011, before the spring 2012 demolition, and has not been edited since, so it is probably a stale outline of a venue building. **The game currently draws it** (see "On the ground today").

## 1. Where it stood

### Coordinates

| | Value |
|---|---|
| Lat/lon (OSM node [721008874](https://www.openstreetmap.org/node/721008874), `place=locality`, `name=Gubbakulan`, `ele=174.5`) | 57.3460754 N, 14.4707747 E |
| Game x (east) | (14.4707747 − 14.4756) × 111320 × cos 57.3555° = **−289.8 m** |
| Game z (south) | −(57.3460754 − 57.3555) × 111320 = **+1049.1 m** |
| Nominatim | "Gubbakulan, Blommedal, Vrigstad, Sävsjö kommun", the only hit for the name ([query](https://nominatim.openstreetmap.org/search?q=Gubbakulan&format=json&countrycodes=se)) |

### How we know, and how sure

1. **The OSM name node.** It was added on 4 May 2010 and moved about 16 m on 14 Feb 2011 by the same mapper (whizse), both times while the venue still stood ([node history](https://www.openstreetmap.org/api/0.6/node/721008874/history.json)). The Feb 2011 edit also added the building at the site (see below). The node's source isn't recorded: its changeset says only "Add and update roads from better traces". So the node is a contemporary local mapper's placement, not an official record.
2. **An independent description fits it.** A Sävsjö blog post, "Kö till nyöppnad sortergård i Vrigstad" (27 Aug 2019), says the new sorting yard is signposted from riksväg 30 just south of Vrigstad, and *"Avfarten är intill den tidigare festplatsen 'Gubbakulan'"* ([savsjo.blogspot.com, Aug 2019](https://savsjo.blogspot.com/2019/08/)). The node is 90 m west of riksväg 30. The next turn-off to the west, an unnamed road that leaves rv 30 at about (−222, 1144) and runs to an industrial plot at about (−470, 1010), is about 100 m from the node. That is plausibly the sorting-yard road (an inference: OSM does not tag the plot as a recycling centre).
3. **The photos fit it.** The hembygdsförening's 2007 and 2012 photos (below) show a clearing in mixed pine, birch and spruce woodland with a gentle rise behind. OSM maps exactly that here: a forest polygon with a driveway into it.

Not checked: Lantmäteriet's historical orthophotos and maps (Historiska ortofoton, the economic map). They need the interactive viewer at [minkarta.lantmateriet.se](https://minkarta.lantmateriet.se/), which a script can't read. A 1960s–2000s orthophoto would show the dance-floor roof and settle the exact centre. That is the next step if the exact position matters. No digitaltmuseum hits were found for Gubbakulan.

## 2. Inside the square? What's there today

**Inside.** x = −290 is well within ±1100. z = 1049 leaves 51 m to the southern edge, so a clearing about 60 m across centred on the node fits only just; centre it slightly north (z ≈ 1030) for margin. The world doesn't need to grow, and the placement rule in #38 (move the site) isn't triggered.

From `data/raw/osm.json` on `origin/main` (game coordinates, distances from the node):

| Feature | OSM id | Where | Notes |
|---|---|---|---|
| Forest (`landuse=forest`) | way 636378174 | covers the node; spans x −383…−167, z 707…1136 | Mapped in 2018, after demolition. The site is woodland today. |
| Building (`building=yes`) | way 99744960 | 17 m; corners (−297, 1065), (−302, 1074), (−284, 1082), (−280, 1072), about 21 × 17 m | Mapped 14 Feb 2011, never edited. Very likely a venue building that is gone since 2012 (inference). **It is in `data/vrigstad.json`** as a 6.5 m building, so the game draws it on the site today. |
| Driveway (`highway=service`, `service=driveway`) | way 58102456 | from rv 30 at (−198, 1053) west to (−279, 1036), ending 17 m from the node | Mapped in 2010 as `highway=road`, retagged as a driveway in 2018. This is the venue's approach road. It is in the game data as a road. |
| Riksväg 30, Växjövägen (`highway=primary`, 90 km/h) | way 107908077 | 92 m east, running N–S through x ≈ −200 | The main road south to Växjö. |
| Track (`highway=track`) | way 49930959 | 52 m east, parallel to rv 30 on its west side | |
| Unnamed residential road | way 48648757 | 84 m; leaves rv 30 at (−222, 1144) and loops west and north to (−458, 1041) | Probably the sorting-yard turn-off from the 2019 blog post. |
| Industrial landuse + building | ways 99744965, 99744966 | about 145 m and 176 m west, x −514…−429 | |
| Industrial landuse (east of rv 30) | way 48777643 | 137 m east | The Trävaruvägen industrial area. |
| Water | none | | No water within 200 m. |

Terrain from the game's elevation grid (`data/vrigstad.json`, decimetres): the site is at 202.8 m, about **5.6 m above Torget**. It rises about 3 m east toward rv 30 and falls about 5 m west to x = −350, so the clearing sits on a gentle west-facing slope.

## 3. What stood there, and how it was laid out

The only primary source with pictures is the hembygdsförening's page, with photos from [1983](https://media.vrigstadshembygdsforening.se/2015/07/Gubbakulan3.jpg), 2007 and 2012 ([page](https://vrigstadshembygdsforening.se/?page_id=190)). What the photos show:

- **Dance floor, the main building** ([2007, Gubbakulan4](https://media.vrigstadshembygdsforening.se/2015/07/Gubbakulan4.jpg)). A long, open-sided pavilion with a low-pitched roof, moss-covered by 2007, on round peeled timber posts. Under it is a raised timber floor with a wooden railing around the edge, and steps up in front. At the back of the pavilion is a small enclosed **orchestra stage** with a framed, proscenium-like opening. Rough size, judged from the photo: 25–30 m long and 10–12 m deep (an estimate, not measured).
- **Kiosks and booths** ([2007, Gubbakulan5](https://media.vrigstadshembygdsforening.se/2015/07/Gubbakulan5.jpg), [Gubbakulan6](https://media.vrigstadshembygdsforening.se/2015/07/Gubbakulan6.jpg)). Small Falu-red timber sheds with white trim stand round the grass clearing. Their wide service openings have arched or octagonal tops, and some sheds have shuttered hatches. The 1983 photos show a timber booth with a numbered **chocolate-wheel / lottery board** ([Gubbakulan1](https://media.vrigstadshembygdsforening.se/2015/07/Gubbakulan1.jpg)), and a plank-walled store room stacked with soft-drink crates ([Gubbakulan2](https://media.vrigstadshembygdsforening.se/2015/07/Gubbakulan2.jpg)).
- **Outdoor concert stage** ([1983, Gubbakulan3](https://media.vrigstadshembygdsforening.se/2015/07/Gubbakulan3.jpg)). A crowd stands on open grass at night in front of a covered stage with a steel-frame roof, a lighting rig and stacked PA speakers. Strings of round lamps hang across the ground, there is a tall lamp post, and trees close in behind. This is the big-name concert setting (the >5,000-visitor nights).
- **Ground**: an open grassy clearing ringed by trees. Leftovers seen in 2007 include rusty frames, timber piles, a tank and a bicycle.
- **After demolition** ([2012, Gubbakulan7](https://media.vrigstadshembygdsforening.se/2015/07/Gubbakulan7.jpg)). Bare, churned earth and stumps among standing pines, oaks and birches, with a low wooded rise behind. No structures are left.
- **Not documented**: fences, a ticket gate or entrance, and parking. No source found describes them. The driveway off rv 30 (above) is the only evidence of the approach. Parking was presumably along it or on the grass, but that is unverified. Entrance gate posts, as in decision 7 of #38, are design, not record.

Earlier, as Lunden, the club began with a **mobile dance floor** and later built a permanent one ("nyligen uppförts" in the 1940s account). The fair had a **tombola**, a **chocolate wheel** and a **shooting range**, and sold coffee, sandwiches, soft drinks and hot dogs ([hembygdsföreningen](https://vrigstadshembygdsforening.se/?page_id=190)).

## 4. History a plaque could carry

Checked against the sources named in each row.

| Fact | Source | Confidence |
|---|---|---|
| 1934: Vrigstad IF starts holding dances at the festival ground **Lunden**, at first on a mobile dance floor | [Vrigstads hembygdsförening](https://vrigstadshembygdsforening.se/?page_id=190) | Good (one local source) |
| 1940: VIF gets permission for four public dances a year besides its two market-day dances. In the 1940s it cost 10 öre a dance and 1 krona to get in | same | Good |
| 1943: the municipality tries to stop the dances. VIF asks 4,000 kr to give them up, which is too much, so the politicians back down | same | Good, and a nice plaque anecdote |
| 1965: VIF signs agreements with **Göran Lundin** and **Garvis orkester**, and the ground is renamed **Gubbakulan** | same | Good |
| Göran Lundin (1939–2018), musician and dance organiser from Växjö, ran Gubbakulan **1965–1985** | [sv.wikipedia: Göran Lundin (nöjesarrangör)](https://sv.wikipedia.org/wiki/G%C3%B6ran_Lundin_(n%C3%B6jesarrang%C3%B6r)) | Good (Wikipedia, citing obituaries) |
| Artists booked there included **Ted Gärdestad, Lill-Babs, Björn Skifs and Carola** | sv.wikipedia (same) | Medium: Wikipedia's list, no separate citation |
| Carola drew more than 5,000 visitors | hembygdsföreningen | Good (one source) |
| "Gräddan av Sveriges artister" (the cream of Sweden's artists) played there in its heyday | hembygdsföreningen; [Värnamo Nyheter, Aug 2021](https://www.vn.se/nyheter/carin-fardigstallde-pappans-bok-om-nojestallet-gubbakulan/) | Good |
| **Spring 2012**: all buildings torn down | hembygdsföreningen ("under våren 2012 har samtliga byggnader rivits") | Good |
| A book, *Ett rent nöje*, Göran Lundin's memories of the venue, was finished by his daughter in 2021 | Värnamo Nyheter, Aug 2021 | Good |
| Owner: Vrigstad IF ran Lunden and contracted Lundin. The sources never say who owned the land | hembygdsföreningen | Club as the organiser: good. Landowner: **unknown** |

**Corrections to the brief:**

- **"Started 1963" is not supported.** The sources give 1934 for Lunden and 1965 for Gubbakulan (the Lundin agreement and the new name). Wikipedia separately says Lundin led Lundins kvintett 1957–1963, which may be where "1963" came from. Use **1934 / 1965** on the plaque.
- "Owned by Vrigstad IF" should read "run by Vrigstad IF". Ownership of the land or buildings isn't stated.
- Who ran the venue from 1985 to 2012 is not found.

A suggested plaque text, in Swedish, using only the facts above:

> **Gubbakulan** · Här låg Vrigstad IF:s festplats, först kallad Lunden, där det dansades från 1934. 1965 tog Göran Lundin och Garvis orkester över och platsen blev Gubbakulan, dit Sveriges största artister kom. När Carola spelade kom över 5 000 personer. Byggnaderna revs våren 2012.

## What changes the map (#629 / #38)

- **No move needed.** The real site is inside the square at about (−290, 1049). It is close to the southern edge, so centre the clearing near z ≈ 1030 to keep it whole.
- **Something sits on it.** OSM way 99744960, a 21 × 17 m building, is drawn by the game at (−302…−280, 1065…1082). It is almost certainly a demolished venue building. Part 1 has two choices: drop it, by excluding it in `tools/process.py` or carving it out in the site's layout module, or reuse its footprint as the trace of the vanished building. The forest polygon also needs a clearing cut into it.
- **The approach road already exists.** Driveway way 58102456 runs from rv 30 at (−198, 1053) to (−279, 1036). Players driving south on Växjövägen pass the turn-off, which is a natural way to come upon it.
- Real people on the plaque: Göran Lundin, Garvis orkester and Carola, per decision 4. Ted Gärdestad, Lill-Babs and Björn Skifs are sourced only to Wikipedia; name them only if the maintainers want to.
