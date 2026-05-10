import { ImageResponse } from 'next/og'

export const alt = 'Faivri — AI-backed price checks with live market sources'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background:
            'linear-gradient(135deg, #FDFBF6 0%, #F4F0E8 50%, #E8DFCF 100%)',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 80,
            left: 80,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            F
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: '#1A1814',
              letterSpacing: -0.5,
            }}
          >
            Faivri
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 40,
          }}
        >
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: '#5C5649',
              letterSpacing: 2,
              textTransform: 'uppercase',
              marginBottom: 24,
            }}
          >
            Pricing Intelligence OS
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 84,
              fontWeight: 800,
              color: '#1A1814',
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 980,
            }}
          >
            <span>Know if you&apos;re being</span>
            <span>overcharged — in ten seconds.</span>
          </div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 500,
              color: '#3E382E',
              marginTop: 28,
              maxWidth: 900,
              lineHeight: 1.4,
            }}
          >
            Live market comps, AI-synthesized verdict, every answer cites its sources.
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 64,
            left: 80,
            right: 80,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 22,
            color: '#5C5649',
            fontWeight: 600,
          }}
        >
          <div style={{ display: 'flex' }}>faivri.com</div>
          <div style={{ display: 'flex' }}>Chrome extension · Web app · API</div>
        </div>
      </div>
    ),
    { ...size }
  )
}
