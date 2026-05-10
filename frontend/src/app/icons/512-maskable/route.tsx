import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

// Maskable icon: subject sits inside the safe zone (~80% of canvas).
// Edges may be clipped by the device's adaptive icon mask, so we leave
// extra padding around the "F" mark and use a full-bleed brand color.
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
          background: '#1A1814',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 240,
          fontWeight: 800,
          letterSpacing: -10,
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
