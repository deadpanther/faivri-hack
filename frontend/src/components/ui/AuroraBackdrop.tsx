type AuroraTone = 'warm' | 'cool' | 'mint'

interface AuroraBackdropProps {
  tone?: AuroraTone
  className?: string
}

const TONES: Record<AuroraTone, [string, string, string]> = {
  warm: ['rgba(217, 115, 13, 0.24)', 'rgba(35, 131, 226, 0.2)', 'rgba(15, 123, 108, 0.16)'],
  cool: ['rgba(35, 131, 226, 0.24)', 'rgba(154, 109, 215, 0.2)', 'rgba(15, 123, 108, 0.16)'],
  mint: ['rgba(15, 123, 108, 0.24)', 'rgba(35, 131, 226, 0.18)', 'rgba(217, 115, 13, 0.12)'],
}

export default function AuroraBackdrop({ tone = 'warm', className = '' }: AuroraBackdropProps) {
  const [a, b, c] = TONES[tone]

  return (
    <div aria-hidden className={`aurora-backdrop ${className}`}>
      <span
        className="aurora-orb aurora-orb-a"
        style={{ background: `radial-gradient(circle at 35% 35%, ${a} 0%, transparent 72%)` }}
      />
      <span
        className="aurora-orb aurora-orb-b"
        style={{ background: `radial-gradient(circle at 65% 35%, ${b} 0%, transparent 72%)` }}
      />
      <span
        className="aurora-orb aurora-orb-c"
        style={{ background: `radial-gradient(circle at 50% 50%, ${c} 0%, transparent 72%)` }}
      />
      <span className="aurora-grid" />
    </div>
  )
}
