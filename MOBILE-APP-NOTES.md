# CAE mobile app — initial preparation

This branch contains the first Capacitor build scaffold. It is intentionally separate from `main`.

## Current scope

- Uses the existing CAE web interface as the initial WebView content.
- Builds a debug APK through GitHub Actions.
- The APK is for internal technical testing only; it is not a store-ready or public release.
- No signing key, passwords, API secrets, or private credentials are stored in this repository.

## Required work before real-world use

1. Configure and test Supabase email/auth redirect handling for the native app.
2. Verify Cloudflare Turnstile behavior in the Capacitor WebView. The current site key may not accept the native app origin.
3. Review every Android permission and add only capabilities the CAE actually uses.
4. Add app icons, splash screen, versioning, and accessibility refinements.
5. Test authentication, logout, uploads/audio, moderation, notifications, and account deletion on physical devices.
6. Configure a protected release-signing process. Never commit signing keys or passwords.
7. Run malware and false-positive checks on the exact release artifact before considering distribution.

## Important

A successful debug build only proves that Android packaging completed. It does not prove that login, security controls, backend flows, or all web features work inside the native app.

The existing website on GitHub Pages is not changed by this branch.
