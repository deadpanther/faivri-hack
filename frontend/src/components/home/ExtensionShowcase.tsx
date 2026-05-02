'use client'

import Image from 'next/image'
import { useRef } from 'react'
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from 'framer-motion'
import {
  BellRing,
  Check,
  Globe,
  MessageSquareText,
  Puzzle,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'

import { scrollReveal, scrollStagger, SPRING_BOUNCE, EASE, DUR } from '@/lib/motion'
import { CHROME_EXTENSION_URL } from '@/lib/constants'

const EVIDENCE_DOMAINS = [
  'ebay.com',
  'facebook.com/marketplace',
  'mercari.com',
  'poshmark.com',
  'offerup.com',
]

const PRO_FEATURES = [
  {
    icon: ShieldAlert,
    color: 'var(--red)',
    label: 'Seller Risk Score',
    desc:
      'Before you message the seller, see their account age, repost patterns, stock-photo reuse, and average markup. A 0–100 score with reasons — not just a price check.',
    bullets: ['Account age & history', 'Repost & relisting signals', 'Image reuse detection'],
  },
  {
    icon: BellRing,
    color: 'var(--amber)',
    label: 'Stale-Listing Alerts',
    desc:
      'Watch a listing, get a Chrome notification when the price drops or it crosses the domain median age. Your offer lands when the seller is ready to move — not before.',
    bullets: ['Auto price-drop watch', 'Aged-listing negotiation prompts', 'Works while you browse'],
  },
  {
    icon: MessageSquareText,
    color: 'var(--blue)',
    label: 'Conversational Reply Coach',
    desc:
      'Not a one-shot script. A persistent chat panel that remembers the thread, the fair range, and your tone — polite, firm, or walk-away — so you can go back-and-forth with the seller confidently.',
    bullets: ['Multi-turn chat memory', 'Tone toggle per reply', 'Anchored to fair range'],
  },
] as const

export default function ExtensionShowcase() {
  const reduceMotion = useReducedMotion()
  const cardRef = useRef<HTMLElement | null>(null)

  // Pointer-tracked 3D tilt for the listing card.
  const rotX = useMotionValue(0)
  const rotY = useMotionValue(0)
  const glowX = useMotionValue(50)
  const glowY = useMotionValue(30)
  const springRotX = useSpring(rotX, { stiffness: 160, damping: 20, mass: 0.6 })
  const springRotY = useSpring(rotY, { stiffness: 160, damping: 20, mass: 0.6 })
  const springGlowX = useSpring(glowX, { stiffness: 120, damping: 24 })
  const springGlowY = useSpring(glowY, { stiffness: 120, damping: 24 })

  const glowBg = useTransform(
    [springGlowX, springGlowY],
    ([x, y]) =>
      `radial-gradient(520px circle at ${x}% ${y}%, color-mix(in srgb, var(--amber) 22%, transparent) 0%, transparent 55%)`,
  )

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (reduceMotion) return
    const target = cardRef.current
    if (!target) return
    const rect = target.getBoundingClientRect()
    const relX = (event.clientX - rect.left) / rect.width
    const relY = (event.clientY - rect.top) / rect.height
    rotY.set((relX - 0.5) * 6)
    rotX.set((0.5 - relY) * 4)
    glowX.set(relX * 100)
    glowY.set(relY * 100)
  }

  const resetTilt = () => {
    rotX.set(0)
    rotY.set(0)
    glowX.set(50)
    glowY.set(30)
  }

  return (
    <section className="ui-section relative overflow-hidden">
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px]"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 0.75 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 1.1, ease: EASE.out }}
        style={{
          background:
            'radial-gradient(60% 70% at 50% 0%, color-mix(in srgb, var(--amber) 22%, transparent) 0%, transparent 72%)',
        }}
      />
      <div className="ui-container">
        <motion.div {...scrollReveal(0)} className="text-center mb-12">
          <p className="ui-kicker justify-center">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Chrome extension
          </p>
          <h2 className="ui-title-section mt-3 text-[var(--text-1)]">
            One click on any listing.
            <br className="hidden sm:inline" /> A fair verdict in seconds.
          </h2>
          <p className="ui-lead mt-3 mx-auto text-center">
            The Faivri pill sits top-right on eBay and Facebook Marketplace — live
            web search checks the listing against real comparable sales.
          </p>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr,1fr]">
          <motion.article
            ref={cardRef}
            {...scrollStagger(0.05)}
            onPointerMove={handlePointerMove}
            onPointerLeave={resetTilt}
            style={{
              rotateX: springRotX,
              rotateY: springRotY,
              transformPerspective: 1200,
              transformStyle: 'preserve-3d',
            }}
            className="glass relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] shadow-[var(--shadow-lg)] will-change-transform"
          >
            <motion.div
              aria-hidden
              style={{ background: glowBg }}
              className="pointer-events-none absolute inset-0 -z-0 opacity-80 transition-opacity"
            />

            <div className="relative flex items-center gap-2 border-b border-[var(--border)] bg-[var(--warm-bg-secondary)]/90 px-4 py-3 backdrop-blur">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
              </div>
              <div className="ml-3 flex-1 rounded-md border border-[var(--border)] bg-[var(--warm-bg)] px-3 py-1 text-[var(--type-12)] text-[var(--text-3)]">
                <span className="text-[var(--text-4)]">https://</span>
                facebook.com/marketplace/item/1…
              </div>
              <motion.div
                initial={{ rotate: -20, opacity: 0 }}
                whileInView={{ rotate: 0, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4, duration: DUR.normal, ease: EASE.spring }}
              >
                <Puzzle className="h-4 w-4 text-[var(--text-3)]" />
              </motion.div>
            </div>

            <div className="relative p-5">
              <div className="grid gap-4 md:grid-cols-[160px,1fr] items-start">
                <motion.div
                  initial={{ opacity: 0, scale: 0.94 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ duration: DUR.slow, ease: EASE.out, delay: 0.1 }}
                  className="relative aspect-[4/5] w-full max-w-[200px] mx-auto md:mx-0 md:max-w-none md:w-[160px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] shadow-[var(--shadow-sm)]"
                >
                  <Image
                    src="/images/listing-bag.jpg"
                    alt="Brown leather handbag product photo used as marketplace listing"
                    fill
                    sizes="(min-width: 768px) 160px, 200px"
                    className="object-cover"
                    loading="lazy"
                    placeholder="blur"
                    blurDataURL="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0IDUiPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjUiIGZpbGw9IiNlOGRkY2IiLz48L3N2Zz4="
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-white/5" />
                </motion.div>
                <div>
                  <p className="text-[var(--type-12)] uppercase tracking-[0.08em] text-[var(--text-4)]">
                    Facebook Marketplace
                  </p>
                  <p className="mt-1 font-display text-[var(--type-18)] font-semibold text-[var(--text-1)]">
                    Louis Vuitton Neverfull MM — used, good condition
                  </p>
                  <motion.p
                    initial={{ opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.25, duration: DUR.normal, ease: EASE.out }}
                    className="mt-2 font-display text-[clamp(1.6rem,3vw,2rem)] font-bold text-[var(--text-1)]"
                  >
                    $500
                  </motion.p>
                  <p className="mt-2 text-[var(--type-14)] text-[var(--text-3)]">
                    Listed 2 hrs ago · Brooklyn, NY
                  </p>
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.92 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ ...SPRING_BOUNCE, delay: 0.45 }}
                whileHover={reduceMotion ? undefined : { scale: 1.04 }}
                className="absolute right-5 top-[4.5rem] flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--text-1)] px-3 py-1.5 text-[var(--type-12)] font-semibold text-white shadow-[var(--shadow-md)]"
              >
                <motion.span
                  animate={reduceMotion ? undefined : { rotate: [0, -8, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 1.2 }}
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-[var(--green)]" />
                </motion.span>
                Faivri · Fair $400–$480
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: DUR.slow, ease: EASE.out, delay: 0.55 }}
                className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)]/85 p-4 backdrop-blur"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[var(--type-12)] uppercase tracking-[0.08em] text-[var(--text-4)]">
                    Faivri verdict
                  </p>
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ ...SPRING_BOUNCE, delay: 0.7 }}
                    className="rounded-full border border-[var(--border)] bg-[var(--warm-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-3)]"
                  >
                    Slightly high
                  </motion.span>
                </div>
                <p className="mt-2 text-[var(--type-14)] text-[var(--text-2)]">
                  Fair range{' '}
                  <span className="font-semibold text-[var(--text-1)]">$400 – $480</span> based on
                  14 recent sold comps. Counter at{' '}
                  <span className="font-semibold text-[var(--text-1)]">$440</span> — 12% below
                  listing.
                </p>
                <motion.div
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  transition={{ staggerChildren: 0.05, delayChildren: 0.8 }}
                  className="mt-3 flex flex-wrap gap-1.5"
                >
                  {EVIDENCE_DOMAINS.map((d) => (
                    <motion.span
                      key={d}
                      variants={{
                        hidden: { opacity: 0, y: 6, scale: 0.9 },
                        visible: {
                          opacity: 1,
                          y: 0,
                          scale: 1,
                          transition: { duration: DUR.normal, ease: EASE.spring },
                        },
                      }}
                      whileHover={reduceMotion ? undefined : { y: -2 }}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--warm-bg)] px-2 py-0.5 text-[11px] text-[var(--text-3)]"
                    >
                      <Globe className="h-2.5 w-2.5" />
                      {d}
                    </motion.span>
                  ))}
                </motion.div>
              </motion.div>
            </div>
          </motion.article>

          <motion.article
            {...scrollStagger(0.1)}
            className="glass flex flex-col gap-5 rounded-2xl p-6"
          >
            <div>
              <p className="ui-kicker">How it works</p>
              <h3 className="mt-2 font-display text-[var(--type-18)] font-semibold text-[var(--text-1)]">
                Live web search, not a database.
              </h3>
              <p className="mt-2 text-[var(--type-14)] text-[var(--text-3)]">
                When you open a listing, the extension triggers a real-time search across
                used-market domains. The fair range uses the actual sold comps — not stale MSRP.
              </p>
            </div>

            <motion.ul
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-40px' }}
              transition={{ staggerChildren: 0.08, delayChildren: 0.1 }}
              className="space-y-3 text-[var(--type-14)] text-[var(--text-2)]"
            >
              {[
                {
                  Icon: Search,
                  color: 'text-[var(--blue)]',
                  text: 'Detects the platform (eBay or Facebook Marketplace) and weights comps accordingly.',
                },
                {
                  Icon: Check,
                  color: 'text-[var(--green)]',
                  text: 'Returns a fair range, not a single number — every number cites its source domain.',
                },
                {
                  Icon: ShieldCheck,
                  color: 'text-[var(--text-1)]',
                  text: 'Counter-offer anchored below the listing price — never above what the seller already asks.',
                },
              ].map(({ Icon, color, text }, i) => (
                <motion.li
                  key={i}
                  variants={{
                    hidden: { opacity: 0, x: -10 },
                    visible: {
                      opacity: 1,
                      x: 0,
                      transition: { duration: DUR.normal, ease: EASE.out },
                    },
                  }}
                  className="flex items-start gap-2"
                >
                  <Icon className={`mt-0.5 h-4 w-4 ${color}`} />
                  <span>{text}</span>
                </motion.li>
              ))}
            </motion.ul>

            <motion.div
              whileHover={reduceMotion ? undefined : { y: -2 }}
              transition={{ duration: DUR.fast, ease: EASE.out }}
              className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-4"
            >
              <p className="text-[var(--type-12)] uppercase tracking-[0.08em] text-[var(--text-4)]">
                Conversation coach
              </p>
              <p className="mt-2 text-[var(--type-14)] text-[var(--text-2)]">
                After the seller replies, drop their message into the extension chat and get the
                next text to send — anchored to your fair range.
              </p>
            </motion.div>
          </motion.article>
        </div>

        <motion.div
          {...scrollReveal(0.1)}
          className="mt-16 text-center"
        >
          <p className="ui-kicker justify-center">
            <Puzzle className="h-3.5 w-3.5" aria-hidden />
            Extension Pro · add-on
          </p>
          <h3 className="ui-title-section mt-3 text-[var(--text-1)]">
            Go beyond the price check.
          </h3>
          <p className="ui-lead mt-3 mx-auto text-center">
            Three Pro features that turn the extension from a one-shot lookup into
            a live negotiation partner with richer live market intelligence.
          </p>
        </motion.div>

        <motion.ul
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          transition={{ staggerChildren: 0.1, delayChildren: 0.1 }}
          className="mt-8 grid gap-5 md:grid-cols-3"
        >
          {PRO_FEATURES.map(({ icon: Icon, color, label, desc, bullets }) => (
            <motion.li
              key={label}
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: DUR.slow, ease: EASE.out },
                },
              }}
              whileHover={reduceMotion ? undefined : { y: -4 }}
              className="glass relative flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-6 shadow-[var(--shadow-sm)]"
            >
              <div
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl"
                style={{
                  background: `color-mix(in srgb, ${color} 14%, transparent)`,
                  color,
                }}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-display text-[var(--type-16)] font-semibold text-[var(--text-1)]">
                  {label}
                </p>
                <p className="mt-2 text-[var(--type-14)] text-[var(--text-3)]">{desc}</p>
              </div>
              <ul className="mt-auto space-y-1.5">
                {bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2 text-[var(--type-13)] text-[var(--text-2)]"
                  >
                    <Check className="mt-0.5 h-3.5 w-3.5 text-[var(--green)]" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </motion.li>
          ))}
        </motion.ul>

        <motion.div
          {...scrollReveal(0.2)}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <a
            href={CHROME_EXTENSION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--text-1)] px-5 py-2.5 text-[var(--type-14)] font-semibold text-white transition-colors hover:bg-black"
          >
            <Puzzle className="h-4 w-4" />
            Add to Chrome
          </a>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--warm-bg)] px-5 py-2.5 text-[var(--type-14)] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--warm-bg-secondary)]"
          >
            See Extension Pro pricing
          </Link>
          <span className="text-[var(--type-12)] text-[var(--text-4)]">
            $12.99/month add-on · eBay + Facebook Marketplace
          </span>
        </motion.div>
      </div>
    </section>
  )
}
