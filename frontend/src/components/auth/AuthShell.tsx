import Link from 'next/link'
import { ShieldCheck, Sparkles } from 'lucide-react'

interface AuthShellProps {
  kicker: string
  title: string
  description: string
  panelTitle: string
  bullets: string[]
  backLabel: string
  backHref: string
  children: React.ReactNode
}

export function AuthShell({
  kicker,
  title,
  description,
  panelTitle,
  bullets,
  backLabel,
  backHref,
  children,
}: AuthShellProps) {
  return (
    <section className="ui-section min-h-[calc(100svh-var(--nav-clearance,66px))] overflow-x-hidden pt-6 md:pt-10">
      <div className="ui-container grid items-center gap-6 sm:gap-8 lg:grid-cols-[0.96fr_1.04fr]">
        <div className="min-w-0 space-y-4 sm:space-y-5">
          <p className="ui-kicker">
            <Sparkles className="h-3.5 w-3.5" />
            {kicker}
          </p>

          <h1 className="ui-title-section text-gradient-hero break-words">{title}</h1>
          <p className="ui-lead max-w-md break-words">{description}</p>

          <div className="ui-surface perspective-stack rounded-2xl p-4">
            <p className="text-[var(--type-16)] font-semibold text-[var(--text-1)]">{panelTitle}</p>
            <ul className="mt-2 space-y-2">
              {bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2 text-[var(--type-14)] text-[var(--text-3)]">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--green)]" />
                  <span className="min-w-0 break-words">{bullet}</span>
                </li>
              ))}
            </ul>
          </div>

          <Link href={backHref} className="ui-button-secondary inline-flex items-center">
            {backLabel}
          </Link>
        </div>

        <div className="ui-surface-strong perspective-stack mx-auto w-full min-w-0 max-w-md overflow-hidden rounded-2xl p-3 sm:rounded-3xl sm:p-6">
          {children}
        </div>
      </div>
    </section>
  )
}
