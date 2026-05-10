'use client'

import { motion } from 'framer-motion'
import { Check } from 'lucide-react'

import { reveal } from '@/lib/motion'

interface AnalysisProgressProps {
  stage: number
  stepLabel: string
}

const STEPS = [
  { number: 1, label: 'Classifying your request' },
  { number: 2, label: 'Fetching local benchmarks' },
  { number: 3, fallbackLabel: 'Synthesizing verdict and actions' },
]

function StepDot({ step, stage }: { step: number; stage: number }) {
  const isCompleted = stage > step
  const isActive = stage >= step && !isCompleted

  if (isCompleted) {
    return <Check className="h-3 w-3" />
  }

  if (isActive) {
    return (
      <div className="h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
    )
  }

  return <>{step}</>
}

function stepStatus(step: number, stage: number): string {
  if (step < 3) {
    if (stage > step) return 'completed'
    if (stage >= step) return 'active'
    return 'pending'
  }
  return stage >= step ? 'active' : 'pending'
}

export function AnalysisProgress({ stage, stepLabel }: AnalysisProgressProps) {
  return (
    <motion.div
      {...reveal(0.06)}
      className="glass perspective-stack loading-timeline mt-4 rounded-xl p-3"
    >
      {STEPS.map((step) => {
        const status = stepStatus(step.number, stage)
        const dotStatus =
          step.number < 3
            ? stage >= step.number
              ? stage > step.number
                ? 'completed'
                : 'active'
              : 'pending'
            : stage >= step.number
              ? 'active'
              : 'pending'

        const label =
          step.number === 3
            ? stepLabel || step.fallbackLabel
            : step.label

        return (
          <div key={step.number} className={`timeline-step ${status}`}>
            <div className={`timeline-dot ${dotStatus}`}>
              <StepDot step={step.number} stage={stage} />
            </div>
            <span>{label}</span>
          </div>
        )
      })}
    </motion.div>
  )
}
