/**
 * Client-side reverse geocoder.
 *
 * Uses BigDataCloud's free `reverse-geocode-client` endpoint — CORS-enabled,
 * no API key, same source the backend uses. Doing the lookup in the browser
 * means the confirmation banner can render instantly after the user grants
 * permission, without a round-trip through our API.
 *
 * Keep this tolerant of failures: if the network flakes, we return `null` and
 * the caller falls back to the manual state/city picker. Never let this block
 * the analyze flow.
 */
const BIGDATACLOUD_URL =
  'https://api.bigdatacloud.net/data/reverse-geocode-client'

const LOOKUP_TIMEOUT_MS = 4000

export interface ReverseGeocodeResult {
  city: string
  regionCode: string
  regionName: string
  countryCode: string
  countryName: string
}

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const url = `${BIGDATACLOUD_URL}?latitude=${lat}&longitude=${lng}&localityLanguage=en`
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const data = await res.json()
    const city = (data.city || data.locality || '').toString().trim()
    if (!city) return null
    return {
      city,
      regionCode: (data.principalSubdivisionCode || '')
        .toString()
        .replace(/^US-/, ''),
      regionName: (data.principalSubdivision || '').toString(),
      countryCode: (data.countryCode || '').toString(),
      countryName: (data.countryName || '').toString(),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
