'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Activity, AlertTriangle, Car, CheckCircle, ChevronRight, Clock, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { reveal, stagger } from '@/lib/motion'
import { useToast } from '@/components/ui/Toast'
import AnimatedCounter from '@/components/ui/AnimatedCounter'
import LivePulse from '@/components/ui/LivePulse'
import { SkeletonListPage } from '@/components/ui/Skeleton'

interface Vehicle {
  id: string
  make: string
  model: string
  year?: number | null
  mileage_km?: number | null
  nickname?: string | null
  country?: string | null
  created_at?: string | null
}

interface MaintenanceItem {
  service: string
  label: string
  interval_km: number
  next_due_km: number
  km_until_due: number
  status: 'overdue' | 'upcoming' | 'ok'
  query_hint: string
}

interface MaintenanceSchedule {
  vehicle: Vehicle
  maintenance: MaintenanceItem[]
}

const STATUS_CONFIG = {
  overdue: {
    title: 'Overdue',
    icon: AlertTriangle,
    tone: 'text-[var(--red-text)]',
    surface: 'card-danger',
  },
  upcoming: {
    title: 'Upcoming',
    icon: Clock,
    tone: 'text-[var(--amber-text)]',
    surface: 'card-warning',
  },
  ok: {
    title: 'All good',
    icon: CheckCircle,
    tone: 'text-[var(--green-text)]',
    surface: 'card-green',
  },
}

function formatKm(km: number): string {
  if (Math.abs(km) >= 1000) return `${(km / 1000).toFixed(1)}k km`
  return `${km} km`
}

function vehicleDisplayName(vehicle: Vehicle): string {
  if (vehicle.nickname) return vehicle.nickname
  const parts = [vehicle.make, vehicle.model]
  if (vehicle.year) parts.push(String(vehicle.year))
  return parts.join(' ')
}

export default function GaragePage() {
  const router = useRouter()
  const { toast } = useToast()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [maintenance, setMaintenance] = useState<MaintenanceSchedule | null>(null)
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null)
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [vehiclesError, setVehiclesError] = useState<string | null>(null)
  const [vehiclesAttempt, setVehiclesAttempt] = useState(0)
  const [loadingMaintenance, setLoadingMaintenance] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [mileageKm, setMileageKm] = useState('')
  const [nickname, setNickname] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoadingVehicles(true)
    setVehiclesError(null)
    api
      .getVehicles()
      .then((res) => {
        if (!cancelled) setVehicles(res)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Could not load your vehicles. Please try again.'
        setVehiclesError(msg)
      })
      .finally(() => {
        if (!cancelled) setLoadingVehicles(false)
      })
    return () => {
      cancelled = true
    }
  }, [vehiclesAttempt])

  async function handleAddVehicle(event: React.FormEvent) {
    event.preventDefault()
    if (!make.trim() || !model.trim()) return

    setSubmitting(true)
    try {
      const vehicle = await api.createVehicle({
        make: make.trim(),
        model: model.trim(),
        year: year ? parseInt(year, 10) : undefined,
        mileage_km: mileageKm ? parseInt(mileageKm, 10) : undefined,
        nickname: nickname.trim() || undefined,
      })
      setVehicles((prev) => [vehicle, ...prev])
      setMake('')
      setModel('')
      setYear('')
      setMileageKm('')
      setNickname('')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not add that vehicle. Please try again.'
      toast(msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function fetchMaintenance(vehicleId: string) {
    setLoadingMaintenance(true)
    setMaintenance(null)
    setMaintenanceError(null)
    try {
      const schedule = await api.getMaintenanceSchedule(vehicleId)
      setMaintenance(schedule)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not load the maintenance schedule.'
      setMaintenanceError(msg)
    } finally {
      setLoadingMaintenance(false)
    }
  }

  async function handleSelectVehicle(vehicleId: string) {
    if (selectedVehicleId === vehicleId) {
      setSelectedVehicleId(null)
      setMaintenance(null)
      setMaintenanceError(null)
      return
    }
    setSelectedVehicleId(vehicleId)
    await fetchMaintenance(vehicleId)
  }

  if (loadingVehicles) {
    return <SkeletonListPage rows={4} />
  }

  if (vehiclesError && vehicles.length === 0) {
    return (
      <section className="ui-section">
        <div className="ui-container max-w-md mx-auto text-center py-20">
          <p className="text-[var(--type-16)] text-[var(--text-2)]">{vehiclesError}</p>
          <button
            onClick={() => setVehiclesAttempt((n) => n + 1)}
            className="ui-button-secondary mt-4"
          >
            Try again
          </button>
        </div>
      </section>
    )
  }

  const overdueItems = maintenance?.maintenance.filter((item) => item.status === 'overdue') || []
  const upcomingItems = maintenance?.maintenance.filter((item) => item.status === 'upcoming') || []
  const okItems = maintenance?.maintenance.filter((item) => item.status === 'ok') || []
  const fleetMileage = vehicles.reduce((sum, v) => sum + (v.mileage_km || 0), 0)

  return (
    <section className="ui-section pb-20 md:pb-12">
      <div className="ui-container space-y-6">
        <motion.header {...reveal(0)} className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--warm-bg)] p-5 md:p-7">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[radial-gradient(circle_at_center,rgba(35,131,226,0.18),transparent_70%)] blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2">
              <LivePulse label="Synced" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-4)]">Garage</p>
            </div>
            <h1 className="ui-title-section mt-2">Garage planner</h1>
            <p className="mt-2 text-[var(--type-16)] text-[var(--text-3)]">
              Keep vehicle upkeep predictable with due-mileage reminders and one-click quote checks.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-4)]">Vehicles</p>
                <p className="mt-1 text-[var(--type-18)] font-semibold text-[var(--text-1)]">
                  <AnimatedCounter target={vehicles.length} duration={1.0} />
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-4)]">Overdue items</p>
                <p className="mt-1 text-[var(--type-18)] font-semibold text-[var(--red-text)]">
                  <AnimatedCounter target={overdueItems.length} duration={1.0} />
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-4)]">Fleet mileage</p>
                <p className="mt-1 text-[var(--type-18)] font-semibold text-[var(--text-1)]">{fleetMileage > 0 ? formatKm(fleetMileage) : '--'}</p>
              </div>
            </div>
          </div>
        </motion.header>

        <motion.section {...reveal(0.05)} className="glass-strong perspective-stack rounded-2xl p-5">
          <h2 className="mb-3 inline-flex items-center gap-2 text-[var(--type-18)] font-semibold text-[var(--text-1)]">
            <Plus className="h-4 w-4 text-[var(--blue)]" />
            Add vehicle
          </h2>
          <form onSubmit={handleAddVehicle} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              type="text"
              placeholder="Make *"
              value={make}
              onChange={(event) => setMake(event.target.value)}
              required
              className="rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-3 py-2.5 text-[var(--type-14)] outline-none transition-colors focus:border-[var(--border-accent)]"
            />
            <input
              type="text"
              placeholder="Model *"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              required
              className="rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-3 py-2.5 text-[var(--type-14)] outline-none transition-colors focus:border-[var(--border-accent)]"
            />
            <input
              type="number"
              placeholder="Year"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              min={1900}
              max={2099}
              className="rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-3 py-2.5 text-[var(--type-14)] outline-none transition-colors focus:border-[var(--border-accent)]"
            />
            <input
              type="number"
              placeholder="Current mileage (km)"
              value={mileageKm}
              onChange={(event) => setMileageKm(event.target.value)}
              min={0}
              className="rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-3 py-2.5 text-[var(--type-14)] outline-none transition-colors focus:border-[var(--border-accent)]"
            />
            <input
              type="text"
              placeholder="Nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              className="rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-3 py-2.5 text-[var(--type-14)] outline-none transition-colors focus:border-[var(--border-accent)]"
            />
            <button type="submit" disabled={submitting || !make.trim() || !model.trim()} className="ui-button-primary">
              {submitting ? 'Adding...' : 'Add vehicle'}
            </button>
          </form>
        </motion.section>

        {vehicles.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center text-[var(--text-3)]">
            No vehicles yet. Add your first one to unlock maintenance reminders.
          </div>
        ) : (
          <motion.section {...reveal(0.1)} className="space-y-3">
            <h2 className="text-[var(--type-18)] font-semibold text-[var(--text-1)]">Your vehicles</h2>
            <div className="space-y-2">
              {vehicles.map((vehicle, index) => {
                const isSelected = selectedVehicleId === vehicle.id
                return (
                  <motion.button
                    key={vehicle.id}
                    {...stagger(index * 0.03)}
                    onClick={() => handleSelectVehicle(vehicle.id)}
                    className={`glass perspective-stack flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left ${
                      isSelected ? 'border-[var(--border-accent)]' : ''
                    }`}
                  >
                    <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-accent)] bg-[var(--accent-wash)]">
                      <Car className="h-4 w-4 text-[var(--blue)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[var(--type-16)] font-semibold text-[var(--text-1)]">
                        {vehicleDisplayName(vehicle)}
                      </p>
                      <p className="text-[var(--type-12)] text-[var(--text-3)]">
                        {vehicle.mileage_km ? formatKm(vehicle.mileage_km) : 'Mileage not set'}
                      </p>
                    </div>
                    <ChevronRight className={`h-4 w-4 text-[var(--text-3)] transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                  </motion.button>
                )
              })}
            </div>
          </motion.section>
        )}

        {selectedVehicleId && (
          <motion.section {...reveal(0.14)} className="space-y-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--text-3)]" />
              <h2 className="text-[var(--type-18)] font-semibold text-[var(--text-1)]">Maintenance schedule</h2>
            </div>

            {loadingMaintenance ? (
              <div className="flex justify-center py-10">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
              </div>
            ) : maintenanceError ? (
              <div className="glass rounded-2xl p-6 text-center">
                <p className="text-[var(--type-14)] text-[var(--text-2)]">{maintenanceError}</p>
                <button
                  onClick={() => fetchMaintenance(selectedVehicleId)}
                  className="ui-button-secondary mt-3"
                >
                  Try again
                </button>
              </div>
            ) : !maintenance || maintenance.maintenance.length === 0 ? (
              <div className="glass rounded-2xl p-6 text-center text-[var(--text-3)]">
                No maintenance data available for this vehicle.
              </div>
            ) : (
              <div className="space-y-4">
                {[
                  { key: 'overdue', items: overdueItems },
                  { key: 'upcoming', items: upcomingItems },
                  { key: 'ok', items: okItems },
                ].map((group) => {
                  if (group.items.length === 0) return null
                  const config = STATUS_CONFIG[group.key as keyof typeof STATUS_CONFIG]
                  const Icon = config.icon
                  return (
                    <section key={group.key} className="space-y-2">
                      <h3 className={`ui-caption ${config.tone}`}>
                        {config.title} ({group.items.length})
                      </h3>
                      <div className="space-y-2">
                        {group.items.map((item, index) => (
                          <motion.article
                            key={item.service}
                            {...stagger(index * 0.03)}
                            className={`${config.surface} perspective-stack rounded-2xl px-4 py-3`}
                          >
                            <div className="flex items-center gap-3">
                              <Icon className={`h-4 w-4 ${config.tone}`} />
                              <div className="min-w-0 flex-1">
                                <p className="text-[var(--type-16)] font-semibold text-[var(--text-1)]">{item.label}</p>
                                <p className="text-[var(--type-12)] text-[var(--text-3)]">
                                  {item.status === 'overdue'
                                    ? `${formatKm(Math.abs(item.km_until_due))} overdue`
                                    : `${formatKm(item.km_until_due)} until due`}
                                </p>
                              </div>
                              {item.status === 'overdue' && (
                                <button
                                  onClick={() => router.push(`/?query=${encodeURIComponent(item.query_hint)}`)}
                                  className="ui-button-secondary !py-2 text-[var(--type-12)]"
                                >
                                  Check quote
                                </button>
                              )}
                            </div>
                          </motion.article>
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
            )}
          </motion.section>
        )}
      </div>
    </section>
  )
}
