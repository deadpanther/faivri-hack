/**
 * Diligence questionnaire schema — kept in sync with the backend
 * `purchase_diligence.DiligenceAnswers` dataclass. Each group renders
 * collapsibly on the form so users can answer what they know without
 * being forced through irrelevant questions.
 */

export type DiligenceFieldType = 'select' | 'number' | 'textarea'

export interface DiligenceField {
  key: string
  label: string
  helper?: string
  type: DiligenceFieldType
  options?: { value: string; label: string }[]
  placeholder?: string
  numericMin?: number
  numericMax?: number
}

export interface DiligenceGroup {
  id: string
  title: string
  subtitle: string
  fields: DiligenceField[]
}

const yesNoUnknown = [
  { value: '', label: '— Not sure —' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

export const DILIGENCE_GROUPS: DiligenceGroup[] = [
  {
    id: 'service',
    title: 'Service history',
    subtitle: "What's been changed, and how regularly. Documented service is the single biggest signal of engine longevity.",
    fields: [
      {
        key: 'oil_change_history',
        label: 'Oil change cadence',
        helper: 'How often was the oil changed?',
        type: 'select',
        options: [
          { value: '', label: '— Not sure —' },
          { value: 'regular', label: 'Regular intervals (every 5–10k km / 3–6k mi)' },
          { value: 'occasional', label: 'Occasionally / sporadically' },
          { value: 'documented', label: 'Documented at every interval' },
          { value: 'unknown', label: "Seller can't say" },
        ],
      },
      {
        key: 'has_service_records',
        label: 'Service records / receipts available?',
        helper: 'Paper records, dealer printouts, or app history.',
        type: 'select',
        options: yesNoUnknown,
      },
      {
        key: 'timing_belt_status',
        label: 'Timing belt status',
        helper: 'Many engines snap if the belt fails. $700–$1,500 to replace.',
        type: 'select',
        options: [
          { value: '', label: '— Not sure —' },
          { value: 'replaced', label: 'Replaced recently (within 10–20k km / 6–12k mi)' },
          { value: 'due_soon', label: 'Due soon (close to interval)' },
          { value: 'overdue', label: 'Overdue (past interval)' },
          { value: 'not_applicable', label: 'Not applicable (chain, not belt)' },
        ],
      },
      {
        key: 'transmission_fluid_changed',
        label: 'Transmission fluid ever changed?',
        type: 'select',
        options: yesNoUnknown,
      },
      {
        key: 'coolant_flush_done',
        label: 'Coolant flushed?',
        type: 'select',
        options: yesNoUnknown,
      },
      {
        key: 'spark_plugs_replaced',
        label: 'Spark plugs replaced?',
        helper: 'Most need replacement around 50–100k km / 30–60k mi.',
        type: 'select',
        options: yesNoUnknown,
      },
    ],
  },
  {
    id: 'wear',
    title: 'Wear items',
    subtitle: 'Tires, brakes, battery — easy to verify visually, expensive to replace.',
    fields: [
      {
        key: 'brake_pads_condition',
        label: 'Brake pads condition',
        type: 'select',
        options: [
          { value: '', label: '— Not sure —' },
          { value: 'new', label: 'New / recently replaced' },
          { value: 'good', label: 'Good (>5mm thickness)' },
          { value: 'worn', label: 'Worn (3–5mm)' },
          { value: 'needs_replacement', label: 'Needs replacement (<3mm)' },
        ],
      },
      {
        key: 'tires_condition',
        label: 'Tires condition',
        helper: 'Penny test: insert head-down — if you can see all of Lincoln, tread is too low.',
        type: 'select',
        options: [
          { value: '', label: '— Not sure —' },
          { value: 'new', label: 'New (<5k mi)' },
          { value: 'good', label: 'Good tread depth' },
          { value: 'worn', label: 'Worn but legal' },
          { value: 'needs_replacement', label: 'Needs replacement' },
        ],
      },
      {
        key: 'tires_age_years',
        label: 'Tire age (years)',
        helper: 'DOT date code on sidewall. Rubber ages out at 6+ years regardless of tread.',
        type: 'number',
        numericMin: 0,
        numericMax: 25,
        placeholder: 'e.g. 4',
      },
      {
        key: 'battery_age_years',
        label: 'Battery age (years)',
        helper: 'Most batteries last 3–5 years.',
        type: 'number',
        numericMin: 0,
        numericMax: 20,
        placeholder: 'e.g. 3',
      },
    ],
  },
  {
    id: 'history',
    title: 'Title & history',
    subtitle: 'Title status and accident history are the biggest single price levers.',
    fields: [
      {
        key: 'title_status',
        label: 'Title status',
        helper: 'Clean = standard. Salvage/rebuilt knock 20–40% off market. Lemon = legally must be disclosed.',
        type: 'select',
        options: [
          { value: '', label: '— Not sure (ask to see the actual title) —' },
          { value: 'clean', label: 'Clean' },
          { value: 'salvage', label: 'Salvage' },
          { value: 'rebuilt', label: 'Rebuilt' },
          { value: 'lemon', label: 'Lemon-law buyback' },
          { value: 'unknown', label: "Seller won't show / can't confirm" },
        ],
      },
      {
        key: 'accident_history',
        label: 'Reported accidents',
        type: 'select',
        options: [
          { value: '', label: '— Not sure —' },
          { value: 'none', label: 'None reported' },
          { value: 'minor', label: 'Minor (cosmetic / fender bender)' },
          { value: 'major', label: 'Major (frame / airbag deployed)' },
          { value: 'unknown', label: 'Unknown / seller evasive' },
        ],
      },
      {
        key: 'previous_owners',
        label: 'Previous owners',
        type: 'number',
        numericMin: 1,
        numericMax: 12,
        placeholder: 'e.g. 2',
      },
      {
        key: 'has_carfax',
        label: 'Carfax / AutoCheck report available?',
        helper: "Always pull one yourself ($25–$45). Don't trust seller's screenshot.",
        type: 'select',
        options: yesNoUnknown,
      },
    ],
  },
  {
    id: 'behavior',
    title: 'Drive & behavior signals',
    subtitle: 'During the test drive: eyes on the exhaust, ear on the engine, scanner on the OBD-II port.',
    fields: [
      {
        key: 'smoking_on_start',
        label: 'Smokes on cold start?',
        helper: 'Blue/grey smoke = engine wear. White smoke = head gasket. Both mean $2k+ work.',
        type: 'select',
        options: yesNoUnknown,
      },
      {
        key: 'burning_oil',
        label: 'Burns oil between changes?',
        helper: 'Ask: "Do you have to top up oil between services?"',
        type: 'select',
        options: yesNoUnknown,
      },
      {
        key: 'check_engine_history',
        label: 'Any check-engine light history?',
        helper: 'Cleared codes often return. Plug in an OBD-II scanner before buying.',
        type: 'select',
        options: yesNoUnknown,
      },
      {
        key: 'has_modifications',
        label: 'Aftermarket modifications?',
        helper: 'Tuner, exhaust, lift, lowering — voids some warranties, hurts resale.',
        type: 'select',
        options: yesNoUnknown,
      },
    ],
  },
  {
    id: 'context',
    title: 'Seller & context',
    subtitle: "Who you're buying from changes the negotiation playbook + scam risk.",
    fields: [
      {
        key: 'seller_type',
        label: 'Seller type',
        type: 'select',
        options: [
          { value: '', label: '— Not sure —' },
          { value: 'private', label: 'Private party' },
          { value: 'dealer', label: 'Dealership' },
        ],
      },
      {
        key: 'reason_for_selling',
        label: 'Reason for selling',
        helper: 'Open-ended — moving, upgrading, or "needs work" all tell you something.',
        type: 'textarea',
        placeholder: 'e.g. Upgrading to a truck for work',
      },
    ],
  },
]

export const EMPTY_DILIGENCE: Record<string, string> = DILIGENCE_GROUPS.flatMap(
  (g) => g.fields,
).reduce<Record<string, string>>((acc, f) => {
  acc[f.key] = ''
  return acc
}, {})

/**
 * Convert the form's string-only state into the typed payload the backend
 * expects. Empty strings drop out (we don't send unanswered questions),
 * yes/no maps to booleans, numerics parse to ints.
 */
export function normalizeDiligence(
  raw: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(raw)) {
    if (val === '' || val === null || val === undefined) continue
    if (val === 'yes') {
      out[key] = true
      continue
    }
    if (val === 'no') {
      out[key] = false
      continue
    }
    if (key.endsWith('_years') || key === 'previous_owners') {
      const n = parseInt(val, 10)
      if (!Number.isNaN(n)) out[key] = n
      continue
    }
    out[key] = val
  }
  return out
}
