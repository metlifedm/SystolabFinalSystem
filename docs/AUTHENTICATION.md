# SYSTOLAB Authentication

SYSTOLAB has one customer authentication surface at `/login` and `/signup`. Customer report URLs use the same portal session and redirect to `/login?returnTo=...` when authentication is required. The admin portal remains a separate security boundary under `/admin`.

## Customer Methods

- Google Identity Services is the primary federated sign-in method. The browser receives a Google ID token and the API verifies its signature, audience, issuer, and expiry with Google's official Node authentication library.
- Email/password signup stores a pending user immediately, sends a single-use verification code through Brevo, and activates the password only after code verification.
- Email one-time-code login uses the same hashed, expiring challenge store.
- Password reset sends a single-use numeric reset code through Brevo.
- Phone OTP is optional and uses Brevo Transactional SMS when enabled.

Google only supplies claims authorized for the ID token, normally the stable Google subject, email, email verification state, name, profile image, locale, and hosted domain when available. SYSTOLAB does not invent or infer unavailable profile fields such as a phone number.

## Required Production Configuration

```env
NODE_ENV=production
MONGODB_URI=mongodb+srv://...
SYSTOLAB_MEMORY_STORE=false
CLIENT_ORIGIN=https://app.example.com

SYSTOLAB_AUTH_JWT_SECRET=<independent-random-secret-at-least-32-characters>
SYSTOLAB_GOOGLE_CLIENT_ID=<oauth-web-client-id>.apps.googleusercontent.com
SYSTOLAB_AUTH_ALLOW_DEV_GOOGLE_CREDENTIAL=false

SYSTOLAB_EMAIL_PROVIDER=brevo
BREVO_API_KEY=<brevo-api-key>
BREVO_SENDER_EMAIL=security@example.com
BREVO_SENDER_NAME=SYSTOLAB
SYSTOLAB_AUTH_DELIVERY_PREVIEW=false
```

The Brevo sender address or domain must be verified in Brevo. To enable phone OTP, also set `SYSTOLAB_AUTH_PHONE_ENABLED=true` and `BREVO_SMS_SENDER`.

In Google Cloud, create an OAuth 2.0 Web client and add the exact customer portal origins, for example `https://app.systolab.com` and the local development origin. Only the client ID is stored in SYSTOLAB; no Google client secret is needed for the browser ID-token flow.

## Security Controls

- Passwords use salted Node `scrypt` hashes.
- OTP and reset codes are stored as keyed hashes, never plaintext.
- Codes are single-use, expire automatically, and lock after three failures.
- Password validation locks an account after three failures.
- Resend cooldown, IP throttling, identifier throttling, device throttling, and route rate limits are enforced.
- Access tokens are short lived. Refresh tokens are hashed, rotated, revocable, and tracked by device.
- Google identity linking uses Google's immutable `sub` claim and only links verified identifiers.
- Production startup fails if MongoDB, Google, Brevo, sender, or strong secret configuration is missing.
- Development delivery preview is forcibly disabled in production.

## Development Persistence

Tests use isolated in-memory stores. When a developer explicitly sets `SYSTOLAB_MEMORY_STORE=true`, customer users, challenges, resets, sessions, and auth audits are written to `tmp/systolab-auth-store.json` so an API restart does not erase accounts. This is a development fallback only; production always requires MongoDB.

## API Routes

- `GET /api/auth/config`
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
