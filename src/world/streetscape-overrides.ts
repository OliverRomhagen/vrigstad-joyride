// Local corrections to the streetscape, by OSM way id, for what OpenStreetMap doesn't know yet. Mapping it in OSM, from
// survey or permitted imagery, is the better fix: then every map built from OSM gets it, and this table stays empty.
// Applied in streetscape-rules.ts, never in tools/process.py, so the data pipeline stays generic.

export interface StreetscapeOverride {
  profile?: 'centre' | 'residential' | 'outskirts';
  /** left and right of the OSM way's own direction */
  sidewalk?: Partial<Record<'left' | 'right', 'present' | 'absent' | 'separate'>>;
  sidewalkWidthM?: number;
  verge?: boolean;
  /** what is actually there, and the source (a survey, a photo and its date); a cited survey makes the entry `mapped` */
  note: string;
}

export const STREETSCAPE_OVERRIDES: Readonly<Record<number /* OSM way id */, StreetscapeOverride>> = {};
