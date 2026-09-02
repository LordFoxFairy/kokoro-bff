export type AgentConnectionSetup = {
  platform: "telegram" | "line" | "slack"
  status: "disconnected" | "pending" | "connected" | "expired"
  qr_value: string
  continue_url: string
  expires_at: string
}

export type LibraryItem = {
  id: string
  title: string
  type: "document" | "spreadsheet" | "presentation" | "image" | "other"
  created_at: string
  url: string
}

export type BillingSummary = {
  balance: number
  currency: string
  period: string
  usage: number
}

export type BillingPlan = {
  id: string
  key: string
  name: string
  currency: string
  amount_minor: string
  credit_micros: string
  billing_interval: "once" | "month" | "year"
}
