// Latitude/longitude into the board's own coordinates.
//
// The board is drawn on the Albers Equal Area projection recorded in
// world.json (+proj=aea +lat_0=30 +lon_0=69.5 +lat_1=26 +lat_2=35, WGS84, km).
// This is the ellipsoidal forward case of that projection. Checked against all
// 160 districts, which carry both their lat/lon and their map x/y: the largest
// disagreement is 7 metres, against a hex 20 km across.

const A = 6378.137;                 // WGS84 semi-major axis, km
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const E = Math.sqrt(E2);
const rad = (d) => (d * Math.PI) / 180;

/** Authalic ("equal-area") latitude term. */
function qOf(phi) {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
}
function mOf(phi) {
  const s = Math.sin(phi);
  return Math.cos(phi) / Math.sqrt(1 - E2 * s * s);
}

/**
 * Build a lat/lon → map x,y converter for a loaded world.
 * Returns null when the world was not built on the projection this understands.
 */
export function projector(world) {
  const p = world?.projection;
  if (!p?.proj4 || !/\+proj=aea/.test(p.proj4)) return null;
  const num = (k, dflt) => {
    const m = p.proj4.match(new RegExp(`\\+${k}=(-?[\\d.]+)`));
    return m ? Number(m[1]) : dflt;
  };
  const lat0 = num('lat_0', 30), lon0 = num('lon_0', 69.5);
  const lat1 = num('lat_1', 26), lat2 = num('lat_2', 35);

  const p0 = rad(lat0), p1 = rad(lat1), p2 = rad(lat2);
  const m1 = mOf(p1), m2 = mOf(p2), q1 = qOf(p1), q2 = qOf(p2), q0 = qOf(p0);
  const n = (m1 * m1 - m2 * m2) / (q2 - q1);
  const C = m1 * m1 + n * q1;
  const rho0 = (A * Math.sqrt(C - n * q0)) / n;
  const [west, south, east, north] = world.bbox || [-180, -90, 180, 90];

  return {
    /** Inside the area the board actually covers? */
    inBounds(lat, lon) {
      return lon >= west && lon <= east && lat >= south && lat <= north;
    },
    /** → [x, y] in map units, the same space district.x / district.y use. */
    toMap(lat, lon) {
      const rho = (A * Math.sqrt(C - n * qOf(rad(lat)))) / n;
      const theta = n * (rad(lon) - rad(lon0));
      const X = rho * Math.sin(theta);
      const Y = rho0 - rho * Math.cos(theta);
      return [X - p.x0, p.y1 - Y];
    },
  };
}
