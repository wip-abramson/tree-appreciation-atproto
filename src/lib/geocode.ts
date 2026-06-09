/**
 * Reverse geocoding via OSM Nominatim, used once at seeding time to derive
 * a quiet place label for a tree ("Calton Hill", "Leith", ...).
 *
 * Nominatim usage policy requires a descriptive User-Agent and at most
 * one request per second — both fine for our once-per-seed usage.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
const USER_AGENT = 'tree-appreciation (https://github.com/wip-abramson/tree-appreciation-atproto)'

// Address keys in order of preference: the most local, human-evocative
// label available without being a street address.
const PLACE_KEYS = [
  'park',
  'garden',
  'nature_reserve',
  'square',
  'neighbourhood',
  'quarter',
  'hamlet',
  'suburb',
  'village',
  'town',
  'city_district',
  'city',
  'county',
] as const

export async function reverseGeocodePlace(
  latitude: string,
  longitude: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    lat: latitude,
    lon: longitude,
    format: 'jsonv2',
    zoom: '16',
    addressdetails: '1',
  })

  try {
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null

    const doc = (await res.json()) as {
      address?: Record<string, string>
    }
    const address = doc.address
    if (!address) return null

    for (const key of PLACE_KEYS) {
      const value = address[key]
      if (value) return value
    }
    return null
  } catch {
    // Geocoding is a nicety; the presence works without it
    return null
  }
}
