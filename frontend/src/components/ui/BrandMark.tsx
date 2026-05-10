import Image from 'next/image'

type Size = 'sm' | 'md' | 'lg'

const SIZE_MAP: Record<Size, { box: string; img: number }> = {
  sm: { box: 'h-7 w-7', img: 28 },
  md: { box: 'h-9 w-9', img: 36 },
  lg: { box: 'h-12 w-12', img: 48 },
}

type BrandMarkProps = {
  size?: Size
  className?: string
  priority?: boolean
}

export default function BrandMark({ size = 'md', className = '', priority = false }: BrandMarkProps) {
  const { box, img } = SIZE_MAP[size]
  return (
    <span
      className={`relative inline-flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#F7F7F5] ring-1 ring-[rgba(55,53,47,0.12)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
    >
      <Image
        src="/faivri-logo.svg"
        alt="Faivri"
        width={img}
        height={img}
        priority={priority}
        className="h-[78%] w-[78%] object-contain"
      />
    </span>
  )
}
