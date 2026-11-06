/** Explicit owner HTTP fixture using the pinned framework's returned shape. */
export function fixtureNativeSession(tenantId: string, userId: string, platformAdmin = false) {
  return {
    session: {
      id: "fixture-current-session",
      token: "fixture-secret-session-token",
      userId,
      activeOrganizationId: tenantId,
      expiresAt: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    user: {
      id: userId,
      name: "Fixture",
      email: "fixture@example.test",
      emailVerified: true,
      image: null,
      platformAdmin,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  }
}
