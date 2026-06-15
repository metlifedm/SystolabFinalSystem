# SYSTOLAB Authentication

SYSTOLAB authentication is a self-contained backend subsystem for Google-first login, email OTP, phone OTP, password login, password reset, refresh tokens, device sessions, and audit logging.

## Methods

- Google One-Click: primary UI path. Production verification uses a locally configured Google JWKS value in `SYSTOLAB_GOOGLE_JWKS_JSON`; the backend does not call Google key endpoints at runtime.
- Email OTP: generated, hashed, verified, and expired by the backend.
- Phone OTP: generated, hashed, verified, and expired by the backend.
- Password: stored with Node `scrypt` hashing.
- Password reset: generated and verified internally through simulated backend delivery.

## Security Rules

- OTP verification allows a maximum of 3 attempts.
- Password login validation allows a maximum of 3 failed attempts per user before temporary lock.
- OTP codes and reset tokens are stored as HMAC hashes, not plaintext.
- OTPs and reset tokens are single-use and time-limited.
- Refresh tokens are stored as HMAC hashes and can be rotated, revoked, and listed per device.
- IP, identifier, and device throttles are enforced through persistent throttle records.
- Auth audit logs record login attempts, OTP requests, OTP failures, successful auth, password reset activity, session refresh, logout, revocation, locks, and throttling.

## Self-Contained OTP Delivery

The backend returns a `simulatedDelivery` object for OTP and reset flows. No email, SMS, OTP vendor, or messaging API is called. This is intentionally visible for the current self-contained system requirement.

## Google Verification

For production Google ID tokens:

1. Set `SYSTOLAB_GOOGLE_CLIENT_ID`.
2. Set `SYSTOLAB_GOOGLE_JWKS_JSON` to a locally managed JWKS JSON document.
3. Disable development credentials with `SYSTOLAB_AUTH_ALLOW_DEV_GOOGLE_CREDENTIAL=false`.

For sandbox UI testing, the web console sends a `dev:` credential to simulate Google One-Click without loading an external Google script.

## API Routes

- `POST /api/auth/google`
- `POST /api/auth/otp/request`
- `POST /api/auth/otp/verify`
- `POST /api/auth/password/register`
- `POST /api/auth/password/login`
- `POST /api/auth/password/forgot`
- `POST /api/auth/password/reset`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:sessionId`

## User Lifecycle

All methods map to `AuthUser` and support these states:

- `PENDING`
- `VERIFIED`
- `SUSPENDED`
- `LOCKED`
- `DELETED`

Identity linking merges Google ID, email, and phone identifiers into one user record whenever verified identifiers match.
