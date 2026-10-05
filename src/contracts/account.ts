export type AgentConnectionSetup = {
  platform: "telegram" | "line" | "slack"
  status: "disconnected" | "pending" | "connected" | "expired"
  qr_value: string
  continue_url: string
  expires_at: string
}

export type BillingSummary = {
  credit_account_id: string
  status: "active" | "disabled"
  available_micros: string
  held_micros: string
}

export type BillingLedgerEntry = {
  journal_id: string
  sequence: string
  delta_micros: string
  balance_after_micros: string
  source_kind: string
  source_ref: string
  created_at: string
}

export type BillingLedger = {
  items: BillingLedgerEntry[]
  page: { next_cursor: string | null }
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
