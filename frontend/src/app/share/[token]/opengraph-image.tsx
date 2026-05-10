import { ImageResponse } from 'next/og'

export const alt = 'Faivri — shared price verdict'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface PublicShare {
  kind: 'query' | 'purchase'
  domain: string
  currency: string
  quoted_price_cents: number | null
  fair_low_cents: number | null
  fair_high_cents: number | null
  overcharge_multiplier: number | null
  verdict: string | null
  title: string
  subtitle: string | null
}

async function fetchShare(token: string): Promise<PublicShare | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/share/${encodeURIComponent(token)}`,
      { next: { revalidate: 300 } },
    )
    if (!res.ok) return null
    return (await res.json()) as PublicShare
  } catch {
    return null
  }
}

function fmt(amount: number | null): string | null {
  if (amount == null) return null
  return '$' + Math.round(amount / 100).toLocaleString('en-US')
}

function verdictTone(verdict: string | null) {
  switch (verdict) {
    case 'overcharge':
    case 'overpriced':
      return { label: 'OVERCHARGE', text: '#7C2D12', bg: 'rgba(248, 113, 113, 0.18)' }
    case 'high':
      return { label: 'HIGH', text: '#854D0E', bg: 'rgba(245, 158, 11, 0.18)' }
    case 'fair':
    case 'fairly_priced':
      return { label: 'FAIR', text: '#065F46', bg: 'rgba(16, 185, 129, 0.18)' }
    case 'low':
    case 'great_deal':
      return { label: 'GREAT DEAL', text: '#1E3A8A', bg: 'rgba(59, 130, 246, 0.18)' }
    default:
      return { label: 'VERIFIED', text: '#1A1814', bg: 'rgba(0,0,0,0.06)' }
  }
}

export default async function OGImage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const data = await fetchShare(token)

  const title = data?.title || 'Faivri price check'
  const subtitle = data?.subtitle || ''
  const tone = verdictTone(data?.verdict ?? null)

  const quoted = fmt(data?.quoted_price_cents ?? null)
  const fairLow = fmt(data?.fair_low_cents ?? null)
  const fairHigh = fmt(data?.fair_high_cents ?? null)
  const fairRange = fairLow && fairHigh ? `${fairLow} – ${fairHigh}` : null
  const overpay =
    data?.quoted_price_cents != null &&
    data?.fair_high_cents != null &&
    data.quoted_price_cents > data.fair_high_cents
      ? data.quoted_price_cents - data.fair_high_cents
      : null
  const overpayText = overpay ? `${fmt(overpay)} over fair` : null

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '72px',
          background:
            'linear-gradient(135deg, #FDFBF6 0%, #F4F0E8 50%, #E8DFCF 100%)',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 26,
              fontWeight: 800,
            }}
          >
            F
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#1A1814',
              letterSpacing: -0.4,
            }}
          >
            Faivri
          </div>
          <div
            style={{
              marginLeft: 'auto',
              fontSize: 18,
              color: '#5C5649',
              fontWeight: 600,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            Shared price verdict
          </div>
        </div>

        <div
          style={{
            marginTop: 56,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              padding: '10px 22px',
              borderRadius: 999,
              background: tone.bg,
              color: tone.text,
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: 2,
            }}
          >
            {tone.label}
          </div>
          {overpayText && (
            <div
              style={{
                display: 'flex',
                fontSize: 22,
                fontWeight: 600,
                color: '#7C2D12',
              }}
            >
              {overpayText}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 22,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              fontSize: 76,
              fontWeight: 800,
              color: '#1A1814',
              lineHeight: 1.05,
              letterSpacing: -1.5,
              maxWidth: 1056,
              display: 'flex',
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                fontSize: 28,
                fontWeight: 500,
                color: '#5C5649',
                marginTop: 12,
                display: 'flex',
              }}
            >
              {subtitle}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 42,
            display: 'flex',
            gap: 28,
          }}
        >
          {quoted && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '20px 28px',
                background: 'white',
                borderRadius: 20,
                minWidth: 260,
                boxShadow: '0 10px 30px rgba(26, 24, 20, 0.08)',
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#5C5649',
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                }}
              >
                Quoted
              </div>
              <div
                style={{
                  fontSize: 48,
                  fontWeight: 800,
                  color: '#1A1814',
                  marginTop: 4,
                  letterSpacing: -1,
                }}
              >
                {quoted}
              </div>
            </div>
          )}
          {fairRange && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '20px 28px',
                background: 'white',
                borderRadius: 20,
                minWidth: 320,
                boxShadow: '0 10px 30px rgba(26, 24, 20, 0.08)',
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#5C5649',
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                }}
              >
                Fair range
              </div>
              <div
                style={{
                  fontSize: 48,
                  fontWeight: 800,
                  color: '#1A1814',
                  marginTop: 4,
                  letterSpacing: -1,
                }}
              >
                {fairRange}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 56,
            left: 72,
            right: 72,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 22,
            color: '#5C5649',
            fontWeight: 600,
          }}
        >
          <div style={{ display: 'flex' }}>faivri.com</div>
          <div style={{ display: 'flex' }}>Live market comps · AI synthesis</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
