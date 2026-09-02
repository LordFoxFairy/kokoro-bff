// Public compatibility barrel. The Agent boundary is split by responsibility:
// identity, launch/control commands, and chat projections each have a small
// independently testable module instead of one god adapter.
export * from "./agent/index.js"
