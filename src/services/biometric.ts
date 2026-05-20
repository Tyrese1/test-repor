/**
 * Biometric / device authentication service for Zakar note locking.
 *
 * This module replaces the previous per-note text-password flow. The new
 * lock model has two paths depending on how the user signed up:
 *
 * 1. Google SSO users — WebAuthn platform authenticator (Touch ID,
 *    Face ID, Windows Hello, Android biometrics). We enroll a
 *    discoverable credential the first time the user locks a note and
 *    reuse it for every unlock afterwards.
 *
 * 2. Email / password users — re-enter their existing account
 *    password. We verify it through Firebase Auth's
 *    reauthenticateWithCredential, so we never store or compare
 *    passwords ourselves. (We also support WebAuthn for these users
 *    if their device offers it — opportunistic, not required.)
 *
 * Per-note text passwords are gone. The only thing stored on each
 * locked note is `lockMethod: 'biometric' | 'account-password'` plus
 * the `lockedAt` timestamp. The user identity verification happens
 * at unlock time via this service; nothing secret lives on the note
 * document itself.
 *
 * IMPORTANT: WebAuthn is a *device-bound* mechanism. If the user
 * unlocks on a new device that hasn't enrolled yet, the service falls
 * back to re-enrollment (Google users) or re-auth (email users). We
 * surface a clear message in that case rather than silently failing.
 */

import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  type User as FirebaseUser,
} from "firebase/auth";

const CREDENTIAL_STORAGE_PREFIX = "zakar_webauthn_credid_";
const RP_NAME = "Zakar";

/**
 * Returns whether WebAuthn with a platform authenticator is available
 * in this browser. We check three things: the API exists, the
 * platform-authenticator probe says yes, and we're on a secure
 * context (https or localhost — WebAuthn refuses to run otherwise).
 *
 * This is *opportunistic* — false just means we fall back to the
 * account-password flow, not that locking is unavailable.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  if (!window.PublicKeyCredential) return false;
  try {
    // This probe asks the browser whether the device has a built-in
    // authenticator (fingerprint sensor, Face ID camera, Windows
    // Hello, etc). It's the canonical check.
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Returns true if the current user signed in with Google (provider
 * id matches "google.com"). Used to decide which fallback to offer
 * when biometric isn't available.
 */
export function isGoogleUser(user: FirebaseUser | null | undefined): boolean {
  if (!user) return false;
  return (user.providerData || []).some((p) => p?.providerId === "google.com");
}

/**
 * Returns true if the current user signed in with email/password.
 */
export function isEmailUser(user: FirebaseUser | null | undefined): boolean {
  if (!user) return false;
  return (user.providerData || []).some((p) => p?.providerId === "password");
}

/** Helper: random Uint8Array of given length, used for challenges. */
function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

/** Helper: base64-url encode an ArrayBuffer for localStorage. */
function b64urlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Helper: decode a base64-url string back to a Uint8Array. */
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Enroll a platform authenticator credential for this user. The
 * resulting credential id is stored in localStorage so subsequent
 * unlocks can reference it. We deliberately *do not* persist the
 * credential id to Firestore — keeping it device-local means a
 * stolen account doesn't immediately grant access to locked notes
 * from a new device. (The user simply re-enrolls on a new device,
 * after re-authenticating.)
 *
 * Throws if WebAuthn isn't supported or the user cancels.
 */
export async function enrollBiometric(user: FirebaseUser): Promise<string> {
  if (!(await isBiometricAvailable())) {
    throw new Error("Biometric authentication isn't available on this device.");
  }

  const challenge = randomBytes(32);
  const userIdBytes = new TextEncoder().encode(user.uid);

  // Note on RP id: we leave it undefined so the browser uses the
  // current origin's effective domain automatically. Setting it
  // explicitly would break if Zakar is hosted on multiple
  // subdomains (use.myzakar.app, myzakar.app).
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: RP_NAME },
      user: {
        id: userIdBytes,
        name: user.email || user.uid,
        displayName: user.displayName || user.email || "Zakar User",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60_000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Enrollment was cancelled.");
  }

  const credId = b64urlEncode(credential.rawId);
  localStorage.setItem(CREDENTIAL_STORAGE_PREFIX + user.uid, credId);
  return credId;
}

/**
 * Trigger a biometric verification using the previously-enrolled
 * credential. Returns true if the device confirms the user, throws
 * if the user cancels or the credential isn't recognized.
 *
 * If there's no stored credential id for this user (e.g. new
 * device), we'll prompt the browser to discover one — which
 * succeeds on the device that originally enrolled, and fails
 * gracefully elsewhere.
 */
export async function verifyBiometric(user: FirebaseUser): Promise<boolean> {
  if (!(await isBiometricAvailable())) {
    throw new Error("Biometric authentication isn't available on this device.");
  }
  const challenge = randomBytes(32);
  const storedCredId = localStorage.getItem(
    CREDENTIAL_STORAGE_PREFIX + user.uid,
  );

  const opts: PublicKeyCredentialRequestOptions = {
    challenge,
    timeout: 60_000,
    userVerification: "required",
  };

  if (storedCredId) {
    opts.allowCredentials = [
      {
        id: b64urlDecode(storedCredId),
        type: "public-key",
        transports: ["internal"],
      },
    ];
  }

  const assertion = (await navigator.credentials.get({
    publicKey: opts,
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Verification was cancelled.");
  return true;
}

/**
 * Re-authenticate an email/password user by asking them to
 * re-enter their account password. Firebase verifies the password
 * server-side via reauthenticateWithCredential. We never see or
 * store the password ourselves.
 */
export async function reauthenticateEmailUser(
  user: FirebaseUser,
  password: string,
): Promise<void> {
  if (!user.email) {
    throw new Error("Account has no email address on file.");
  }
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
}

/**
 * Re-authenticate a Google user by re-running the OAuth popup.
 * Used as the fallback when WebAuthn isn't available (e.g. desktop
 * Chrome without a paired authenticator).
 */
export async function reauthenticateGoogleUser(
  user: FirebaseUser,
): Promise<void> {
  const provider = new GoogleAuthProvider();
  await reauthenticateWithPopup(user, provider);
}

/**
 * Whether this device already has a stored credential id for the
 * given user. Useful for showing "Enable biometric" vs "Use
 * biometric" in the UI.
 */
export function hasStoredCredential(user: FirebaseUser | null): boolean {
  if (!user) return false;
  return !!localStorage.getItem(CREDENTIAL_STORAGE_PREFIX + user.uid);
}

/**
 * Forget the stored credential id. Called when the user explicitly
 * wants to re-enroll on a new device, or as part of sign-out
 * cleanup.
 */
export function forgetCredential(user: FirebaseUser | null): void {
  if (!user) return;
  localStorage.removeItem(CREDENTIAL_STORAGE_PREFIX + user.uid);
}

export type LockMethod = "biometric" | "account-password";
