import type { CapabilityFailure } from "./types.js"

export function invalidCapabilityQuery(): CapabilityFailure {
  return {
    ok: false,
    status: 400,
    code: "invalid_query_parameter",
    message: "Capability query parameters are invalid",
  }
}

export function capabilityResponseInvalid(): CapabilityFailure {
  return {
    ok: false,
    status: 502,
    code: "capability_response_invalid",
    message: "Capability returned an invalid response",
  }
}

export function capabilityUnavailable(): CapabilityFailure {
  return {
    ok: false,
    status: 503,
    code: "capability_unavailable",
    message: "Capability is temporarily unavailable",
  }
}
