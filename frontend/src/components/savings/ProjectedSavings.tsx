'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle, TrendingDown, ArrowRight, ArrowDown } from 'lucide-react'

import { formatPrice } from '@/lib/constants'
import { reveal } from '@/lib/motion'
import AnimatedCounter from '@/components/ui/AnimatedCounter'

interface ProjectedSavingsProps {
  verdict: 'overcharge' | 'high' | 'fair'
  quotedPrice: number | null
  fairPriceHigh: number
  fairPriceLow: number
  dataPointsCount: number
  locationCity: string
  queryId: string
}

const VERDICT_CONFIG = {
  overcharge: {
    label: "You're overpaying",
    colorClass: 'savings-overcharge',
    icon: AlertTriangle,
    ctaText: 'Get Negotiation Script',
    ctaIcon: ArrowRight,
    ctaPrefix: '/negotiate/',
    isAnchor: false,
  },
  high: {
    label: 'You could save',
    colorClass: 'savings-high',
    icon: TrendingDown,
    ctaText: 'Get Negotiation Script',
    ctaIcon: ArrowRight,
    ctaPrefix: '/negotiate/',
    isAnchor: false,
  },
  fair: {
    label: 'Good news — your price is fair',
    colorClass: 'savings-fair',
    icon: CheckCircle,
    ctaText: 'View Full Analysis',
    ctaIcon: ArrowDown,
    ctaPrefix: '#analysis',
    isAnchor: true,
  },
} as const

export default function ProjectedSavings({
  verdict,
  quotedPrice,
  fairPriceHigh,
  fairPriceLow,
  dataPointsCount,
  locationCity,
  queryId,
}: ProjectedSavingsProps) {
  const config = VERDICT_CONFIG[verdict]
  const Icon = config.icon
  const CtaIcon = config.ctaIcon

  const hasSavings = quotedPrice !== null && quotedPrice > fairPriceHigh
  const savingsAmount = hasSavings ? quotedPrice - fairPriceHigh : 0

  const ctaHref = config.isAnchor ? config.ctaPrefix : `${config.ctaPrefix}${queryId}`

  return (
    <motion.div {...reveal(0)} className={`savings-hero ${config.colorClass}`}>
      <div className="glass-strong rounded-2xl p-6 md:p-8">
        <div className="flex items-center gap-3 mb-4">
          <Icon className="h-6 w-6" />
          <span className="text-[var(--type-16)] font-semibold">
            {verdict === 'fair' ? config.label : config.label}
          </span>
        </div>

        {verdict !== 'fair' && hasSavings ? (
          <p className="savings-amount number-pop">
            <AnimatedCounter
              target={savingsAmount / 100}
              prefix="$"
              duration={1.2}
              formatFn={(v) => v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            />
          </p>
        ) : verdict === 'fair' ? (
          <p className="savings-amount">
            <CheckCircle className="inline-block h-10 w-10 mr-3 align-middle" />
            Fair Price
          </p>
        ) : (
          <p className="savings-amount">
            {formatPrice(fairPriceLow)} &ndash; {formatPrice(fairPriceHigh)}
          </p>
        )}

        <p className="mt-3 text-[var(--type-14)] text-[var(--text-3)]">
          Based on {dataPointsCount} live market data points in {locationCity}
        </p>

        {config.isAnchor ? (
          <a
            href={ctaHref}
            className="ui-button-primary mt-6 inline-flex items-center gap-2 px-5 py-3"
          >
            {config.ctaText}
            <CtaIcon className="h-4 w-4" />
          </a>
        ) : (
          <Link
            href={ctaHref}
            className="ui-button-primary mt-6 inline-flex items-center gap-2 px-5 py-3"
          >
            {config.ctaText}
            <CtaIcon className="h-4 w-4" />
          </Link>
        )}
      </div>
    </motion.div>
  )
}
