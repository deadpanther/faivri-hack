import { NextResponse } from 'next/server'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

// Country → friendly tax-hint string. Hand-tuned to surface the rate the
// user will most likely see at checkout. The actual tax is computed by
// Stripe Tax against the billing address — this is purely UX so the
// price feels honest before the user clicks through.
const TAX_HINTS: Record<string, { label: string; estPct: number | null }> = {
  IN: { label: '+ 18% GST', estPct: 18 },
  GB: { label: '+ 20% VAT', estPct: 20 },
  IE: { label: '+ 23% VAT', estPct: 23 },
  DE: { label: '+ 19% VAT', estPct: 19 },
  FR: { label: '+ 20% VAT', estPct: 20 },
  ES: { label: '+ 21% VAT', estPct: 21 },
  IT: { label: '+ 22% VAT', estPct: 22 },
  NL: { label: '+ 21% VAT', estPct: 21 },
  SE: { label: '+ 25% VAT', estPct: 25 },
  AU: { label: '+ 10% GST', estPct: 10 },
  NZ: { label: '+ 15% GST', estPct: 15 },
  CA: { label: '+ 5–15% GST/HST', estPct: 13 },
  SG: { label: '+ 9% GST', estPct: 9 },
  AE: { label: '+ 5% VAT', estPct: 5 },
  JP: { label: '+ 10% consumption tax', estPct: 10 },
  US: { label: '+ sales tax (varies by state)', estPct: null },
}

const DEFAULT_HINT = { label: '+ tax may apply', estPct: null }

interface GeoResponse {
  country: string | null
  region: string | null
  city: string | null
  tax_hint_label: string
  tax_hint_pct: number | null
}

export async function GET(req: Request): Promise<Response> {
  const headers = req.headers
  const country =
    headers.get('x-vercel-ip-country') ||
    headers.get('cf-ipcountry') ||
    headers.get('x-country-code') ||
    null
  const region = headers.get('x-vercel-ip-country-region') || null
  const city = headers.get('x-vercel-ip-city')
    ? decodeURIComponent(headers.get('x-vercel-ip-city') as string)
    : null

  const hint = (country && TAX_HINTS[country.toUpperCase()]) || DEFAULT_HINT
  const body: GeoResponse = {
    country,
    region,
    city,
    tax_hint_label: hint.label,
    tax_hint_pct: hint.estPct,
  }

  return NextResponse.json(body, {
    headers: {
      // Cache per-user briefly at the edge — geo never changes mid-session.
      'cache-control': 'private, max-age=300',
    },
  })
}
