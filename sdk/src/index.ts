/**
 * Faivri TypeScript SDK.
 *
 * Single class with four capability groups: analyze, negotiate, intel
 * (history/community/vehicles), account (usage/savings). Every method
 * returns the parsed JSON response or throws `FaivriError` with the
 * server's detail message preserved so callers can surface it in toasts.
 *
 * Auth: pass `apiKey` for server-side usage, or `accessToken` (string
 * or async getter) for browser usage with a short-lived JWT.
 */

type TokenProvider =
  | string
  | null
  | undefined
  | (() => string | null | Promise<string | null>)

export interface FaivriClientOptions {
  /** Base URL of the Faivri API. Defaults to the hosted endpoint. */
  baseUrl?: string
  /** Server-side API key (`x-api-key` header). */
  apiKey?: string
  /** Client-side short-lived JWT or async getter returning one. */
  accessToken?: TokenProvider
}

export interface AnalyzeInput {
  query: string
  domain?: string
  quoted_price?: number
  provider?: string
  lat?: number
  lng?: number
  city?: string
  country?: string
}

export interface CounterOfferInput {
  query_id: string
  counter_offer: number
  original_target: number
}

export interface FeedbackInput {
  query_id: string
  final_price: number
  outcome: string
  vendor_name?: string
}

export interface PurchaseInput {
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
}

export interface VehicleInput {
  make: string
  model: string
  year?: number
  mileage_km?: number
  nickname?: string
  country?: string
}

export interface UsageStatus {
  plan: string
  limit: number | null
  used: number
  remaining: number | null
  reset_at: string | null
  unlimited: boolean
}

export interface PlanCatalog {
  plans: { key: string; monthly_limit: number | null; unlimited: boolean }[]
}

export interface FeedbackResult {
  status: string
  savings: number
  currency: string
}

export interface WaitlistResult {
  status: string
  created: boolean
  message: string
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

const DEFAULT_BASE_URL = 'https://faircheck-backend-production.up.railway.app'

export class FaivriClient {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly accessToken?: TokenProvider

  constructor(options: FaivriClientOptions = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.accessToken = options.accessToken
  }

  // ── Analyze ───────────────────────────────────────────────────────
  analyze(payload: AnalyzeInput): Promise<VerdictData> {
    return this.request<VerdictData>('/api/v1/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  analyzeImage(
    file: File,
    options?: Omit<AnalyzeInput, 'query' | 'quoted_price' | 'domain'>,
  ): Promise<VerdictData> {
    const formData = this.locationForm(options)
    formData.append('image', file)
    formData.append('provider', options?.provider || 'anthropic')
    return this.upload<VerdictData>('/api/v1/analyze/image', formData)
  }

  analyzeVoice(
    audioBlob: Blob,
    options?: Omit<AnalyzeInput, 'query' | 'quoted_price' | 'domain'>,
  ): Promise<VerdictData> {
    const formData = this.locationForm(options)
    formData.append('audio', audioBlob, 'recording.webm')
    formData.append('provider', options?.provider || 'anthropic')
    return this.upload<VerdictData>('/api/v1/analyze/voice', formData)
  }

  analyzePurchase(payload: PurchaseInput): Promise<VerdictData> {
    return this.request<VerdictData>('/api/v1/analyze/purchase/json', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  getPurchaseAnalysis(analysisId: string): Promise<VerdictData> {
    return this.request<VerdictData>(`/api/v1/analyze/purchase/${analysisId}`)
  }

  // ── Negotiate ────────────────────────────────────────────────────
  negotiate(queryId: string): Promise<NegotiateData> {
    return this.request<NegotiateData>('/api/v1/negotiate', {
      method: 'POST',
      body: JSON.stringify({ query_id: queryId }),
    })
  }

  counterOffer(payload: CounterOfferInput): Promise<CounterOfferData> {
    return this.request<CounterOfferData>('/api/v1/negotiate/counter', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  feedback(payload: FeedbackInput): Promise<FeedbackResult> {
    return this.request<FeedbackResult>('/api/v1/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  // ── History ──────────────────────────────────────────────────────
  getHistory(page = 1, limit = 10): Promise<HistoryItemData[]> {
    return this.request<HistoryItemData[]>(
      `/api/v1/history?page=${page}&limit=${limit}`,
    )
  }

  getVerdict(id: string): Promise<VerdictData> {
    return this.request<VerdictData>(`/api/v1/history/${id}`)
  }

  deleteVerdict(id: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/api/v1/history/${id}`, {
      method: 'DELETE',
    })
  }

  purgeHistory(): Promise<{ status: string; purged: number }> {
    return this.request<{ status: string; purged: number }>(
      '/api/v1/history/purge',
      { method: 'POST' },
    )
  }

  getRecommendations(queryId: string): Promise<RecommendationsData> {
    return this.request<RecommendationsData>(`/api/v1/recommend/${queryId}`)
  }

  // ── Community intel ──────────────────────────────────────────────
  getCommunityPrices(
    domain?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const qs = new URLSearchParams()
    if (domain) qs.set('domain', domain)
    return this.request<Array<Record<string, unknown>>>(
      `/api/v1/community/prices?${qs.toString()}`,
    )
  }

  getVendorScores(
    domain?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const qs = new URLSearchParams()
    if (domain) qs.set('domain', domain)
    return this.request<Array<Record<string, unknown>>>(
      `/api/v1/community/vendors?${qs.toString()}`,
    )
  }

  getTrends(domain = 'auto'): Promise<Array<Record<string, unknown>>> {
    const qs = new URLSearchParams({ domain })
    return this.request<Array<Record<string, unknown>>>(
      `/api/v1/community/trends?${qs.toString()}`,
    )
  }

  // ── Vehicles ─────────────────────────────────────────────────────
  getVehicles(): Promise<Array<Record<string, unknown>>> {
    return this.request<Array<Record<string, unknown>>>('/api/v1/vehicles')
  }

  createVehicle(payload: VehicleInput): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/api/v1/vehicles', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  getMaintenanceSchedule(
    vehicleId: string,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/v1/vehicles/${vehicleId}/maintenance`,
    )
  }

  // ── Account: usage + savings ─────────────────────────────────────
  getUsage(): Promise<UsageStatus> {
    return this.request<UsageStatus>('/api/v1/usage')
  }

  getPlans(): Promise<PlanCatalog> {
    return this.request<PlanCatalog>('/api/v1/usage/plans')
  }

  getSavings(): Promise<SavingsData> {
    return this.request<SavingsData>('/api/v1/savings/summary')
  }

  getSavingsProfile(): Promise<SavingsProfileData> {
    return this.request<SavingsProfileData>('/api/v1/savings/profile')
  }

  // ── Misc ─────────────────────────────────────────────────────────
  getProviders(): Promise<ProvidersData> {
    return this.request<ProvidersData>('/api/v1/providers')
  }

  joinWaitlist(email: string, source?: string): Promise<WaitlistResult> {
    return this.request<WaitlistResult>('/api/v1/waitlist', {
      method: 'POST',
      body: JSON.stringify({ email, source }),
    })
  }

  // ── Internals ────────────────────────────────────────────────────
  private locationForm(
    options?: Pick<AnalyzeInput, 'lat' | 'lng' | 'city' | 'country'>,
  ): FormData {
    const formData = new FormData()
    if (options?.lat !== undefined) formData.append('lat', String(options.lat))
    if (options?.lng !== undefined) formData.append('lng', String(options.lng))
    if (options?.city) formData.append('city', options.city)
    if (options?.country) formData.append('country', options.country)
    return formData
  }

  private async upload<T>(path: string, formData: FormData): Promise<T> {
    const headers = await this.buildHeaders(false)
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    })
    return this.readResponse<T>(res)
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = await this.buildHeaders(true)
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options?.headers || {}),
      },
    })
    return this.readResponse<T>(res)
  }

  private async readResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.json().catch(() => ({
        detail: `Request failed (${res.status})`,
      }))
      const detail = (body as { detail?: unknown })?.detail
      if (typeof detail === 'string') {
        throw new FaivriError(detail, res.status, body)
      }
      if (detail && typeof detail === 'object') {
        const message =
          (detail as { message?: string }).message || `API error: ${res.status}`
        throw new FaivriError(message, res.status, body)
      }
      throw new FaivriError(`API error: ${res.status}`, res.status, body)
    }
    if (res.status === 204) return undefined as unknown as T
    return res.json() as Promise<T>
  }

  private async buildHeaders(
    withJsonContentType: boolean,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {}
    if (withJsonContentType) headers['Content-Type'] = 'application/json'
    if (this.apiKey) headers['x-api-key'] = this.apiKey

    const token = await this.resolveAccessToken()
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }

  private async resolveAccessToken(): Promise<string | null> {
    if (!this.accessToken) return null
    if (typeof this.accessToken === 'function') {
      const value = await this.accessToken()
      return value || null
    }
    return this.accessToken || null
  }
}

/**
 * Thrown when the Faivri API returns a non-2xx response.
 *
 * `status` is the HTTP code and `body` is the raw JSON payload (if any) so
 * callers can branch on 402 (quota exhausted) or 429 (rate limited) and
 * render the plan/remaining fields the server already computed.
 */
export class FaivriError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'FaivriError'
    this.status = status
    this.body = body
  }
}

export function createFaivriClient(
  options?: FaivriClientOptions,
): FaivriClient {
  return new FaivriClient(options)
}
