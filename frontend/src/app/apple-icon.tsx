import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default async function AppleIcon() {
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
          fontSize: 120,
          fontWeight: 800,
          letterSpacing: -6,
        }}
      >
        F
      </div>
    ),
    { ...size }
  )
}
