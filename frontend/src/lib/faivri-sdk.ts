import type {
  CounterOfferData,
  HistoryItemData,
  NegotiateData,
  ProvidersData,
  RecommendationsData,
  SavingsData,
  SavingsProfileData,
  VerdictData,
} from '@/lib/api'

type TokenProvider = string | null | undefined | (() => string | null | Promise<string | null>)

export interface FaivriClientOptions {
  baseUrl?: string
  apiKey?: string
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

/**
 * Faivri TypeScript SDK.
 *
 * Single class, four capability groups: analyze, negotiate, intel
 * (history/community/vehicles), account (usage/savings). Every method
 * returns the parsed JSON response or throws with the server's detail
 * message preserved so callers can surface it in toasts.
 *
 * Auth: pass `apiKey` for server-side usage, or `accessToken` (string
 * or async getter) for browser usage with a Clerk-issued JWT.
 */
export class FaivriClient {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly accessToken?: TokenProvider

  constructor(options: FaivriClientOptions = {}) {
    this.baseUrl = (options.baseUrl || 'http://localhost:8000').replace(/\/$/, '')
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
    formData.append('provider', options?.provider || 'openai')
    return this.upload<VerdictData>('/api/v1/analyze/image', formData)
  }

  analyzeVoice(
    audioBlob: Blob,
    options?: Omit<AnalyzeInput, 'query' | 'quoted_price' | 'domain'>,
  ): Promise<VerdictData> {
    const formData = this.locationForm(options)
    formData.append('audio', audioBlob, 'recording.webm')
    formData.append('provider', options?.provider || 'openai')
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
    return this.request<HistoryItemData[]>(`/api/v1/history?page=${page}&limit=${limit}`)
  }

  getVerdict(id: string): Promise<VerdictData> {
    return this.request<VerdictData>(`/api/v1/history/${id}`)
  }

  deleteVerdict(id: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/api/v1/history/${id}`, { method: 'DELETE' })
  }

  purgeHistory(): Promise<{ status: string; purged: number }> {
    return this.request<{ status: string; purged: number }>('/api/v1/history/purge', {
      method: 'POST',
    })
  }

  getRecommendations(queryId: string): Promise<RecommendationsData> {
    return this.request<RecommendationsData>(`/api/v1/recommend/${queryId}`)
  }

  // ── Community intel ──────────────────────────────────────────────
  getCommunityPrices(domain?: string): Promise<Array<Record<string, unknown>>> {
    const qs = new URLSearchParams()
    if (domain) qs.set('domain', domain)
    return this.request<Array<Record<string, unknown>>>(`/api/v1/community/prices?${qs.toString()}`)
  }

  getVendorScores(domain?: string): Promise<Array<Record<string, unknown>>> {
    const qs = new URLSearchParams()
    if (domain) qs.set('domain', domain)
    return this.request<Array<Record<string, unknown>>>(`/api/v1/community/vendors?${qs.toString()}`)
  }

  getTrends(domain = 'auto'): Promise<Array<Record<string, unknown>>> {
    const qs = new URLSearchParams({ domain })
    return this.request<Array<Record<string, unknown>>>(`/api/v1/community/trends?${qs.toString()}`)
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

  getMaintenanceSchedule(vehicleId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/v1/vehicles/${vehicleId}/maintenance`)
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
  private locationForm(options?: Pick<AnalyzeInput, 'lat' | 'lng' | 'city' | 'country'>): FormData {
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
      const body = await res.json().catch(() => ({ detail: `Request failed (${res.status})` }))
      const detail = body?.detail
      // Surface server detail verbatim so callers can render quota/402
      // and rate-limit/429 messages without reparsing.
      if (typeof detail === 'string') throw new FaivriError(detail, res.status, body)
      if (detail && typeof detail === 'object') {
        const message = (detail as { message?: string }).message || `API error: ${res.status}`
        throw new FaivriError(message, res.status, body)
      }
      throw new FaivriError(`API error: ${res.status}`, res.status, body)
    }
    if (res.status === 204) return undefined as unknown as T
    return res.json() as Promise<T>
  }

  private async buildHeaders(withJsonContentType: boolean): Promise<Record<string, string>> {
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

/** Thrown when the Faivri API returns a non-2xx response.
 *
 * `status` is the HTTP code and `body` is the raw JSON payload (if any), so
 * callers can branch on 402 (quota exhausted) or 429 (rate limited) and render
 * the plan/remaining fields the server already computed.
 */
export class FaivriError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'FaivriError'
    this.status = status
    this.body = body
  }
}

export function createFaivriClient(options?: FaivriClientOptions): FaivriClient {
  return new FaivriClient(options)
}
