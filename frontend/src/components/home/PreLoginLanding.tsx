'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  ShieldCheck,
  Wrench,
  Pill,
  Home,
  Scale,
  ShoppingBag,
  TrendingDown,
  Search,
  Upload,
  BarChart3,
  MessageSquare,
  CreditCard,
  Lock,
  Brain,
  Cpu,
  Database,
  Sparkles,
  Video,
} from 'lucide-react'
import { SignUpButton } from '@clerk/nextjs'

import {
  scrollReveal,
  scrollStagger,
  scaleIn,
  reveal,
  heroReveal,
} from '@/lib/motion'
import TextScramble from '@/components/ui/TextScramble'
import MagneticButton from '@/components/ui/MagneticButton'
import SplitText from '@/components/ui/SplitText'
import ParallaxText from '@/components/ui/ParallaxText'
import HeroDemoTile from '@/components/home/HeroDemoTile'
import ComparisonRow from '@/components/home/ComparisonRow'
import FaqSection from '@/components/home/FaqSection'
import HowItWorksSteps from '@/components/home/HowItWorksSteps'
import ExtensionShowcase from '@/components/home/ExtensionShowcase'
import UsedCarsShowcase from '@/components/home/UsedCarsShowcase'
import FloatingEvidenceCards from '@/components/ui/FloatingEvidenceCards'

/* ── Domain cards ── */
const DOMAINS = [
  { icon: Wrench, label: 'Auto Repair', desc: 'Brake pads, oil changes, transmission work', color: 'var(--blue)' },
  { icon: Pill, label: 'Medical', desc: 'Prescriptions, lab work, procedures', color: 'var(--green)' },
  { icon: Home, label: 'Home Services', desc: 'Plumbing, electrical, roofing, HVAC', color: 'var(--amber)' },
  { icon: Scale, label: 'Legal', desc: 'Consultations, filings, retainers', color: 'var(--purple)' },
  { icon: ShoppingBag, label: 'Retail & Marketplace', desc: 'Amazon, Costco, eBay sold comps — plus the Chrome extension', color: 'var(--red)' },
]

/* ── How it works steps ── */
const STEPS = [
  { icon: Video, num: '01', title: 'Capture the quote', desc: 'Film a quick clip — invoice, item, or screen. PixVerse turns video into structured fields in seconds.' },
  { icon: Search, num: '02', title: 'GMI Cloud crunches the market', desc: 'Real-time GPU inference cross-references live retail, service, and secondhand pricing.' },
  { icon: BarChart3, num: '03', title: 'See the fair range', desc: 'Side-by-side comparison visual, ranged not pointed — every comp cites its source.' },
  { icon: MessageSquare, num: '04', title: 'Photon drafts the reply', desc: 'Paste the seller\u2019s message, get a polite, data-backed counter you can send verbatim.' },
  { icon: TrendingDown, num: '05', title: 'HydraDB remembers everything', desc: 'Walk-away ceilings, price fluctuations, seller tone \u2014 all stored so the next round picks up where you left off.' },
]

/* ── Partner stack — credited only when the integration ships in this build ── */
const PARTNERS = [
  { icon: Video, label: 'PixVerse', desc: 'Video extraction' },
  { icon: Cpu, label: 'GMI Cloud', desc: 'Real-time GPU inference' },
  { icon: Database, label: 'HydraDB', desc: 'Negotiation memory' },
  { icon: MessageSquare, label: 'Photon', desc: 'Messaging assistant' },
]

export default function PreLoginLanding() {
  return (
    <div className="pb-16">
      {/* ═══════════════════ HERO ═══════════════════ */}
      <section className="ui-section relative overflow-hidden" style={{ paddingTop: 'clamp(24px, 8vw, 100px)', paddingBottom: 'clamp(32px, 8vw, 80px)' }}>
        {/* Aurora backdrop — soft, animated, motion-respecting */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          style={{
            background:
              'radial-gradient(48% 60% at 20% 12%, color-mix(in srgb, var(--amber) 22%, transparent) 0%, transparent 70%), radial-gradient(42% 55% at 82% 8%, color-mix(in srgb, var(--blue) 18%, transparent) 0%, transparent 72%), radial-gradient(70% 40% at 50% 0%, color-mix(in srgb, var(--warm-bg-secondary) 100%, transparent) 0%, transparent 70%)',
          }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] motion-reduce:hidden"
          animate={{ backgroundPosition: ['0% 0%', '100% 20%', '0% 0%'] }}
          transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
          style={{
            backgroundImage:
              'radial-gradient(32% 28% at 30% 18%, color-mix(in srgb, var(--amber) 10%, transparent) 0%, transparent 60%)',
            backgroundSize: '200% 200%',
            opacity: 0.6,
          }}
        />
        <FloatingEvidenceCards className="opacity-75" />
        <div className="ui-container flex flex-col items-center text-center">
          <motion.div {...reveal(0)} className="ui-kicker">
            <ShieldCheck className="h-3.5 w-3.5" />
            AI-Powered Consumer Protection
          </motion.div>

          <h1 className="ui-title-display mt-6 px-2" style={{ fontSize: 'clamp(2rem, 8vw, 5rem)' }}>
            <TextScramble text="Know if you're being" delay={200} className="block" />
            <TextScramble text="overcharged." delay={600} className="block text-[var(--red)]" />
          </h1>

          <motion.p {...heroReveal(0.5)} className="ui-lead mt-4 max-w-2xl px-2 text-center text-[var(--type-16)] sm:mt-5 sm:text-[var(--type-18)]">
            Check any quote against live market data in seconds.
            Clear numbers, clear confidence, clear next step.
          </motion.p>

          <motion.div {...scaleIn(0.7)} className="mt-6 flex w-full flex-wrap items-center justify-center gap-3 sm:mt-8 sm:w-auto">
            <div className="relative">
              {/* Idle pulse halo that draws the eye without stealing focus */}
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full motion-reduce:hidden"
                animate={{
                  boxShadow: [
                    '0 0 0 0 color-mix(in srgb, var(--amber) 40%, transparent)',
                    '0 0 0 14px color-mix(in srgb, var(--amber) 0%, transparent)',
                    '0 0 0 0 color-mix(in srgb, var(--amber) 0%, transparent)',
                  ],
                }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'easeOut', delay: 1.2 }}
              />
              <SignUpButton>
                <MagneticButton className="btn-primary inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[15px] sm:w-auto sm:px-7 sm:py-3.5 sm:text-base relative">
                  Check Your First Quote — Free
                  <ArrowRight className="h-4 w-4" />
                </MagneticButton>
              </SignUpButton>
            </div>
            <Link href="#how-it-works" className="btn-ghost inline-flex w-full justify-center text-[15px] sm:w-auto sm:text-base">
              See how it works
            </Link>
          </motion.div>

          {/* Trust row — real commitments, not fabricated metrics */}
          <motion.div
            {...reveal(0.85)}
            className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[var(--type-12)] text-[var(--text-3)]"
          >
            <span className="inline-flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5 text-[var(--green)]" aria-hidden />
              No credit card required
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-[var(--green)]" aria-hidden />
              Private by default
            </span>
          </motion.div>

          {/* Live demo tile — shows the product on the landing page */}
          <HeroDemoTile />
        </div>
      </section>

      {/* ═══════════════════ EXTENSION SHOWCASE ═══════════════════ */}
      <ExtensionShowcase />

      {/* ═══════════════════ DOMAINS ═══════════════════ */}
      <section className="ui-section">
        <div className="ui-container">
          <motion.div {...scrollReveal(0)} className="text-center mb-10">
            <p className="ui-kicker justify-center">What We Cover</p>
            <SplitText
              text="Every quote. Every listing. One verdict engine."
              className="ui-title-section mt-3 text-[var(--text-1)]"
              as="h2"
              delay={0.15}
            />
            <p className="ui-lead mt-3 mx-auto text-center">
              Auto, medical, home, legal — and any marketplace listing you&apos;re about to buy.
              Benchmarked against live market signals.
            </p>
          </motion.div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {DOMAINS.map((domain, i) => {
              const Icon = domain.icon
              return (
                <motion.article
                  key={domain.label}
                  {...scrollStagger(i * 0.08)}
                  whileHover={{ y: -5 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                  className="group glass hover-lift rounded-2xl p-5 relative overflow-hidden"
                >
                  {/* Colored glow that fades in on hover */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{
                      background: `radial-gradient(120% 60% at 50% 0%, color-mix(in srgb, ${domain.color} 14%, transparent) 0%, transparent 70%)`,
                    }}
                  />
                  <motion.div
                    whileHover={{ rotate: -6, scale: 1.08 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                    className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl"
                    style={{
                      background: `color-mix(in srgb, ${domain.color} 12%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${domain.color} 25%, transparent)`,
                    }}
                  >
                    <Icon className="h-5 w-5" style={{ color: domain.color }} />
                  </motion.div>
                  <h3 className="relative mt-3 font-display text-[var(--type-16)] font-semibold text-[var(--text-1)]">{domain.label}</h3>
                  <p className="relative mt-1 text-[var(--type-14)] text-[var(--text-3)]">{domain.desc}</p>
                </motion.article>
              )
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════════ COMPARISON ═══════════════════ */}
      <ComparisonRow />

      {/* ═══════════════════ USED CARS SHOWCASE ═══════════════════ */}
      <UsedCarsShowcase />

      {/* ═══════════════════ HOW IT WORKS ═══════════════════ */}
      <section id="how-it-works" className="ui-section bg-[var(--warm-bg-secondary)]">
        <div className="ui-container">
          <motion.div {...scrollReveal(0)} className="text-center mb-10">
            <p className="ui-kicker justify-center">How It Works</p>
            <SplitText
              text="Five calm steps."
              className="ui-title-section mt-3 text-[var(--text-1)]"
              as="h2"
              delay={0.15}
            />
          </motion.div>

          <HowItWorksSteps steps={STEPS} />
        </div>
      </section>

      {/* ═══════════════════ FINAL CTA ═══════════════════ */}
      <section className="ui-section">
        <div className="ui-container">
          <motion.div
            {...scrollReveal(0)}
            className="rounded-3xl border border-[var(--border-strong)] bg-[var(--text-1)] p-6 sm:p-10 md:p-14 text-center"
          >
            <ParallaxText speed={-10}>
              <h2 className="font-display text-[clamp(1.5rem,5vw,3rem)] font-bold text-white leading-tight">
                Stop overpaying.<br />Start with one quote.
              </h2>
            </ParallaxText>
            <p className="mt-4 text-[var(--type-14)] sm:text-[var(--type-16)] text-white/60 max-w-lg mx-auto">
              Join Faivri to avoid overpaying on everyday services.
            </p>
            <div className="mt-6 sm:mt-8">
              <SignUpButton>
                <MagneticButton className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 text-[15px] font-semibold text-[var(--text-1)] hover:bg-[var(--warm-bg-secondary)] transition-colors sm:w-auto sm:px-7 sm:py-3.5 sm:text-base">
                  Get Started Free
                  <ArrowRight className="h-4 w-4" />
                </MagneticButton>
              </SignUpButton>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════ FAQ ═══════════════════ */}
      <FaqSection />
    </div>
  )
}
