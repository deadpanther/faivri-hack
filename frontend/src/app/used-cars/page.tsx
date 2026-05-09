'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'

import { api, ApiError, type QuotaExhaustedDetail } from '@/lib/api'
import OutOfAnalysesModal from '@/components/ui/OutOfAnalysesModal'
import { reveal } from '@/lib/motion'
import {
  DILIGENCE_GROUPS,
  EMPTY_DILIGENCE,
  normalizeDiligence,
  type DiligenceField,
} from '@/components/used-cars/diligence-config'

const FIELD_CLASS =
  'w-full rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-4 py-3 text-[var(--type-16)] text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] transition-colors focus:border-[var(--border-accent)] focus:shadow-[var(--shadow-ring)]'

const KM_PER_MILE = 1.609344
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024

interface VehicleForm {
  vin: string
  year: string
  make: string
  model: string
  mileage_miles: string
  asking_price: string
  city: string
  state: string
}

const EMPTY_FORM: VehicleForm = {
  vin: '',
  year: '',
  make: '',
  model: '',
  mileage_miles: '',
  asking_price: '',
  city: '',
  state: '',
}

export default function UsedCarsPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const provider = 'openai'

  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM)
  const [diligence, setDiligence] = useState<Record<string, string>>(EMPTY_DILIGENCE)
  const [openGroup, setOpenGroup] = useState<string>('service')

  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractNotice, setExtractNotice] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quotaDetail, setQuotaDetail] = useState<QuotaExhaustedDetail | null>(null)

  const updateField = useCallback(<K extends keyof VehicleForm>(key: K, value: VehicleForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const updateDiligence = useCallback((key: string, value: string) => {
    setDiligence((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleScreenshotPick = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Screenshot must be an image (PNG, JPG, WebP).')
      return
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setError('Screenshot is over 10MB. Please compress and retry.')
      return
    }
    setError(null)
    setExtractNotice(null)
    setScreenshot(file)
    setScreenshotPreview(URL.createObjectURL(file))
    setExtracting(true)
    try {
      const result = await api.analyzePurchaseScreenshot(file, provider)
      setForm((prev) => ({
        ...prev,
        vin: result.vin || prev.vin,
        year: result.year ? String(result.year) : prev.year,
        make: result.make || prev.make,
        model: result.model || prev.model,
        mileage_miles: result.mileage_miles
          ? String(result.mileage_miles)
          : result.mileage_km
            ? String(Math.round(result.mileage_km / KM_PER_MILE))
            : prev.mileage_miles,
        asking_price: result.asking_price_cents
          ? (result.asking_price_cents / 100).toFixed(0)
          : prev.asking_price,
        city: result.city || prev.city,
        state: result.state || prev.state,
      }))
      if (result.title_status) {
        const allowed = ['clean', 'salvage', 'rebuilt', 'lemon', 'unknown']
        const value = result.title_status.toLowerCase()
        if (allowed.includes(value)) {
          setDiligence((prev) => ({ ...prev, title_status: value }))
        }
      }
      if (result.seller_type) {
        const value = result.seller_type.toLowerCase()
        if (value === 'private' || value === 'dealer') {
          setDiligence((prev) => ({ ...prev, seller_type: value }))
        }
      }
      const filledCount = [result.vin, result.year, result.make, result.model, result.asking_price_cents]
        .filter(Boolean).length
      setExtractNotice(
        filledCount > 0
          ? `Pulled ${filledCount} field${filledCount === 1 ? '' : 's'} from screenshot — review and edit before submitting.`
          : "Couldn't read the listing automatically. Fill the form manually.",
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Screenshot extraction failed.'
      setExtractNotice(`${message} Fill the form manually.`)
    } finally {
      setExtracting(false)
    }
  }, [])

  const removeScreenshot = useCallback(() => {
    setScreenshot(null)
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview)
    setScreenshotPreview(null)
    setExtractNotice(null)
  }, [screenshotPreview])

  const canSubmit = Boolean(
    form.year && form.make && form.model && form.mileage_miles && form.asking_price,
  )

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    setQuotaDetail(null)
    try {
      const milesValue = parseInt(form.mileage_miles, 10) || 0
      const mileage_km = Math.round(milesValue * KM_PER_MILE)
      const yearValue = parseInt(form.year, 10) || 0
      const asking = Math.round(parseFloat(form.asking_price || '0') * 100)
      const result = await api.analyzePurchase({
        make: form.make.trim(),
        model: form.model.trim(),
        year: yearValue,
        mileage_km,
        asking_price: asking,
        provider,
        vin: form.vin.trim() || undefined,
        city: form.city.trim() || undefined,
        country: 'US',
        diligence: normalizeDiligence(diligence),
      })
      if (!result?.id) {
        throw new Error('Analysis succeeded but no result id was returned.')
      }
      router.push(`/result/purchase/${result.id}`)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        if (err.quotaDetail) setQuotaDetail(err.quotaDetail)
      } else {
        setError(err instanceof Error ? err.message : 'Analysis failed. Please try again.')
      }
      setSubmitting(false)
    }
  }

  return (
    <section className="ui-section pb-20 md:pb-12">
      <div className="ui-container max-w-4xl">
        <motion.header {...reveal(0)} className="ui-surface-strong perspective-stack mb-6 rounded-2xl p-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-accent)] bg-[var(--accent-wash)] px-3 py-1 text-[var(--type-12)] font-semibold uppercase tracking-wide text-[var(--accent-bright)]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Pre-Purchase Inspector
          </div>
          <h1 className="mt-3 font-display text-[var(--type-32)] font-semibold text-[var(--text-1)]">
            Used cars: don&apos;t get burned
          </h1>
          <p className="mt-2 text-[var(--type-16)] text-[var(--text-2)]">
            Drop in a VIN, paste a listing screenshot, or fill the form. Answer the diligence
            questions you know and we&apos;ll tell you a fair offer, walk-away price, and the
            scam tells to watch for at the meetup.
          </p>
        </motion.header>

        <motion.section {...reveal(0.06)} className="ui-surface-strong perspective-stack mb-6 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-[var(--type-18)] font-semibold text-[var(--text-1)]">
              <Sparkles className="h-4 w-4 text-[var(--accent-bright)]" />
              Pre-fill from a listing screenshot
            </h2>
            <span className="text-[var(--type-12)] text-[var(--text-3)]">No quota used</span>
          </div>
          <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
            Upload an image from CarGurus, AutoTrader, Craigslist, or Facebook Marketplace.
            We&apos;ll read VIN, year, make, model, mileage, and price — you confirm before
            we run the paid analysis.
          </p>

          {!screenshot ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--warm-bg-secondary)] px-4 py-8 text-[var(--text-2)] transition-colors hover:border-[var(--border-accent)] hover:bg-[var(--accent-wash)]"
            >
              <Upload className="h-6 w-6 text-[var(--accent-bright)]" />
              <span className="text-[var(--type-14)] font-semibold">Choose screenshot</span>
              <span className="text-[var(--type-12)] text-[var(--text-3)]">PNG, JPG, WebP up to 10MB</span>
            </button>
          ) : (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-3">
              {screenshotPreview && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={screenshotPreview} alt="Listing screenshot preview" className="h-20 w-20 rounded-lg object-cover" />
              )}
              <div className="flex-1 min-w-0">
                <p className="truncate text-[var(--type-14)] font-semibold text-[var(--text-1)]">{screenshot.name}</p>
                {extracting ? (
                  <p className="mt-1 inline-flex items-center gap-1 text-[var(--type-12)] text-[var(--accent-bright)]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Reading listing fields...
                  </p>
                ) : extractNotice ? (
                  <p className="mt-1 text-[var(--type-12)] text-[var(--text-3)]">{extractNotice}</p>
                ) : null}
              </div>
              <button onClick={removeScreenshot} className="rounded-lg p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-up)]">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleScreenshotPick(file)
              e.target.value = ''
            }}
          />
        </motion.section>

        <motion.section {...reveal(0.1)} className="ui-surface-strong perspective-stack mb-6 rounded-2xl p-5">
          <h2 className="text-[var(--type-18)] font-semibold text-[var(--text-1)]">Vehicle details</h2>
          <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
            VIN is optional but unlocks listing-anchored pricing and Carfax cross-checks.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="ui-caption">VIN (optional)</label>
              <input
                value={form.vin}
                onChange={(e) => updateField('vin', e.target.value.toUpperCase())}
                placeholder="17-character VIN — e.g. 1HGCM82633A123456"
                maxLength={17}
                className={`${FIELD_CLASS} font-mono tracking-wide`}
              />
            </div>
            <div>
              <label className="ui-caption">Year</label>
              <input
                type="number"
                value={form.year}
                onChange={(e) => updateField('year', e.target.value)}
                placeholder="2018"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className="ui-caption">Mileage (miles)</label>
              <input
                type="number"
                value={form.mileage_miles}
                onChange={(e) => updateField('mileage_miles', e.target.value)}
                placeholder="78,000"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className="ui-caption">Make</label>
              <input
                value={form.make}
                onChange={(e) => updateField('make', e.target.value)}
                placeholder="Honda"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className="ui-caption">Model</label>
              <input
                value={form.model}
                onChange={(e) => updateField('model', e.target.value)}
                placeholder="Civic"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className="ui-caption">Asking price ($)</label>
              <input
                type="number"
                value={form.asking_price}
                onChange={(e) => updateField('asking_price', e.target.value)}
                placeholder="14,500"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className="ui-caption">City (optional)</label>
              <input
                value={form.city}
                onChange={(e) => updateField('city', e.target.value)}
                placeholder="Austin"
                className={FIELD_CLASS}
              />
            </div>
          </div>
        </motion.section>

        <motion.section {...reveal(0.14)} className="ui-surface-strong perspective-stack mb-6 rounded-2xl p-5">
          <h2 className="text-[var(--type-18)] font-semibold text-[var(--text-1)]">Diligence questions</h2>
          <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
            Answer what you know — every confirmed fact moves the price target. Skip anything
            you&apos;re unsure about; we won&apos;t penalize unanswered questions.
          </p>

          <div className="mt-4 space-y-3">
            {DILIGENCE_GROUPS.map((group) => {
              const isOpen = openGroup === group.id
              const answeredCount = group.fields.filter((f) => diligence[f.key] && diligence[f.key] !== '').length
              return (
                <div key={group.id} className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)]">
                  <button
                    type="button"
                    onClick={() => setOpenGroup(isOpen ? '' : group.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-[var(--text-3)]" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-[var(--text-3)]" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[var(--type-16)] font-semibold text-[var(--text-1)]">{group.title}</p>
                      <p className="text-[var(--type-12)] text-[var(--text-3)]">{group.subtitle}</p>
                    </div>
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-up)] px-2 py-0.5 text-[var(--type-12)] text-[var(--text-3)]">
                      {answeredCount}/{group.fields.length}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="space-y-3 px-4 pb-4">
                      {group.fields.map((field) => (
                        <DiligenceFieldRenderer
                          key={field.key}
                          field={field}
                          value={diligence[field.key] || ''}
                          onChange={(v) => updateDiligence(field.key, v)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </motion.section>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-[var(--red-dim)] bg-[var(--red-wash)] px-4 py-3 text-[var(--type-14)] text-[var(--red-dim)]">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <motion.div
          {...reveal(0.18)}
          className="sticky z-10 bottom-[max(1rem,calc(72px+env(safe-area-inset-bottom)+0.5rem))] md:bottom-4"
        >
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="ui-button-primary group flex w-full items-center justify-center gap-2 !py-4 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running purchase analysis...
              </>
            ) : (
              <>Get fair price + safety brief</>
            )}
          </button>
          {!canSubmit && (
            <p className="mt-2 text-center text-[var(--type-12)] text-[var(--text-3)]">
              Year, make, model, mileage, and asking price are required.
            </p>
          )}
        </motion.div>
      </div>

      {quotaDetail && (
        <OutOfAnalysesModal detail={quotaDetail} onClose={() => setQuotaDetail(null)} />
      )}
    </section>
  )
}

function DiligenceFieldRenderer({
  field,
  value,
  onChange,
}: {
  field: DiligenceField
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-[var(--type-14)] font-semibold text-[var(--text-1)]">{field.label}</label>
      {field.helper && (
        <p className="mt-0.5 text-[var(--type-12)] text-[var(--text-3)]">{field.helper}</p>
      )}
      {field.type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${FIELD_CLASS} mt-1.5`}
        >
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : field.type === 'number' ? (
        <input
          type="number"
          value={value}
          min={field.numericMin}
          max={field.numericMax}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${FIELD_CLASS} mt-1.5`}
        />
      ) : (
        <textarea
          value={value}
          rows={3}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${FIELD_CLASS} mt-1.5 resize-none`}
        />
      )}
    </div>
  )
}
