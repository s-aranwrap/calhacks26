/**
 * Opening hours for the San Francisco starter places, researched by hand on
 * Oct 25, 2026.
 *
 * Structured hours use the OSM subset from core/hours.ts, so the app can say
 * "Open now · until 5 PM" and skip places that are closed. Plain text is only
 * displayed. Each entry names its source. Several sources are third-party
 * travel sites rather than the venue's own page (those pages couldn't be
 * reached when this was written), so the app still says "check before you go".
 *
 * `npm run hours:sf` replaces these with Google Maps hours via Apify, written to
 * sfHours.generated.ts. Generated entries take priority over this file.
 */
export interface PlaceHours {
  /** OSM-style weekly hours, or plain text. */
  hours: string;
  source: string;
}

const CHECKED = 'checked Oct 25, 2026';
const PARK_CODE: PlaceHours = {
  hours: 'Mo-Su 05:00-24:00',
  source: `SF Park Code: city parks close midnight–5 AM, ${CHECKED}`,
};
const PUBLIC_WAY = (what: string): PlaceHours => ({
  hours: `${what}, so there are no set hours. Go in daylight for the best experience`,
  source: `public right of way, ${CHECKED}`,
});

export const SF_PLACE_HOURS: Record<string, PlaceHours> = {
  'sf-sfmoma': {
    hours: 'Mo-Tu 10:00-17:00; We off; Th 12:00-20:00; Fr-Su 10:00-17:00',
    source: `thebettervacation.com (updated Jun 2026), ${CHECKED}`,
  },
  'sf-exploratorium': {
    hours: 'Mo-Tu off; We-Sa 10:00-17:00; Su 12:00-17:00',
    source: `thebettervacation.com (updated Jun 2026), ${CHECKED}`,
  },
  'sf-cal-academy': {
    hours: 'Mo-Sa 09:30-17:00; Su 11:00-17:00',
    source: `thebettervacation.com (updated Jun 2026), ${CHECKED}`,
  },
  'sf-main-library': {
    hours: 'Mo 09:00-18:00; Tu-Th 09:00-20:00; Fr 12:00-18:00; Sa 10:00-18:00; Su 12:00-18:00',
    source: `whichmuseum.com, ${CHECKED}`,
  },
  'sf-musee-mecanique': {
    hours: 'Mo-Su 10:00-20:00',
    source: `kineticist.com and Time Out, ${CHECKED}`,
  },
  'sf-yerba-buena-gardens': {
    hours: 'Mo-Su 06:00-22:00',
    source: `yerbabuenagardens.com, ${CHECKED}`,
  },
  'sf-dolores-park': PARK_CODE,
  'sf-alamo-square': PARK_CODE,
  'sf-twin-peaks': PARK_CODE,
  'sf-golden-gate-park-stow-lake': PARK_CODE,
  'sf-sutro-baths': {
    hours: 'Open daily, closes 1 hour after sunset',
    source: `nps.gov, ${CHECKED}`,
  },
  'sf-ferry-building': {
    hours: 'Shops keep their own hours. Farmers market Tue & Thu 10 AM–2 PM, Sat 8 AM–2 PM',
    source: `ferrybuildingmarketplace.com, ${CHECKED}`,
  },
  'sf-filbert-steps': PUBLIC_WAY('A public stairway'),
  'sf-lombard-street': PUBLIC_WAY('A public street'),
  'sf-balmy-alley': PUBLIC_WAY('Public alleys'),
  'sf-embarcadero-walk': PUBLIC_WAY('A public waterfront promenade'),
  'sf-chinatown-walk': {
    hours: 'A neighborhood, so the streets are always open. Each shop keeps its own hours',
    source: `general guidance, ${CHECKED}`,
  },
};
