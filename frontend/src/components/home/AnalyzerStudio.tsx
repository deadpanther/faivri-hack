'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Camera,
  FileText,
  Home,
  MapPin,
  Mic,
  Pill,
  Search,
  Shield,
  ShoppingBag,
  Square,
  Upload,
  Wrench,
  X,
} from 'lucide-react'

import { SignInButton } from '@clerk/nextjs'

import { api, ApiError, type QuotaExhaustedDetail } from '@/lib/api'
import OutOfAnalysesModal from '@/components/ui/OutOfAnalysesModal'
import { reveal } from '@/lib/motion'
import { reverseGeocode } from '@/lib/reverse-geocode'
import {
  US_STATES, US_CITIES_BY_STATE, formatLocationLabel, type StateCode,
} from '@/lib/us-locations'
import { AnalysisProgress } from './AnalysisProgress'

/* ── Example queries (shown as clickable cards) ── */

const EXAMPLES = [
  { text: 'Mechanic quoted $850 for brake pads on Honda Civic in Austin', domain: 'auto', icon: Wrench },
  { text: 'Pharmacy wants $285 for prescriptions, no generics offered', domain: 'medical', icon: Pill },
  { text: 'Contractor quoted $4,200 for bathroom tile replacement', domain: 'home', icon: Home },
  { text: 'Lawyer asking $2,500 for a simple rental agreement review', domain: 'legal', icon: Shield },
  { text: 'Marketplace seller wants $4,000 for a new RTX 5090 GPU on eBay', domain: 'retail', icon: ShoppingBag },
  { text: 'Costco listing a 65" OLED TV for $1,800 — is that a fair price?', domain: 'retail', icon: ShoppingBag },
]

// Placeholder shown in the textarea, swapped when the user picks a domain so
// the example they see is recognizable for their category instead of always
// pitching a brake-pad quote. `null` (auto-detect) falls back to the auto
// example because that's the most common first query.
const PLACEHOLDER_BY_DOMAIN: Record<string, string> = {
  auto: 'Mechanic quoted $850 for brake pads on my Honda Civic 2019 in Austin, TX...',
  medical: 'Pharmacy wants $285 for a 30-day prescription, no generic offered...',
  home: 'Contractor quoted $4,200 to retile a small bathroom in Denver, CO...',
  legal: 'Lawyer asking $2,500 to review a one-page rental agreement...',
  retail: 'Seller on eBay / Marketplace is asking $4,000 for an RTX 5090 GPU — is that fair vs. Amazon / Newegg / recent sold listings?',
  invoice: 'Describe what this invoice is for, or attach it with the camera icon.',
  purchase: 'Use the Car Buy tab to evaluate a specific make, model, and year.',
}
const DEFAULT_PLACEHOLDER = PLACEHOLDER_BY_DOMAIN.auto
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

function isSupportedAttachment(file: File): boolean {
  return isImageFile(file) || isPdfFile(file)
}

const FIELD_CLASS =
  'w-full rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-4 py-3 text-[var(--type-16)] text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] transition-colors focus:border-[var(--border-accent)] focus:shadow-[var(--shadow-ring)]'

type SpeechRecognitionResultLike = {
  isFinal: boolean
  [index: number]: { transcript?: string }
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

type SpeechRecognitionErrorEventLike = {
  error: string
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

export default function AnalyzerStudio() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const provider = 'anthropic'

  const [query, setQuery] = useState('')
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  // FE-P1-04 / LOC-01: geolocation flow has three phases:
  //   - prompting: browser permission dialog is open
  //   - granted  : we have lat/lng but may also have a pretty label from the
  //                reverse-geocode lookup (detectedLabel). The user can accept
  //                the detected location or swap to a manual state+city pair.
  //   - denied / unavailable: we fall back to a US state dropdown + city
  //                autocomplete (no free-text "Austin, TX" input — that led
  //                to typos and missing state codes).
  const [geoStatus, setGeoStatus] = useState<'idle' | 'prompting' | 'granted' | 'denied' | 'unavailable'>('idle')
  const [detectedLabel, setDetectedLabel] = useState<string | null>(null)
  const [useDetected, setUseDetected] = useState(true)
  const [manualState, setManualState] = useState<StateCode | ''>('')
  const [manualCity, setManualCity] = useState('')
  const selectedDomain = 'auto'
  const [loading, setLoading] = useState(false)
  const [loadingStage, setLoadingStage] = useState(0)
  const [loadingStep, setLoadingStep] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState('')
  // Extra metadata surfaced alongside the error banner so users can tell a
  // 401 (go sign in) from a 503 (try again) from a network error (check wifi)
  // at a glance, and copy a request-id into a support email when needed.
  const [errorMeta, setErrorMeta] = useState<{ status: number; requestId: string | null } | null>(null)
  const [quotaDetail, setQuotaDetail] = useState<QuotaExhaustedDetail | null>(null)
  const [purchaseMode, setPurchaseMode] = useState(false)
  const [purchaseForm, setPurchaseForm] = useState({
    make: '', model: '', year: '', mileage_km: '', asking_price: '',
  })

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)

  const canSubmit = purchaseMode
    ? Boolean(purchaseForm.make && purchaseForm.model && purchaseForm.year && purchaseForm.asking_price)
    : Boolean(query.trim() || imageFile || audioBlob)

  const resolveLocation = useCallback(async (lat: number, lng: number) => {
    setUserLocation({ lat, lng })
    setGeoStatus('granted')
    // Reverse-geocode for the friendly banner. Failure just means the banner
    // shows a neutral "Detected your location" without a city — the analyze
    // request still gets the raw lat/lng, which is all the backend actually
    // needs for pricing.
    const geo = await reverseGeocode(lat, lng)
    if (geo) {
      setDetectedLabel(
        geo.regionCode && geo.countryCode === 'US'
          ? formatLocationLabel(geo.city, geo.regionCode)
          : [geo.city, geo.regionName || geo.countryName].filter(Boolean).join(', ')
      )
    }
  }, [])

  // Why the permission is blocked (when it is). Populated on denial or when
  // the page is on an insecure origin — drives the copy + recovery CTA.
  //   'insecure'  : page is HTTP (geolocation API requires HTTPS except on
  //                 localhost). No amount of retrying helps.
  //   'settings'  : browser permissions DB already has a "blocked" decision
  //                 for this origin — getCurrentPosition rejects instantly
  //                 without showing a prompt. Fix is in browser settings.
  //   'prompt'    : user clicked "Block" on the live prompt this session, or
  //                 the prompt timed out. We can ask again.
  //   null        : no denial has happened yet.
  const [denialReason, setDenialReason] =
    useState<null | 'insecure' | 'settings' | 'prompt'>(null)

  const requestGeolocation = useCallback(async () => {
    if (!('geolocation' in navigator)) {
      setGeoStatus('unavailable')
      return
    }
    // HTTPS requirement: every major browser blocks geolocation on plain
    // HTTP origins except localhost. Detect early so we explain clearly
    // instead of showing a generic "denied" message that the user can't fix.
    const secure =
      typeof window !== 'undefined' &&
      (window.isSecureContext ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1')
    if (!secure) {
      setDenialReason('insecure')
      setGeoStatus('denied')
      return
    }
    // Query the Permissions API first (when available) so we can tell
    // "never asked yet" apart from "already blocked in browser settings".
    // A 'denied' state here means getCurrentPosition will reject without
    // prompting — we should explain that, not just silently retry.
    try {
      if ('permissions' in navigator) {
        const status = await navigator.permissions.query({
          name: 'geolocation' as PermissionName,
        })
        if (status.state === 'denied') {
          setDenialReason('settings')
          setGeoStatus('denied')
          return
        }
      }
    } catch {
      /* Safari < 16 throws for 'geolocation' — fall through to the prompt. */
    }

    setGeoStatus('prompting')
    setDenialReason(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void resolveLocation(pos.coords.latitude, pos.coords.longitude)
      },
      (err) => {
        // PERMISSION_DENIED (1), POSITION_UNAVAILABLE (2), TIMEOUT (3).
        // Denial and unavailability need different messaging and recovery
        // paths (denial → browser settings, unavailable/timeout → retry).
        if (err.code === err.PERMISSION_DENIED) {
          setDenialReason('prompt')
          setGeoStatus('denied')
        } else {
          setGeoStatus('unavailable')
        }
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[geolocation] error code=%d message=%s', err.code, err.message)
        }
      },
      { timeout: 5000, maximumAge: 300000 }
    )
  }, [resolveLocation])

  useEffect(() => {
    void requestGeolocation()
  }, [requestGeolocation])

  const retryGeolocation = useCallback(() => {
    void requestGeolocation()
  }, [requestGeolocation])

  const switchToManualEntry = useCallback(() => {
    setUseDetected(false)
    setUserLocation(null)
  }, [])

  // Available cities for the datalist whenever the user has picked a state.
  // Empty array (no datalist options) when no state is selected — we want the
  // user to pick a state first so their city search is scoped correctly.
  const cityOptions = manualState ? US_CITIES_BY_STATE[manualState] : []

  useEffect(() => {
    if (!imagePreview) return
    return () => URL.revokeObjectURL(imagePreview)
  }, [imagePreview])

  const clearAttachments = useCallback(() => {
    setImageFile(null)
    setImagePreview(null)
    setAudioBlob(null)
  }, [])

  const stopVoiceInput = useCallback(() => {
    if (!recognitionRef.current) return
    recognitionRef.current.onend = null
    recognitionRef.current.stop()
    recognitionRef.current = null
    setIsListening(false)
  }, [])

  const startVoiceInput = useCallback(() => {
    if (typeof window === 'undefined') return
    const speechWindow = window as Window & {
      webkitSpeechRecognition?: SpeechRecognitionConstructor
      SpeechRecognition?: SpeechRecognitionConstructor
    }
    const SpeechRecognitionCtor =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      setError('Voice input is not supported in this browser. Try Chrome or Safari, or type your quote.')
      return
    }

    setError('')
    setAudioBlob(null)
    setPurchaseMode(false)

    try {
      const recognition = new SpeechRecognitionCtor()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'

      let finalText = ''
      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let interim = ''
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const part = event.results[i][0]?.transcript ?? ''
          if (event.results[i].isFinal) {
            finalText = `${finalText} ${part}`.trim()
          } else {
            interim += part
          }
        }
        const combined = `${finalText} ${interim}`.trim()
        if (combined) setQuery(combined)
      }

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (event.error === 'not-allowed') {
          setError('Microphone permission is blocked. Allow mic access and try again.')
        } else if (event.error !== 'aborted') {
          setError('Could not capture voice right now. Try again or type your quote.')
        }
        setIsListening(false)
        recognitionRef.current = null
      }

      recognition.onend = () => {
        setIsListening(false)
        recognitionRef.current = null
      }

      recognitionRef.current = recognition
      recognition.start()
      setIsListening(true)
    } catch {
      setError('Could not start voice capture. Try again or type your quote.')
    }
  }, [])

  const toggleVoiceInput = useCallback(() => {
    if (isListening) {
      stopVoiceInput()
      return
    }
    startVoiceInput()
  }, [isListening, startVoiceInput, stopVoiceInput])

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }, [])
  const handleDragLeave = useCallback(() => setIsDragging(false), [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!isSupportedAttachment(file)) { setError('Only images and PDF files are supported.'); return }
    if (file.size > MAX_ATTACHMENT_SIZE) { setError('File too large (max 10 MB)'); return }
    setImageFile(file)
    setImagePreview(isImageFile(file) ? URL.createObjectURL(file) : null)
    setAudioBlob(null)
    setPurchaseMode(false)
  }, [])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!isSupportedAttachment(file)) { setError('Only images and PDF files are supported.'); return }
    if (file.size > MAX_ATTACHMENT_SIZE) { setError('File too large (max 10 MB)'); return }
    setImageFile(file)
    setImagePreview(isImageFile(file) ? URL.createObjectURL(file) : null)
    setAudioBlob(null)
    setPurchaseMode(false)
  }

  function selectExample(text: string) {
    setQuery(text)
    setPurchaseMode(false)
    clearAttachments()
    textareaRef.current?.focus()
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (loading || (!purchaseMode && !query.trim() && !imageFile && !audioBlob)) return
    stopVoiceInput()

    setLoading(true)
    setError('')
    setErrorMeta(null)
    setLoadingStage(1)
    setTimeout(() => setLoadingStage(2), 1200)
    setTimeout(() => setLoadingStage(3), 3000)

    try {
      let result
      // Decide what locality to send. Priority:
      //   1. Detected lat/lng (when useDetected=true AND we have coords)
      //   2. Manual state + city picker
      //   3. Nothing — backend will treat as country-level query
      // Only pass a country when we also have a city, so we don't give the
      // backend a country hint divorced from an actual locality.
      const usingDetected = useDetected && !!userLocation
      const manualCityLabel = !usingDetected
        ? formatLocationLabel(manualCity, manualState)
        : ''
      const fallbackCity = manualCityLabel || undefined
      const fallbackCountry = fallbackCity ? 'US' : undefined
      const detectedLat = usingDetected ? userLocation?.lat : undefined
      const detectedLng = usingDetected ? userLocation?.lng : undefined

      if (purchaseMode) {
        setLoadingStep('Analyzing ownership risk and fair price...')
        result = await api.analyzePurchase({
          make: purchaseForm.make, model: purchaseForm.model,
          year: parseInt(purchaseForm.year, 10),
          mileage_km: parseInt(purchaseForm.mileage_km, 10) || 0,
          asking_price: Math.round(parseFloat(purchaseForm.asking_price) * 100),
          provider, lat: detectedLat, lng: detectedLng,
          city: fallbackCity, country: fallbackCountry,
        })
        // FE-P1-02: backend persists the analysis and returns an id — navigate
        // by id so a refresh or share link still resolves the result. (The
        // previous URL-encoded-JSON route was lost on any reload.)
        if (!result?.id) {
          throw new Error('Analysis completed but no result id was returned.')
        }
        router.push(`/result/purchase/${result.id}`)
        return
      }

      if (imageFile) {
        setLoadingStep('Reading your invoice...')
        result = await api.analyzeImage(imageFile, provider, detectedLat, detectedLng, fallbackCity, fallbackCountry)
      } else if (audioBlob) {
        setLoadingStep('Transcribing audio...')
        result = await api.analyzeVoice(audioBlob, provider, detectedLat, detectedLng, fallbackCity, fallbackCountry)
      } else {
        setLoadingStep('Searching live market data...')
        result = await api.analyze({
          query, provider, domain: selectedDomain || undefined,
          lat: detectedLat, lng: detectedLng,
          city: fallbackCity, country: fallbackCountry,
        })
      }

      router.push(`/result/${result.id}`)
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message)
        setErrorMeta({ status: err.status, requestId: err.requestId })
        const qd = err.quotaDetail
        if (qd) setQuotaDetail(qd)
      } else {
        setError(err instanceof Error ? err.message : 'Analysis failed. Please try again.')
        setErrorMeta(null)
      }
      setLoading(false)
      setLoadingStep('')
      setLoadingStage(0)
    }
  }

  useEffect(() => {
    return () => stopVoiceInput()
  }, [stopVoiceInput])

  return (
    <div className="min-h-[calc(100svh-var(--nav-clearance,66px))]" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <OutOfAnalysesModal detail={quotaDetail} onClose={() => setQuotaDetail(null)} />
      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 p-6">
            <div className="glass-strong w-full max-w-lg rounded-3xl border-2 border-dashed border-[var(--border-accent)] px-8 py-14 text-center">
              <Upload className="mx-auto mb-4 h-10 w-10 text-[var(--blue)]" />
              <p className="font-display text-[var(--type-20)] font-semibold text-[var(--text-1)]">Drop your image or PDF</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="ui-section" style={{ paddingTop: 'clamp(32px, 6vw, 64px)' }}>
        <div className="ui-container max-w-3xl mx-auto">
          {/* ── Heading ── */}
          <motion.div
            {...reveal(0)}
            className="relative mb-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-4 sm:mb-8 sm:rounded-3xl sm:p-5 md:p-7"
          >
            <h1 className="font-display text-[clamp(1.5rem,5.5vw,2.5rem)] font-bold leading-tight text-[var(--text-1)]">
              Price check studio
            </h1>
            <p className="mt-2 max-w-2xl text-[var(--type-13)] text-[var(--text-3)] sm:text-[var(--type-14)]">
              Paste your quote, add a receipt, or tap the mic. We return a fair range and clear next step.
            </p>
          </motion.div>

          {/* ── Location banner: detect-and-confirm OR manual state/city ── */}
          <AnimatePresence mode="wait">
            {geoStatus === 'granted' && useDetected && userLocation && (
              <motion.div
                key="granted"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mb-3 rounded-xl border border-[var(--green)]/25 bg-[var(--green-wash)] px-4 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2 text-[var(--type-13)]">
                  <MapPin className="h-4 w-4 text-[var(--green-text)]" />
                  <span className="text-[var(--text-2)]">
                    {detectedLabel ? (
                      <>
                        Looks like you&apos;re in{' '}
                        <span className="font-semibold text-[var(--text-1)]">{detectedLabel}</span>
                        {' '}— we&apos;ll find local pricing.
                      </>
                    ) : (
                      <span className="text-[var(--text-2)]">Using your current location to find local pricing.</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={switchToManualEntry}
                    className="ml-auto rounded-md border border-[var(--border)] bg-[var(--warm-bg)] px-2.5 py-1 text-[var(--type-12)] font-medium text-[var(--text-2)] hover:border-[var(--border-strong)]"
                  >
                    Not me
                  </button>
                </div>
              </motion.div>
            )}

            {(geoStatus === 'denied' || geoStatus === 'unavailable' || (geoStatus === 'granted' && !useDetected)) && (
              <motion.div
                key="manual"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-[var(--type-13)]">
                  <MapPin className="h-4 w-4 text-[var(--text-3)]" />
                  <span className="font-semibold text-[var(--text-1)]">
                    {geoStatus === 'denied'
                      ? denialReason === 'settings'
                        ? 'Location blocked in your browser'
                        : denialReason === 'insecure'
                          ? 'Location needs HTTPS'
                          : 'Location blocked'
                      : geoStatus === 'unavailable'
                        ? "Couldn't detect you"
                        : 'Pick your location'}
                  </span>
                  <span className="text-[var(--text-3)]">
                    {denialReason === 'settings'
                      ? 'Open the lock icon in your address bar → Site settings → Location → Allow, then reload.'
                      : denialReason === 'insecure'
                        ? 'Open the site over HTTPS or pick your state and city below.'
                        : 'Pick state + city so we find local pricing.'}
                  </span>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[140px_1fr_auto]">
                  <select
                    value={manualState}
                    onChange={(e) => {
                      const next = e.target.value as StateCode | ''
                      setManualState(next)
                      // Clear the city when state changes — a stale city from
                      // the prior state autocompletes wrong and misleads the
                      // backend's locality match.
                      setManualCity('')
                    }}
                    className="rounded-lg border border-[var(--border)] bg-[var(--warm-bg)] px-3 py-1.5 text-[var(--type-13)] text-[var(--text-1)] outline-none focus:border-[var(--border-accent)]"
                  >
                    <option value="">State…</option>
                    {US_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    list="faivri-city-options"
                    value={manualCity}
                    onChange={(e) => setManualCity(e.target.value)}
                    placeholder={manualState ? 'City' : 'Pick a state first'}
                    disabled={!manualState}
                    className="rounded-lg border border-[var(--border)] bg-[var(--warm-bg)] px-3 py-1.5 text-[var(--type-13)] text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-accent)] disabled:opacity-60"
                  />
                  <datalist id="faivri-city-options">
                    {cityOptions.map((city) => (
                      <option key={city} value={city} />
                    ))}
                  </datalist>
                  {/* Only surface the retry button when another prompt has a
                      realistic chance of succeeding — hide it for 'settings'
                      (permanently denied) and 'insecure' (wrong origin). */}
                  {(geoStatus !== 'denied' ||
                    denialReason === null ||
                    denialReason === 'prompt') && (
                    <button
                      type="button"
                      onClick={() => { setUseDetected(true); retryGeolocation() }}
                      className="rounded-lg border border-[var(--border)] bg-[var(--warm-bg)] px-3 py-1.5 text-[var(--type-12)] font-medium text-[var(--text-2)] hover:border-[var(--border-strong)]"
                    >
                      Use my location
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Main input card ── */}
          <motion.div {...reveal(0.08)}>
            <form onSubmit={handleSubmit}>
              <div className="relative overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--warm-bg)] p-3 shadow-[var(--shadow-md)] sm:rounded-3xl sm:p-4 md:p-6">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[linear-gradient(180deg,rgba(35,131,226,0.06),transparent)]" />

                <input ref={fileInputRef} type="file" accept="image/*,.pdf,application/pdf" className="hidden" onChange={handleFileSelect} />

                {/* Input area */}
                <AnimatePresence mode="wait">
                  {purchaseMode ? (
                    <motion.div key="purchase" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <input placeholder="Make (Honda)" value={purchaseForm.make} onChange={e => setPurchaseForm(p => ({ ...p, make: e.target.value }))} className={FIELD_CLASS} />
                        <input placeholder="Model (Civic)" value={purchaseForm.model} onChange={e => setPurchaseForm(p => ({ ...p, model: e.target.value }))} className={FIELD_CLASS} />
                        <input type="number" inputMode="numeric" placeholder="Year" value={purchaseForm.year} onChange={e => setPurchaseForm(p => ({ ...p, year: e.target.value }))} className={FIELD_CLASS} />
                        <input type="number" inputMode="numeric" placeholder="Mileage (km)" value={purchaseForm.mileage_km} onChange={e => setPurchaseForm(p => ({ ...p, mileage_km: e.target.value }))} className={FIELD_CLASS} />
                        <input type="number" inputMode="decimal" placeholder="Asking price ($)" value={purchaseForm.asking_price} onChange={e => setPurchaseForm(p => ({ ...p, asking_price: e.target.value }))} className={`${FIELD_CLASS} sm:col-span-2`} />
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="quote" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                      <div className="relative">
                        <textarea ref={textareaRef} value={query} onChange={e => setQuery(e.target.value)}
                        placeholder={
                          selectedDomain
                            ? PLACEHOLDER_BY_DOMAIN[selectedDomain] ?? DEFAULT_PLACEHOLDER
                            : DEFAULT_PLACEHOLDER
                        }
                        rows={4} className={`${FIELD_CLASS} resize-none pb-11 pr-24`} disabled={loading} />
                        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                          <span className="inline-flex h-8 items-center rounded-full border border-[var(--border)] bg-[var(--warm-bg)] px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
                            Auto
                          </span>
                          <button
                            type="button"
                            onClick={toggleVoiceInput}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                              isListening
                                ? 'border-[var(--red)]/40 bg-[var(--red-wash)] text-[var(--red-text)]'
                                : 'border-[var(--border)] bg-[var(--warm-bg)] text-[var(--text-3)] hover:border-[var(--border-strong)]'
                            }`}
                            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                          >
                            {isListening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setPurchaseMode(false); fileInputRef.current?.click() }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--warm-bg)] text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)]"
                            aria-label="Upload image or PDF"
                          >
                            <Camera className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {isListening && (
                        <p className="mt-2 text-[var(--type-12)] text-[var(--text-4)]">
                          Listening... tap the square icon to stop.
                        </p>
                      )}
                      {imagePreview && (
                        <div className="relative mt-3 overflow-hidden rounded-xl border border-[var(--border)]">
                          <Image src={imagePreview} alt="Invoice" width={640} height={360} unoptimized className="h-32 w-full object-cover" />
                          <button type="button" onClick={clearAttachments}
                            className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 shadow-sm" aria-label="Remove attachment">
                            <X className="h-3.5 w-3.5 text-[var(--text-1)]" />
                          </button>
                        </div>
                      )}
                      {!imagePreview && imageFile && (
                        <div className="relative mt-3 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-2.5">
                          <FileText className="h-4 w-4 text-[var(--text-3)]" />
                          <p className="truncate text-[var(--type-13)] text-[var(--text-2)]">{imageFile.name}</p>
                          <button type="button" onClick={clearAttachments}
                            className="ml-auto rounded-full bg-white/90 p-1.5 shadow-sm" aria-label="Remove attachment">
                            <X className="h-3.5 w-3.5 text-[var(--text-1)]" />
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Loading progress */}
                {loading && <div className="mt-3"><AnalysisProgress stage={loadingStage} stepLabel={loadingStep} /></div>}

                {/* Submit */}
                <button type="submit" disabled={loading || !canSubmit}
                  className="btn-primary mt-3 w-full py-3 text-[var(--type-14)]">
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Analyzing...
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <Search className="h-4 w-4" />
                      {purchaseMode ? 'Analyze purchase' : 'Check this quote'}
                    </span>
                  )}
                </button>

                {error && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="mt-2 rounded-lg border border-[var(--border-danger)] bg-[var(--red-wash)] px-3 py-2.5 text-[var(--type-14)] text-[var(--red-text)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 flex-1">
                        <span className="inline-flex h-5 items-center rounded-full border border-[var(--border-danger)] bg-white/40 px-2 text-[11px] font-semibold uppercase tracking-wide">
                          {errorMeta?.status === 0
                            ? 'Network'
                            : errorMeta?.status === 401
                              ? 'Sign in'
                              : errorMeta?.status === 402 || errorMeta?.status === 429
                                ? 'Limit'
                                : errorMeta?.status === 503
                                  ? 'Retry'
                                  : errorMeta?.status
                                    ? `Err ${errorMeta.status}`
                                    : 'Error'}
                        </span>
                        <p className="leading-snug">{error}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setError(''); setErrorMeta(null) }}
                        className="flex-shrink-0 rounded p-0.5 hover:bg-white/40"
                        aria-label="Dismiss error"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {/* Retry CTA for transient failures. 401 sends users to
                        sign in rather than re-hitting the same endpoint; 4xx
                        client errors won't magically fix themselves. */}
                    {errorMeta?.status === 401 && (
                      <div className="mt-2 pl-9">
                        <SignInButton mode="modal" forceRedirectUrl="/">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md bg-black px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#222] transition-colors"
                          >
                            Sign back in
                          </button>
                        </SignInButton>
                      </div>
                    )}
                    {(errorMeta?.status === 0 || errorMeta?.status === 429 || errorMeta?.status === 503 || (errorMeta?.status && errorMeta.status >= 500)) && (
                      <div className="mt-2 pl-9">
                        <button
                          type="button"
                          onClick={() => { setError(''); setErrorMeta(null); handleSubmit() }}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--border-danger)] bg-white/40 px-2.5 py-1 text-[11px] font-semibold text-[var(--red-text)] hover:bg-white/60 transition-colors"
                        >
                          Try again
                        </button>
                      </div>
                    )}
                    {errorMeta?.requestId && (
                      <p className="mt-1.5 pl-9 text-[11px] text-[var(--red-text)]/70 font-mono">
                        request_id: {errorMeta.requestId}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </form>
          </motion.div>

          {/* ── Example cards (shown when no query) ── */}
          {!query && !imageFile && !audioBlob && !purchaseMode && !loading && (
            <motion.div {...reveal(0.15)} className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-4 md:p-5">
              <p className="mb-3 text-[var(--type-12)] font-medium uppercase tracking-wider text-[var(--text-4)]">
                Try an example
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {EXAMPLES.map((ex) => {
                  const Icon = ex.icon
                  return (
                    <button key={ex.text} type="button" onClick={() => selectExample(ex.text)}
                      className="group rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-3.5 text-left transition-all hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-sm)]">
                      <div className="flex items-start gap-3">
                        <div className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--warm-bg-secondary)]">
                          <Icon className="h-4 w-4 text-[var(--text-3)] group-hover:text-[var(--text-1)] transition-colors" />
                        </div>
                        <p className="text-[var(--type-14)] leading-snug text-[var(--text-2)] group-hover:text-[var(--text-1)] transition-colors">
                          {ex.text}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          )}
        </div>
      </section>
    </div>
  )
}
