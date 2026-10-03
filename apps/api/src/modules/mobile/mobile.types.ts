/**
 * B1 (phase 7 mobile): request augmentation for the bearer-token mobile
 * session. `MobileAuthMiddleware` verifies the `Authorization: Bearer <jwt>`
 * header against `MobileService.verifyBearer` and stashes the payload here so
 * cookie-oriented controllers can read it via `SessionService.requireUserId`
 * without importing anything from the mobile module.
 */
export interface MobileAuthPayload {
  deviceId: string;
  userId: string;
  sessionId: string;
}

declare module 'express' {
  interface Request {
    mobileAuth?: MobileAuthPayload;
  }
}
