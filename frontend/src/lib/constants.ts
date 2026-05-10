export const DOMAINS = [
  { id: 'auto', label: 'Car Repair', icon: 'Wrench' },
  { id: 'medical', label: 'Prescription', icon: 'Pill' },
  { id: 'home', label: 'Contractor', icon: 'Home' },
  { id: 'legal', label: 'Legal', icon: 'Shield' },
] as const

export function formatPrice(amount: number, currency: string = 'USD'): string {
  const value = amount / 100
  return '$' + value.toLocaleString('en-US')
}

export function formatPriceShort(amount: number, currency: string = 'USD'): string {
  const value = amount / 100
  if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M'
  if (value >= 1000) return '$' + (value / 1000).toFixed(1) + 'K'
  return '$' + value.toLocaleString('en-US')
}

export const CHROME_EXTENSION_URL =
  'https://chromewebstore.google.com/detail/faivri-%E2%80%94-price-check-nego/lkihpdanpbjbeldkaoioidnhlhjimfgc'

export const SAVINGS_LEVELS = [
  { level: 'newcomer', label: 'Newcomer', threshold: 0 },
  { level: 'novice', label: 'Novice', threshold: 10000 },
  { level: 'savvy', label: 'Savvy', threshold: 50000 },
  { level: 'expert', label: 'Expert', threshold: 200000 },
  { level: 'master', label: 'Master Negotiator', threshold: 500000 },
] as const
