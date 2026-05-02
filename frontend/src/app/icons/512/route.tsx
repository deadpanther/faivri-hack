import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1A1814 0%, #000 100%)',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 340,
          fontWeight: 800,
          letterSpacing: -16,
        }}
      >
        F
      </div>
    ),
    {
      width: 512,
      height: 512,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': 'image/png',
      },
    },
  )
}
