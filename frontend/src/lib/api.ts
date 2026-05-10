const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// Token getter installed by <AuthTokenBridge /> at the root of the React tree.
// When unset (SSR, or before hydration), requests go out anonymously — the
// backend's auth dependency is optional on most routes and returns 401 on the
// ones that require a user. Client components must register the getter once
// inside a ClerkProvider subtree.
let authTokenGetter: (() => Promise<string | null>) | null = null

export function setAuthTokenGetter(
  getter: (() => Promise<string | null>) | null,
): void {
  authTokenGetter = getter
}

// Hackathon backup: persist token in sessionStorage so we never lose it
// across client-side navigations or HMR refreshes.
const SESSION_TOKEN_KEY = 'faivri:insforge-access-token'

export function setPersistedToken(token: string | null): void {
  if (typeof window === 'undefined') return
  if (token) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token)
  } else {
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
  }
}

function getPersistedToken(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(SESSION_TOKEN_KEY)
}

async function authHeaders(): Promise<Record<string, string>> {
  // 1. Try the registered getter (primary path)
  if (authTokenGetter) {
    try {
      const token = await authTokenGetter()
      if (token) {
        setPersistedToken(token)
        return { Authorization: `Bearer ${token}` }
      }
    } catch (err) {
      console.warn('[api] authTokenGetter error:', err)
    }
  } else {
    console.warn('[api] authTokenGetter is NOT registered')
  }

  // 2. Fallback: use persisted token from sessionStorage
  const persisted = getPersistedToken()
  if (persisted) {
    console.log('[api] using persisted token fallback')
    return { Authorization: `Bearer ${persisted}` }
  }

  console.warn('[api] no auth token available')
  return {}
}

// ApiError carries the HTTP status alongside a user-friendly message so UI
// code can decide whether to show a retry CTA, a sign-in CTA, or a plain
// error banner. We keep the server-provided detail too for debugging.
// Shape of the structured 402 body the backend returns when the monthly
// quota is exhausted. The frontend renders OutOfAnalysesModal from this.
export interface QuotaExhaustedDetail {
  error: 'quota_exhausted'
  plan: string
  limit: number
  reset_at: string | null
  boost_credits?: number
  boost?: {
    credits_per_pack: number
    price_cents: number
    checkout_url: string | null
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly requestId: string | null
  readonly rawDetail: string
  readonly payload: unknown

  constructor(
    status: number,
    friendly: string,
    rawDetail: string,
    requestId: string | null,
    payload: unknown = null,
  ) {
    super(friendly)
    this.name = 'ApiError'
    this.status = status
    this.rawDetail = rawDetail
    this.requestId = requestId
    this.payload = payload
  }

  // Narrow accessor — returns the structured 402 body when the error is a
  // quota-exhausted response, otherwise null. Callers use this to decide
  // whether to open OutOfAnalysesModal vs. a generic toast.
  get quotaDetail(): QuotaExhaustedDetail | null {
    if (this.status !== 402) return null
    const p = this.payload
    if (p && typeof p === 'object' && 'detail' in p) {
      const d = (p as { detail: unknown }).detail
      if (d && typeof d === 'object' && 'error' in d) {
        return d as QuotaExhaustedDetail
      }
    }
    return null
  }
}

function extractDetail(body: unknown): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) {
      return d
        .map((item: unknown) => {
          if (item && typeof item === 'object') {
            const obj = item as Record<string, unknown>
            return String(obj.msg ?? obj.message ?? JSON.stringify(obj))
          }
          return String(item)
        })
        .join('; ')
    }
  }
  return ''
}

// Support hint appended to errors where retrying is unlikely to help on its
// own — so users always see a path forward rather than dead-ending.
export const SUPPORT_EMAIL = 'support@faivri.com'
const SUPPORT_HINT = ` If this keeps happening, email ${SUPPORT_EMAIL} and we'll take a look.`

// Map a backend error to a user-facing message. Every branch must leave the
// user knowing WHAT went wrong and WHAT they can do — never a raw 500 or a
// silent failure that looks like "nothing happened".
function friendlyMessage(status: number, detail: string): string {
  const d = detail.toLowerCase()
  if (status === 401 || d.includes('authentication required')) {
    return 'Your session expired. Sign in again to pick up where you left off.'
  }
  if (status === 402 || d.includes('quota') || d.includes('limit reached')) {
    return 'Monthly query limit reached on your current plan. Upgrade or wait for next month to continue.'
  }
  if (status === 403) {
    return `You do not have permission for this action.${SUPPORT_HINT}`
  }
  if (status === 404) {
    return detail || 'That record was not found. It may have been deleted or never existed.'
  }
  if (status === 429) {
    return 'Too many requests — please slow down and try again in a minute.'
  }
  if (status === 400 || status === 422) {
    return detail || 'That request did not look right. Check the details and try again.'
  }
  if (status === 503) {
    if (d.includes('live pricing') || d.includes('insufficient')) {
      return 'We couldn\'t find enough trusted price sources for that exact query right now. Try a more specific item (brand + model), a different city, or try again in a minute.'
    }
    if (d.includes('llm') || d.includes('anthropic') || d.includes('openai')) {
      return 'Our AI provider is under load right now. Please retry in a few seconds.'
    }
    return `A backend service is temporarily unavailable. Please try again shortly.${SUPPORT_HINT}`
  }
  if (status >= 500) {
    return `Something went wrong on our side. Please try again — if it keeps happening, we're on it.${SUPPORT_HINT}`
  }
  return detail || `Request failed (${status}).`
}

// Discriminator the backend sets on a 401 when the user's session was
// revoked because they signed in on a 3rd device. The frontend listens for
// this on `window` and shows a toast — without it, every 401 looks the
// same as a plain expired token and the user can't tell why they're out.
export const SESSION_REVOKED_EVENT = 'faivri:session-revoked'

async function handleErrorResponse(res: Response): Promise<never> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  const rawDetail = extractDetail(body) || `HTTP ${res.status}`
  const friendly = friendlyMessage(res.status, rawDetail)
  const requestId = res.headers.get('X-Request-ID')
  if (
    res.status === 401 &&
    res.headers.get('X-Faivri-Auth-Reason') === 'session_revoked_by_cap' &&
    typeof window !== 'undefined'
  ) {
    window.dispatchEvent(new CustomEvent(SESSION_REVOKED_EVENT))
  }
  throw new ApiError(res.status, friendly, rawDetail, requestId, body)
}

async function _refreshInsforgeToken(): Promise<boolean> {
  try {
    const { insforge } = await import('@/lib/insforge')
    const { data, error } = await insforge.auth.refreshSession()
    if (error || !data) return false
    // After refresh, extract the new token and persist it
    const headers = insforge.getHttpClient().getHeaders()
    const authHeader = headers.Authorization || headers.authorization
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '')
      if (token) {
        setPersistedToken(token)
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const authH = await authHeaders()
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...authH,
        ...options?.headers,
      },
      ...options,
    })
  } catch (netErr: unknown) {
    throw new ApiError(
      0,
      `Can't reach the Faivri API. Check your internet connection and try again.${SUPPORT_HINT}`,
      netErr instanceof Error ? netErr.message : 'network error',
      null,
    )
  }

  // Auto-refresh on 401: try to refresh the InsForge token and retry once
  if (res.status === 401) {
    const refreshed = await _refreshInsforgeToken()
    if (refreshed) {
      const newAuthH = await authHeaders()
      try {
        const retryRes = await fetch(`${API_URL}${path}`, {
          headers: {
            'Content-Type': 'application/json',
            ...newAuthH,
            ...options?.headers,
          },
          ...options,
        })
        if (!retryRes.ok) await handleErrorResponse(retryRes)
        return retryRes.json()
      } catch (netErr: unknown) {
        throw new ApiError(
          0,
          `Can't reach the Faivri API. Check your internet connection and try again.${SUPPORT_HINT}`,
          netErr instanceof Error ? netErr.message : 'network error',
          null,
        )
      }
    }
  }

  if (!res.ok) await handleErrorResponse(res)

  return res.json()
}

async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  const authH = await authHeaders()
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { ...authH },
      body: formData,
    })
  } catch (netErr: unknown) {
    throw new ApiError(
      0,
      `Can't reach the Faivri API. Check your internet connection and try again.${SUPPORT_HINT}`,
      netErr instanceof Error ? netErr.message : 'network error',
      null,
    )
  }

  // Auto-refresh on 401 for upload requests too
  if (res.status === 401) {
    const refreshed = await _refreshInsforgeToken()
    if (refreshed) {
      const newAuthH = await authHeaders()
      try {
        const retryRes = await fetch(`${API_URL}${path}`, {
          method: 'POST',
          headers: { ...newAuthH },
          body: formData,
        })
        if (!retryRes.ok) await handleErrorResponse(retryRes)
        return retryRes.json()
      } catch (netErr: unknown) {
        throw new ApiError(
          0,
          `Can't reach the Faivri API. Check your internet connection and try again.${SUPPORT_HINT}`,
          netErr instanceof Error ? netErr.message : 'network error',
          null,
        )
      }
    }
  }

  if (!res.ok) await handleErrorResponse(res)

  return res.json()
}

export interface EvidenceSource {
  url: string
  domain: string
  title: string
  price_cents: number
  price_type: 'parts' | 'labor' | 'total' | 'hourly' | 'unknown'
  trust_weight: number
  is_local: boolean
  city_hint?: string | null
  state_hint?: string | null
  snippet: string
  extracted_at: string
}

export interface EvidenceSummary {
  trusted_count: number
  local_count: number
  distinct_trusted_domains: number
  std_dev_cents: number
  sources: EvidenceSource[]
}

export interface VerdictData {
  id: string
  verdict: string
  overcharge_multiplier: number
  fair_price_low: number
  fair_price_mid: number
  fair_price_high: number
  conservative_overpay: number
  expected_overpay: number
  currency: string
  confidence_score: number
  data_points_count: number
  explanation: string
  red_flags: string[]
  questions_to_ask: string[]
  sources: Record<string, number | boolean>
  evidence?: EvidenceSummary
  domain: string
  location_city: string
  location_country: string
  quoted_price?: number
  freshness?: {
    source: string
    live_search: boolean
    fetched_at?: string
    web_results_count?: number
    knowledge_results_count?: number
  }
  created_at?: string
}

export interface NegotiateData {
  target_price: number
  walk_away_above: number
  currency: string
  scripts: { role: string; text: string }[]
  tactics: { name: string; description: string }[]
  evidence_summary?: string
  quoted_price?: number
  domain?: string
  freshness?: {
    checked_at?: string | null
    refreshed?: boolean
    web_results_count?: number
    stale?: boolean
  }
}

export interface CounterOfferData {
  should_accept: boolean
  response_script: string
  reasoning: string
  suggested_counter: number
}

export interface HistoryItemData {
  id: string
  domain: string
  input_text: string
  location_city: string
  location_country: string
  currency: string
  verdict?: string
  overcharge_multiplier?: number
  fair_price_low?: number
  fair_price_high?: number
  quoted_price?: number
  feedback_final_price?: number
  created_at?: string
}

export interface PurchaseHistoryItemData {
  id: string
  make: string
  model: string
  year: number
  mileage_km: number
  mileage_miles: number | null
  asking_price: number
  vin: string | null
  city: string | null
  country: string
  currency: string
  asking_price_verdict?: 'fair' | 'high' | 'overcharge'
  overcharge_multiplier?: number
  target_offer?: number
  adjusted_low?: number
  adjusted_high?: number
  created_at?: string
}

export interface RecommendationItem {
  title: string
  description: string
  category: 'immediate' | 'alternative' | 'preventive' | 'community'
  icon: string
}

export interface RecommendationsData {
  personalized: RecommendationItem[]
  general: RecommendationItem[]
}

export interface SavingsData {
  total_saved: number
  total_queries: number
  overcharges_found: number
  currency: string
}

export interface SavingsProfileData {
  lifetime_saved: number
  potential_saved: number
  monthly_streak: number
  total_queries: number
  overcharges_found: number
  level: string
  level_label: string
  next_level: string
  next_level_label: string
  next_level_threshold: number
  progress_to_next: number
  currency: string
}

export interface ProvidersData {
  default: string
  available: { id: string; name: string; available: boolean }[]
}

export interface CommunityPriceData {
  id: string
  domain: string
  service_type: string
  description: string
  price_paid: number
  currency: string
  city: string
  country: string
  vendor_name?: string | null
  created_at?: string | null
}

export interface VendorScoreData {
  vendor_name: string
  city: string
  country: string
  domain: string
  report_count: number
  avg_price: number
  min_price: number
  max_price: number
}

export interface TrendPointData {
  date?: string | null
  query_count: number
  avg_multiplier?: number | null
  avg_fair_low?: number | null
  avg_fair_high?: number | null
}

export interface VehicleData {
  id: string
  make: string
  model: string
  year?: number | null
  mileage_km?: number | null
  nickname?: string | null
  country?: string | null
  created_at?: string | null
}

export interface VehicleMaintenanceItemData {
  service: string
  label: string
  interval_km: number
  next_due_km: number
  km_until_due: number
  status: 'overdue' | 'upcoming' | 'ok'
  query_hint: string
}

export interface VehicleMaintenanceData {
  vehicle: VehicleData
  maintenance: VehicleMaintenanceItemData[]
}

export interface PurchaseAnalyzeResponse {
  id: string
  [key: string]: unknown
}

export const api = {
  analyze: (data: {
    query: string
    domain?: string
    quoted_price?: number
    provider?: string
    lat?: number
    lng?: number
    city?: string
    country?: string
  }) => request<VerdictData>('/api/v1/analyze', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  analyzeImage: (
    file: File,
    provider?: string,
    lat?: number,
    lng?: number,
    city?: string,
    country?: string,
  ) => {
    const formData = new FormData()
    formData.append('image', file)
    formData.append('provider', provider || 'openai')
    if (lat !== undefined) formData.append('lat', String(lat))
    if (lng !== undefined) formData.append('lng', String(lng))
    if (city) formData.append('city', city)
    if (country) formData.append('country', country)
    return uploadRequest<VerdictData>('/api/v1/analyze/image', formData)
  },

  analyzeVoice: (
    audioBlob: Blob,
    provider?: string,
    lat?: number,
    lng?: number,
    city?: string,
    country?: string,
  ) => {
    const formData = new FormData()
    formData.append('audio', audioBlob, 'recording.webm')
    formData.append('provider', provider || 'openai')
    if (lat !== undefined) formData.append('lat', String(lat))
    if (lng !== undefined) formData.append('lng', String(lng))
    if (city) formData.append('city', city)
    if (country) formData.append('country', country)
    return uploadRequest<VerdictData>('/api/v1/analyze/voice', formData)
  },

  // ─── Reply Coach — message reply assistant ─────────────────────────────────
  // Reads the negotiation memory and drafts a
  // reply you can paste into iMessage/WhatsApp/Marketplace chat. Returns
  // 409 when the verdict has no memory yet (run an analysis first).
  draftMessageReply: (data: {
    query_id: string
    seller_message: string
    user_intent?: string
    tone?: 'polite' | 'firm' | 'walk_away' | 'friendly'
    provider?: string
  }) => request<PhotonReplyData>('/api/v1/messages/draft', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  // ─── Negotiation memory ────────────────────────────────────────────────
  listMemorySessions: () =>
    request<{ sessions: NegotiationMemoryData[] }>('/api/v1/memory/sessions'),

  getMemorySession: (queryId: string) =>
    request<NegotiationMemoryData>(`/api/v1/memory/sessions/${queryId}`),

  getVerdict: (id: string) => request<VerdictData>(`/api/v1/history/${id}`),

  getRecommendations: (queryId: string) =>
    request<RecommendationsData>(`/api/v1/recommend/${queryId}`),

  negotiate: (queryId: string) => request<NegotiateData>('/api/v1/negotiate', {
    method: 'POST',
    body: JSON.stringify({ query_id: queryId }),
  }),

  counterOffer: (data: {
    query_id: string
    counter_offer: number
    original_target: number
  }) => request<CounterOfferData>('/api/v1/negotiate/counter', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  feedback: (data: {
    query_id: string
    final_price: number
    outcome: string
    vendor_name?: string
  }) => request<{ status: string; savings: number; currency: string; streak: { monthly_dodged: number; lifetime_saved: number; level: string; milestone_unlocked: string | null } | null }>('/api/v1/feedback', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  getHistory: (page = 1, limit = 10) =>
    request<HistoryItemData[]>(`/api/v1/history?page=${page}&limit=${limit}`),

  getSavings: () => request<SavingsData>('/api/v1/savings/summary'),

  getSavingsProfile: () => request<SavingsProfileData>('/api/v1/savings/profile'),

  getProviders: () => request<ProvidersData>('/api/v1/providers'),

  // Community
  getCommunityPrices: (params?: { domain?: string }) => {
    const qs = new URLSearchParams()
    if (params?.domain) qs.set('domain', params.domain)
    return request<CommunityPriceData[]>(`/api/v1/community/prices?${qs}`)
  },

  getVendorScores: (params?: { domain?: string }) => {
    const qs = new URLSearchParams()
    if (params?.domain) qs.set('domain', params.domain)
    return request<VendorScoreData[]>(`/api/v1/community/vendors?${qs}`)
  },

  getTrends: (domain = 'auto') => {
    const qs = new URLSearchParams({ domain })
    return request<TrendPointData[]>(`/api/v1/community/trends?${qs}`)
  },

  // Vehicles
  getVehicles: () => request<VehicleData[]>('/api/v1/vehicles'),

  createVehicle: (data: { make: string; model: string; year?: number; mileage_km?: number; nickname?: string; country?: string }) =>
    request<VehicleData>('/api/v1/vehicles', { method: 'POST', body: JSON.stringify(data) }),

  getMaintenanceSchedule: (vehicleId: string) =>
    request<VehicleMaintenanceData>(`/api/v1/vehicles/${vehicleId}/maintenance`),

  analyzePurchase: (data: {
    make: string
    model: string
    year: number
    mileage_km: number
    asking_price: number
    provider?: string
    lat?: number
    lng?: number
    city?: string
    country?: string
    vin?: string
    diligence?: Record<string, unknown>
  }) => request<PurchaseAnalyzeResponse>('/api/v1/analyze/purchase/json', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  getPurchaseAnalysis: (analysisId: string) =>
    request<unknown>(`/api/v1/analyze/purchase/${analysisId}`),

  getPurchaseHistory: (page = 1, limit = 10) =>
    request<PurchaseHistoryItemData[]>(`/api/v1/history/purchases?page=${page}&limit=${limit}`),

  // Used-cars: extract listing fields from a screenshot. Doesn't consume a
  // quota credit — runs vision-only and returns parsed fields for the user
  // to confirm before submitting the actual analysis.
  analyzePurchaseScreenshot: (file: File, provider = 'anthropic') => {
    const formData = new FormData()
    formData.append('image', file)
    formData.append('provider', provider)
    return uploadRequest<{
      vin: string | null
      year: number | null
      make: string | null
      model: string | null
      trim: string | null
      mileage_km: number | null
      mileage_miles: number | null
      asking_price_cents: number | null
      city: string | null
      state: string | null
      title_status: string | null
      seller_type: string | null
      raw_notes: string | null
    }>('/api/v1/analyze/purchase/screenshot', formData)
  },

  joinWaitlist: (data: { email: string; source?: string }) =>
    request<{ status: string; created: boolean; message: string }>('/api/v1/waitlist', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ---- Scholar (.edu) verification -----------------------------------------

  studentVerifyStart: (email: string) =>
    request<{ sent: boolean; email_masked: string; expires_in_seconds: number }>(
      '/api/v1/auth/student/verify',
      { method: 'POST', body: JSON.stringify({ email }) },
    ),

  studentVerifyClerk: () =>
    request<{
      verified: boolean
      active_until: string
      discount_pct: number
      method: 'clerk'
      email_masked: string
    }>('/api/v1/auth/student/verify-clerk', { method: 'POST' }),

  studentVerifyConfirm: (email: string, otp: string) =>
    request<{ verified: boolean; active_until: string; discount_pct: number }>(
      '/api/v1/auth/student/confirm',
      { method: 'POST', body: JSON.stringify({ email, otp }) },
    ),

  studentStatus: () =>
    request<{ active: boolean; active_until: string | null; discount_pct: number }>(
      '/api/v1/auth/student/status',
    ),

  // ---- Extension Pro -------------------------------------------------------

  sellerRisk: (data: {
    listing_url: string
    seller_profile_url?: string
    platform?: string
  }) => request<SellerRiskData>('/api/v1/extension/seller-risk', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  replyCoach: (data: {
    query_id: string
    session_id: string
    user_message?: string
    seller_message?: string
    tone?: 'polite' | 'firm' | 'walk_away' | 'friendly'
  }) => request<ReplyCoachData>('/api/v1/extension/reply-coach', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  createListingWatch: (data: {
    listing_url: string
    fair_high_cents?: number
    last_known_price_cents?: number
    query_id?: string
    initial_risk_score?: number
  }) => request<ListingWatchData>('/api/v1/extension/listing-watch', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  listListingWatches: () =>
    request<ListingWatchData[]>('/api/v1/extension/listing-watch'),

  cancelListingWatch: (watchId: string) =>
    request<{ status: string; id: string }>(
      `/api/v1/extension/listing-watch/${watchId}`,
      { method: 'DELETE' },
    ),

  // ---- Extension device pairing -------------------------------------------
  // Confirms a pairing code on behalf of the signed-in user. The web app
  // calls this from /extension/link?code=…  — the backend wires the code
  // to the user's profile and parks a fresh `fvt_*` token for the
  // extension's /device/poll to drain.
  pairExtensionDevice: (code: string, label?: string) =>
    request<{ paired: boolean }>(
      '/api/v1/extension/device/pair',
      { method: 'POST', body: JSON.stringify({ code, label }) },
    ),

  // ─── Stripe billing ──────────────────────────────────────────────────────
  // POST a price_key to /billing/checkout; backend returns the hosted URL.
  // The price_key matches the keys defined on the backend Literal type.
  createCheckoutSession: (price_key: StripePriceKey) =>
    request<{ url: string; session_id: string }>(
      '/api/v1/billing/checkout',
      { method: 'POST', body: JSON.stringify({ price_key }) },
    ),

  createPortalSession: () =>
    request<{ url: string }>(
      '/api/v1/billing/portal',
      { method: 'POST' },
    ),

  getBillingStatus: () =>
    request<BillingStatusData>('/api/v1/billing/status'),

  changePlan: (price_key: StripePriceKey) =>
    request<{
      status: string
      plan: string
      interval: 'monthly' | 'yearly' | null
      price_key: StripePriceKey
      proration_behavior: string
    }>('/api/v1/billing/change-plan', {
      method: 'POST',
      body: JSON.stringify({ price_key }),
    }),

  previewChangePlan: (price_key: StripePriceKey) =>
    request<ProrationPreviewData>('/api/v1/billing/change-plan/preview', {
      method: 'POST',
      body: JSON.stringify({ price_key }),
    }),

  createPortalUpdateSession: (price_key: StripePriceKey) =>
    request<{ url: string }>('/api/v1/billing/portal-update', {
      method: 'POST',
      body: JSON.stringify({ price_key }),
    }),

  cancelSubscription: () =>
    request<{
      cancel_at_period_end: boolean
      current_period_end: string | null
      status: string
    }>('/api/v1/billing/cancel', { method: 'POST' }),

  resumeSubscription: () =>
    request<{
      cancel_at_period_end: boolean
      current_period_end: string | null
      status: string
    }>('/api/v1/billing/resume', { method: 'POST' }),

  // ─── Used-car live negotiation chat ──────────────────────────────────────
  // Stateless on the server — caller passes the prior `history` every turn
  // (persisted client-side in localStorage). Returns the next coach reply.
  purchaseNegotiateChat: (data: {
    purchase_id: string
    history: PurchaseChatTurn[]
    seller_message?: string
    user_message?: string
  }) => request<PurchaseChatResponseData>('/api/v1/negotiate/purchase-chat', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  // ─── Public share tokens ─────────────────────────────────────────────────
  // Mints (or reuses) a public capability token for a verdict so it can be
  // posted on social. Anonymous-safe: the verdict UUID is the capability
  // for unauthed callers.
  createShareToken: (kind: 'query' | 'purchase', record_id: string) =>
    request<CreateShareResponseData>('/api/v1/share', {
      method: 'POST',
      body: JSON.stringify({ kind, record_id }),
    }),

  // Public read — no auth needed. The /share/[token] page calls this from
  // both server-rendered metadata and the client component.
  getShare: (token: string) =>
    request<PublicShareData>(`/api/v1/share/${encodeURIComponent(token)}`),
}

export interface PurchaseChatTurn {
  role: 'user' | 'seller' | 'assistant'
  content: string
  at?: string
  suggested_price_cents?: number | null
  tone?: string | null
}

export interface PurchaseChatResponseData {
  reply: string
  suggested_price_cents: number | null
  should_accept: boolean
  tone: string | null
  next_move_hint: string | null
}

export interface CreateShareResponseData {
  token: string
  url: string
  expires_at: string | null
}

export interface PublicShareData {
  kind: 'query' | 'purchase'
  domain: string
  currency: string
  quoted_price_cents: number | null
  fair_low_cents: number | null
  fair_high_cents: number | null
  overcharge_multiplier: number | null
  verdict: string | null
  title: string
  subtitle: string | null
  created_at: string | null
  view_count: number
}

export interface ProrationPreviewData {
  current_plan: string
  current_interval: 'monthly' | 'yearly' | null
  new_plan: string
  new_interval: 'monthly' | 'yearly' | null
  amount_due_cents: number
  proration_credit_cents: number
  proration_charge_cents: number
  next_cycle_cents: number
  currency: string
  next_invoice_at: string | null
}

export interface BillingStatusData {
  plan: 'scout' | 'signal' | 'command' | string
  interval: 'monthly' | 'yearly' | null
  price_key: StripePriceKey | null
  is_scholar: boolean
  cancel_at_period_end: boolean
  current_period_end: string | null
  status: string | null
  has_billing_history: boolean
  has_active_subscription: boolean
}

// Mirrors the backend `Literal` on `app/routers/billing.py:PriceKey`.
export type StripePriceKey =
  | 'signal_monthly'
  | 'signal_yearly'
  | 'signal_scholar_monthly'
  | 'signal_scholar_yearly'
  | 'command_monthly'
  | 'command_yearly'
  | 'command_scholar_monthly'
  | 'command_scholar_yearly'
  | 'boost'

export interface SellerRiskReason {
  key: string
  label: string
  severity: 'info' | 'warn' | 'flag'
}

export interface SellerRiskData {
  score: number
  band: 'green' | 'amber' | 'red'
  summary: string
  reasons: SellerRiskReason[]
  seller: Record<string, unknown>
  data_sources: string[]
}

export interface ReplyCoachMessageData {
  role: 'user' | 'assistant' | 'seller'
  content: string
  at?: string | null
  tone?: string | null
}

export interface ReplyCoachData {
  reply: string
  tone: string
  suggested_price_cents: number | null
  messages: ReplyCoachMessageData[]
}

export interface ListingWatchData {
  id: string
  listing_url: string
  platform: string | null
  status: string
  fair_high_cents: number | null
  last_known_price_cents: number | null
  initial_risk_score: number | null
  next_check_at: string | null
  last_checked_at: string | null
  created_at: string | null
}

// ─── Faivri partner-tech response shapes ───────────────────────────────────

export interface PhotonReplyData {
  reply: string
  tone: 'polite' | 'firm' | 'walk_away' | 'friendly'
  suggested_price_cents: number | null
  served_by: 'gmi_cloud' | 'anthropic' | 'openai' | 'nia'
  grounded_in: {
    fair_low_cents: number | null
    fair_high_cents: number | null
    walk_away_cents: number | null
    prior_messages: number
    prior_counters: number
  }
}

export interface NegotiationMemoryData {
  query_id: string
  quoted_price_cents: number | null
  fair_low_cents: number | null
  fair_high_cents: number | null
  walk_away_cents: number | null
  target_offer_cents: number | null
  counter_offer_history: Array<{
    counter_offer_cents: number
    original_target_cents: number
    at: string | null
  }>
  conversation_messages: Array<{
    role: string
    content: string
    at?: string
  }>
  seller_tone: string | null
  last_seen_at: string | null
}

// Boost Pack helpers — used by OutOfAnalysesModal and the usage widget.

export interface BoostCheckoutResponse {
  checkout_url: string | null
  configured: boolean
  credits_per_pack?: number
  price_cents?: number
}

export function getBoostCheckout(): Promise<BoostCheckoutResponse> {
  return request<BoostCheckoutResponse>('/api/v1/usage/boost/checkout')
}
