import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Resend } from "resend";
import dotenv from "dotenv";
import {
  initializeApp,
  getApps,
  applicationDefault,
  cert,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { magicSort } from "./aiService.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const isProduction =
  process.env.NODE_ENV === "production" ||
  !!process.env.VERCEL ||
  process.env.ENV === "production" ||
  process.env.CI === "true";

// Initialize Firebase Admin Helper
let db: Firestore | null = null;

const initializeFirebaseAdmin = () => {
  try {
    if (getApps().length > 0) {
      return getApps()[0];
    }

    const configPath = path.resolve(
      process.cwd(),
      "firebase-applet-config.json",
    );
    let firebaseConfig: any = {};

    if (fs.existsSync(configPath)) {
      firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }

    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      try {
        const decodedKey = Buffer.from(
          process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
          "base64",
        ).toString("utf8");
        const serviceAccount = JSON.parse(decodedKey);

        // Handle escaped newlines in private key if they exist
        if (serviceAccount.private_key) {
          serviceAccount.private_key = serviceAccount.private_key.replace(
            /\\n/g,
            "\n",
          );
        }

        credential = cert(serviceAccount);
        console.log(
          "Using service account key from FIREBASE_SERVICE_ACCOUNT_KEY.",
        );
      } catch (e) {
        console.warn(
          "Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY, falling back to applicationDefault:",
          e,
        );
        credential = applicationDefault();
      }
    } else {
      if (firebaseConfig.projectId) {
        process.env.GOOGLE_CLOUD_QUOTA_PROJECT = firebaseConfig.projectId;
      }
      credential = applicationDefault();
      console.log(
        "No FIREBASE_SERVICE_ACCOUNT_KEY found, using applicationDefault.",
      );
    }

    const app = initializeApp({
      credential,
      projectId: firebaseConfig.projectId,
    });

    // Initialize Firestore if project config exists
    if (!db && firebaseConfig.projectId) {
      const databaseId = firebaseConfig.firestoreDatabaseId || "(default)";
      db = getFirestore(
        app,
        databaseId === "(default)" ? undefined : databaseId,
      );
      console.log(
        `Firebase Admin & Firestore initialized: ${firebaseConfig.projectId}, database: ${databaseId}`,
      );
    } else {
      console.log(
        `Firebase Admin initialized successfully: ${firebaseConfig.projectId}`,
      );
    }

    return app;
  } catch (error) {
    console.error("Failed to initialize Firebase Admin:", error);
    return null;
  }
};

// Initial invocation
initializeFirebaseAdmin();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

/* ============================================================
   IMPORTANT: Resend webhooks (Svix-signed) require the RAW body
   for signature verification. We mount a raw-body parser ONLY
   for the inbound email route, and the global JSON parser for
   everything else. Order matters — the raw mount has to come
   before app.use(express.json()).
   ============================================================ */
app.use(
  "/api/inbound-email",
  express.raw({ type: "application/json", limit: "10mb" }),
);

app.use(express.json());

// Health check route
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    isProduction,
    env: process.env.NODE_ENV,
    vercel: !!process.env.VERCEL,
    ci: process.env.CI,
    distExists: fs.existsSync(path.join(process.cwd(), "dist")),
    indexExists: fs.existsSync(path.join(process.cwd(), "dist", "index.html")),
    hasResendKey: !!process.env.RESEND_API_KEY,
    hasDb: !!db,
    time: new Date().toISOString(),
    port: PORT,
  });
});

// Resend instance
let resend: Resend | null = null;
// One-shot flag so we only log the "no webhook secret" warning once per cold start
let webhookSecretWarned = false;
const getResend = () => {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn(
        "RESEND_API_KEY is not set. Email notifications will be disabled.",
      );
      return null;
    }
    resend = new Resend(apiKey);
  }
  return resend;
};

// Simple in-memory cache for deduplication
const sentEmailsCache = new Map<string, number>();
const DEDUPLICATION_WINDOW = 30000; // 30 seconds

const isDuplicateEmail = (email: string, type: string) => {
  const key = `${type}:${email}`;
  const now = Date.now();
  const lastSent = sentEmailsCache.get(key);

  if (lastSent && now - lastSent < DEDUPLICATION_WINDOW) {
    return true;
  }

  sentEmailsCache.set(key, now);

  // Cleanup old entries periodically (every 100 entries)
  if (sentEmailsCache.size > 1000) {
    for (const [k, v] of sentEmailsCache.entries()) {
      if (now - v > DEDUPLICATION_WINDOW) {
        sentEmailsCache.delete(k);
      }
    }
  }

  return false;
};

// API routes
app.post("/api/send-welcome", async (req, res) => {
  console.log(
    `Received request to /api/send-welcome: ${JSON.stringify(req.body)}`,
  );
  const { email, name } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Valid email is required" });
  }

  const targetEmail = email.trim().toLowerCase();

  if (isDuplicateEmail(targetEmail, "welcome")) {
    console.log(`Deduplicated welcome email for: ${targetEmail}`);
    return res.status(200).json({ success: true, note: "Deduplicated" });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(targetEmail)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  const client = getResend();

  if (!client) {
    return res.status(503).json({
      error:
        "Email service not configured. Please add RESEND_API_KEY to your environment variables.",
    });
  }

  // Sanitize name to prevent encoding issues
  const safeName =
    String(name || "there")
      .replace(/[^\x20-\x7E]/g, "")
      .trim() || "there";

  try {
    console.log(
      `Attempting to send welcome email to: ${targetEmail} using template: welcome-to-zakar`,
    );

    const { data, error } = await client.emails.send({
      from: "Zakar <noreply@use.myzakar.app>",
      to: targetEmail,
      template: {
        id: "welcome-to-zakar",
        variables: {
          NAME: safeName,
          name: safeName,
          PRODUCT: "Zakar",
          product: "Zakar",
        },
      },
    });

    if (error) {
      console.warn(
        "Resend Template Error (Welcome):",
        JSON.stringify(error, null, 2),
      );

      // Fallback to standard email if template fails
      console.log("Falling back to standard welcome email...");
      const fallbackResult = await client.emails.send({
        from: "Zakar <noreply@use.myzakar.app>",
        to: targetEmail,
        subject: "Welcome to Zakar!",
        text: `Welcome to Zakar, ${safeName}! We're thrilled to have you on board. Zakar is your unorganized brain dump for organized minds. Start dumping your thoughts, and let our AI help you keep things tidy.`,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
              <h1 style="color: #4f46e5;">Welcome to Zakar, ${safeName}!</h1>
              <p style="font-size: 16px; line-height: 1.6; color: #334155;">
                We're thrilled to have you on board. Zakar is your unorganized brain dump for organized minds.
              </p>
              <p style="font-size: 16px; line-height: 1.6; color: #334155;">
                Start dumping your thoughts, and let our AI help you keep things tidy.
              </p>
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">
                Best,<br/>
                The Zakar Team
              </div>
            </div>
          `,
      });

      if (fallbackResult.error) {
        console.error(
          "Resend Fallback API Error (Welcome):",
          JSON.stringify(fallbackResult.error, null, 2),
        );
        return res.status(400).json({ error: fallbackResult.error });
      }

      return res.status(200).json({
        success: true,
        data: fallbackResult.data,
        note: "Sent via fallback",
      });
    }

    res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("Failed to send email:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/send-goodbye", async (req, res) => {
  console.log(
    `Received request to /api/send-goodbye: ${JSON.stringify(req.body)}`,
  );
  const { email, name } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Valid email is required" });
  }

  const targetEmail = email.trim().toLowerCase();

  if (isDuplicateEmail(targetEmail, "goodbye")) {
    console.log(`Deduplicated goodbye email for: ${targetEmail}`);
    return res.status(200).json({ success: true, note: "Deduplicated" });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(targetEmail)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  const client = getResend();
  if (!client) {
    return res.status(503).json({ error: "Email service not configured" });
  }

  const safeName =
    String(name || "there")
      .replace(/[^\x20-\x7E]/g, "")
      .trim() || "there";

  try {
    console.log(
      `Attempting to send goodbye email to: ${targetEmail} using template: account-deleted`,
    );
    const { data, error } = await client.emails.send({
      from: "Zakar <noreply@use.myzakar.app>",
      to: targetEmail,
      template: {
        id: "account-deleted",
        variables: {
          NAME: safeName,
          name: safeName,
          PRODUCT: "Zakar",
          product: "Zakar",
        },
      },
    });

    if (error) {
      console.warn(
        "Resend Template Error (Goodbye):",
        JSON.stringify(error, null, 2),
      );

      // Fallback to standard email if template fails
      console.log("Falling back to standard goodbye email...");
      const fallbackResult = await client.emails.send({
        from: "Zakar <noreply@use.myzakar.app>",
        to: targetEmail,
        subject: "Your Zakar account has been deleted",
        text: `Hi ${safeName}, this is a confirmation that your Zakar account and all associated data have been permanently deleted. We're sorry to see you go, but we hope you found Zakar useful while you were here.`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h1 style="color: #f43f5e;">Account Deleted</h1>
            <p style="font-size: 16px; line-height: 1.6; color: #334155;">
              Hi ${safeName},
            </p>
            <p style="font-size: 16px; line-height: 1.6; color: #334155;">
              This email confirms that your Zakar account and all associated notes have been permanently deleted.
            </p>
            <p style="font-size: 16px; line-height: 1.6; color: #334155;">
              We're sorry to see you go, but we hope Zakar helped you organize your thoughts while you were with us.
            </p>
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">
              Best,<br/>
              The Zakar Team
            </div>
          </div>
        `,
      });

      if (fallbackResult.error) {
        console.error(
          "Resend Fallback API Error (Goodbye):",
          JSON.stringify(fallbackResult.error, null, 2),
        );
        return res.status(400).json({ error: fallbackResult.error });
      }

      return res.status(200).json({
        success: true,
        data: fallbackResult.data,
        note: "Sent via fallback",
      });
    }

    res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("Failed to send goodbye email:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/send-verification", async (req, res) => {
  console.log(
    `Received request to /api/send-verification: ${JSON.stringify(req.body)}`,
  );
  const { email, name } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Valid email is required" });
  }

  const targetEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(targetEmail)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  if (isDuplicateEmail(targetEmail, "verification")) {
    console.log(`Deduplicated verification email for: ${targetEmail}`);
    return res.status(200).json({ success: true, note: "Deduplicated" });
  }

  const client = getResend();
  if (!client) {
    return res.status(503).json({ error: "Email service not configured" });
  }

  const safeName =
    String(name || "there")
      .replace(/[^\x20-\x7E]/g, "")
      .trim() || "there";

  try {
    const adminApp = initializeFirebaseAdmin();
    if (!adminApp) {
      return res
        .status(500)
        .json({ error: "Authentication service unavailable" });
    }

    const auth = getAuth(adminApp);

    let verificationLink: string;
    try {
      // Generate the Firebase verification link, then extract the oobCode and
      // build a direct link to our branded /verify-email page. (continueUrl is
      // only the post-processing redirect — Firebase's hosted page still loads
      // first unless we route around it ourselves.)
      const actionCodeSettings = {
        url: "https://use.myzakar.app/verify-email",
        handleCodeInApp: true,
      };
      const firebaseLink = await auth.generateEmailVerificationLink(
        targetEmail,
        actionCodeSettings,
      );
      const parsedUrl = new URL(firebaseLink);
      const oobCode = parsedUrl.searchParams.get("oobCode");
      if (!oobCode) {
        throw new Error("Firebase did not return an oobCode in the verification link.");
      }
      verificationLink = `https://use.myzakar.app/verify-email?oobCode=${encodeURIComponent(oobCode)}`;
      console.log(`Generated branded verification link for: ${targetEmail}`);
    } catch (authError: any) {
      console.error(
        "Firebase Admin Auth Error (Verification Link):",
        authError,
      );
      if (authError.code === "auth/user-not-found") {
        return res
          .status(404)
          .json({ error: "No user found with this email address" });
      }
      return res
        .status(500)
        .json({ error: "Failed to generate verification link" });
    }

    const { data, error } = await client.emails.send({
      from: "Zakar <noreply@use.myzakar.app>",
      to: targetEmail,
      template: {
        id: "email-verification",
        variables: {
          NAME: safeName,
          name: safeName,
          LINK: verificationLink,
          link: verificationLink,
          PRODUCT: "Zakar",
          product: "Zakar",
        },
      },
    });

    if (error) {
      console.error(
        "Resend Template Error (Verification):",
        JSON.stringify(error, null, 2),
      );
      const fallbackResult = await client.emails.send({
        from: "Zakar <noreply@use.myzakar.app>",
        to: targetEmail,
        subject: "Verify your Zakar email address",
        text: `Hi ${safeName}, please verify your Zakar account by clicking this link: ${verificationLink}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h1 style="color: #4f46e5;">Verify your email</h1>
            <p style="font-size: 16px; line-height: 1.6; color: #334155;">Hi ${safeName},</p>
            <p style="font-size: 16px; line-height: 1.6; color: #334155;">
              Thanks for signing up for Zakar! Please verify your email address to get started.
            </p>
            <div style="margin: 30px 0; text-align: center;">
              <a href="${verificationLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Verify Email</a>
            </div>
            <p style="font-size: 14px; color: #64748b;">If you didn't create a Zakar account, you can safely ignore this email.</p>
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">
              Best,<br/>The Zakar Team
            </div>
          </div>
        `,
      });

      if (fallbackResult.error) {
        console.error(
          "Resend Fallback Error (Verification):",
          JSON.stringify(fallbackResult.error, null, 2),
        );
        return res.status(500).json({ error: "Email delivery failed" });
      }

      return res.status(200).json({ success: true });
    }

    res.status(200).json({ success: true, data });
  } catch (err: any) {
    console.error("Failed to send verification email:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/send-password-reset", async (req, res) => {
  console.log(
    `Received request to /api/send-password-reset: ${JSON.stringify(req.body)}`,
  );
  const { email } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Valid email is required" });
  }

  const targetEmail = email.trim().toLowerCase();

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(targetEmail)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  if (isDuplicateEmail(targetEmail, "password-reset")) {
    console.log(`Deduplicated password reset email for: ${targetEmail}`);
    return res.status(200).json({ success: true, note: "Deduplicated" });
  }

  const client = getResend();
  if (!client) {
    return res.status(503).json({ error: "Email service not configured" });
  }

  try {
    // Ensure Firebase Admin is initialized
    const adminApp = initializeFirebaseAdmin();
    if (!adminApp) {
      console.error(
        "Firebase Admin could not be initialized for password reset.",
      );
      return res
        .status(500)
        .json({ error: "Authentication service unavailable" });
    }

    const auth = getAuth(adminApp);

    // Generate the reset link using Firebase Admin
    console.log(`Generating password reset link for: ${targetEmail}`);
    let resetLink: string;
    let safeName = "there";

    try {
      // 1. Check if user exists first - this avoids "Internal Assert" failures on non-existent users
      const userRecord = await auth.getUserByEmail(targetEmail);
      safeName =
        String(userRecord.displayName || "there")
          .replace(/[^\x20-\x7E]/g, "")
          .trim() || "there";

      // 2. Generate the Firebase oobCode, then build a direct link to our branded page.
      //    The continueUrl in actionCodeSettings is only where Firebase redirects *after*
      //    processing — it doesn't make the link go directly to our page. So we extract
      //    the oobCode from the Firebase-generated URL and construct our own link.
      const actionCodeSettings = {
        url: "https://use.myzakar.app/reset-password",
        handleCodeInApp: true,
      };

      const firebaseLink = await auth.generatePasswordResetLink(
        targetEmail,
        actionCodeSettings,
      );

      const parsedUrl = new URL(firebaseLink);
      const oobCode = parsedUrl.searchParams.get("oobCode");
      if (!oobCode) {
        throw new Error("Firebase did not return an oobCode in the reset link.");
      }
      resetLink = `https://use.myzakar.app/reset-password?oobCode=${encodeURIComponent(oobCode)}`;
      console.log(`Generated branded reset link successfully.`);
    } catch (authError: any) {
      console.error("Firebase Admin Auth Error (Reset Link Flow):", authError);

      if (authError.code === "auth/user-not-found") {
        return res
          .status(404)
          .json({ error: "No user found with this email address" });
      }

      if (authError.code === "auth/user-disabled") {
        return res.status(403).json({
          error: "This account has been disabled. Please contact support.",
        });
      }

      if (authError.message?.includes("RESET_PASSWORD_EXCEED_LIMIT")) {
        return res.status(429).json({
          error:
            "Too many password reset requests. Please wait a few minutes before trying again.",
        });
      }

      if (authError.message?.includes("INTERNAL ASSERT FAILED")) {
        return res.status(500).json({
          error: "Auth service configuration error",
          details:
            "Firebase was unable to generate a reset link. Please ensure Authorized Domains and Email Action handlers are enabled in Firebase Console.",
        });
      }

      return res.status(500).json({
        error: "Auth service error",
        details: authError.message || "Unknown error",
      });
    }

    // Attempt to send email via Resend

    console.log(
      `Attempting to send password reset email to: ${targetEmail} using template: password-reset-1`,
    );
    const { data, error } = await client.emails.send({
      from: "Zakar <noreply@use.myzakar.app>",
      to: targetEmail,
      template: {
        id: "password-reset-1",
        variables: {
          NAME: safeName,
          name: safeName,
          LINK: resetLink,
          link: resetLink,
          PRODUCT: "Zakar",
          product: "Zakar",
        },
      },
    });

    if (error) {
      console.error(
        "Resend Template Delivery Error:",
        JSON.stringify(error, null, 2),
      );

      // Fallback to standard email if template fails
      console.log("Falling back to standard password reset email...");
      const fallbackResult = await client.emails.send({
        from: "Zakar <noreply@use.myzakar.app>",
        to: targetEmail,
        subject: "Reset your Zakar password",
        text: `Hi ${safeName}, you requested a password reset for your Zakar account. Click the link below to set a new password: ${resetLink}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h1 style="color: #4f46e5;">Password Reset</h1>
            <p style="font-size: 16px; line-height: 1.6; color: #334155;">
              Hi ${safeName},
            </p>
            <p style="font-size: 16px; line-height: 1.6; color: #334155;">
              You requested a password reset for your Zakar account. Click the button below to set a new password:
            </p>
            <div style="margin: 30px 0; text-align: center;">
              <a href="${resetLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Reset Password</a>
            </div>
            <p style="font-size: 14px; color: #64748b;">
              If you didn't request this, you can safely ignore this email.
            </p>
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">
              Best,<br/>
              The Zakar Team
            </div>
          </div>
        `,
      });

      if (fallbackResult.error) {
        console.error(
          "Resend Fallback API Error (Password Reset):",
          JSON.stringify(fallbackResult.error, null, 2),
        );
        return res.status(500).json({
          error: "Email delivery failed",
          details: fallbackResult.error,
        });
      }

      return res.status(200).json({ success: true });
    }

    res.status(200).json({ success: true, data });
  } catch (err: any) {
    console.error("Failed to send password reset email (Generic Catch):", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message || "Unknown",
    });
  }
});

/* ============================================================
   Email-to-Note — Resend Inbound webhook
   ============================================================
   Forward an email to capturezakarnotes@ildiprenuc.resend.app and
   it becomes a note in your Zakar account.

   Auth model (v1): match the sender's email address against the
   user's Firebase Auth email. Only forwards from your registered
   email get accepted — protects against random people posting to
   the inbox URL.

   Security: Resend uses Svix-signed webhooks. We verify the raw
   request body against the signing secret using the Resend SDK's
   built-in webhooks.verify() helper. The raw body is preserved by
   the express.raw() middleware mounted earlier for this route only.
   ============================================================ */
app.post("/api/inbound-email", async (req, res) => {
  // Step 1 — read the raw body. With express.raw() mounted for this
  // route, req.body is a Buffer. We need it as a string for verify()
  // and JSON.parse for processing.
  let rawPayload: string;
  if (Buffer.isBuffer(req.body)) {
    rawPayload = req.body.toString("utf8");
  } else if (typeof req.body === "string") {
    rawPayload = req.body;
  } else if (req.body && typeof req.body === "object") {
    // Fallback if some other middleware already parsed (shouldn't happen)
    rawPayload = JSON.stringify(req.body);
  } else {
    return res.status(400).json({ error: "Empty body" });
  }

  // Step 2 — verify the Svix signature using the Resend SDK.
  // Skip only if RESEND_WEBHOOK_SECRET is intentionally unset (for
  // testing). In production, ALWAYS set this.
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  let parsed: Record<string, unknown>;

  if (webhookSecret) {
    try {
      // Resend SDK 6.10.0 verify signature expects:
      //   payload: string
      //   headers: { id, timestamp, signature } (short keys)
      //   webhookSecret: string (with whsec_ prefix)
      // It throws on invalid sig, otherwise returns the parsed event.
      const svixId = req.headers["svix-id"] as string | undefined;
      const svixTs = req.headers["svix-timestamp"] as string | undefined;
      const svixSig = req.headers["svix-signature"] as string | undefined;
      if (!svixId || !svixTs || !svixSig) {
        console.warn("Inbound email rejected: missing Svix headers");
        return res.status(401).json({ error: "Missing signature headers" });
      }
      const client = getResend();
      if (!client) {
        return res.status(503).json({ error: "Webhook verifier unavailable" });
      }
      parsed = client.webhooks.verify({
        payload: rawPayload,
        headers: {
          id: svixId,
          timestamp: svixTs,
          signature: svixSig,
        },
        webhookSecret,
      }) as unknown as Record<string, unknown>;
    } catch (err) {
      console.warn(
        "Inbound email rejected: Svix signature verification failed",
        err instanceof Error ? err.message : err,
      );
      return res.status(401).json({ error: "Invalid signature" });
    }
  } else {
    if (!webhookSecretWarned) {
      console.warn(
        "RESEND_WEBHOOK_SECRET not set — accepting webhook without verification (UNSAFE for production). Set this env var on Vercel and redeploy.",
      );
      webhookSecretWarned = true;
    }
    try {
      parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  try {
    // Step 3 — extract the inbound email payload from the verified event.
    // Resend wraps webhooks as { type: 'email.received', created_at, data: {...} }
    const eventType = (parsed.type as string | undefined) || "";
    if (eventType && eventType !== "email.received") {
      // Different event type (e.g. email.sent) — acknowledge but ignore
      console.log(`Inbound webhook: ignoring event type "${eventType}"`);
      return res.status(200).json({ success: true, ignored: true });
    }

    const data = (parsed.data as Record<string, unknown> | undefined) || parsed;
    const fromRaw =
      typeof data.from === "string"
        ? data.from
        : (data.from as Record<string, string> | undefined)?.address ||
          (data.from as Record<string, string> | undefined)?.email ||
          "";
    const subject: string = ((data.subject as string) || "")
      .toString()
      .slice(0, 500);

    // CRITICAL: Resend webhooks for `email.received` do NOT include the
    // body — only metadata (from, to, subject, email_id). To get the body
    // we must call the Received Emails API: GET /inbounds/{email_id}.
    // Reference: https://resend.com/docs/dashboard/receiving/introduction
    const dataAny = data as Record<string, unknown>;
    const inboundId = (dataAny.email_id as string) || (dataAny.id as string);

    let text = "";
    let html = "";

    if (!inboundId) {
      console.warn(
        "Inbound email rejected: webhook missing email_id field",
        Object.keys(dataAny),
      );
      return res.status(400).json({ error: "Missing email_id" });
    }

    try {
      const client = getResend();
      if (!client) {
        console.error(
          "Cannot fetch inbound email body: Resend client unavailable (RESEND_API_KEY missing?)",
        );
        return res.status(503).json({ error: "Resend client unavailable" });
      }

      // Resend SDK's lower-level get() handles auth + base URL. The
      // Receiving class isn't exposed publicly on the Resend instance,
      // so we hit the endpoint directly.
      const fetched = (await (
        client as unknown as {
          get: (path: string) => Promise<{
            data:
              | {
                  text?: string | null;
                  html?: string | null;
                  subject?: string;
                }
              | null
              | undefined;
            error: { message: string } | null | undefined;
          }>;
        }
      ).get(`/emails/receiving/${inboundId}`)) as {
        data: { text?: string | null; html?: string | null } | null;
        error: { message: string } | null;
      };

      if (fetched.error) {
        console.error(
          "Failed to fetch inbound email body from Resend:",
          fetched.error.message,
        );
        return res.status(502).json({ error: "Failed to fetch email body" });
      }

      text = (fetched.data?.text || "").toString();
      html = (fetched.data?.html || "").toString();

      console.log(
        `Fetched inbound email ${inboundId} — text length: ${text.length}, html length: ${html.length}`,
      );
    } catch (fetchErr) {
      console.error("Error calling Resend Received Emails API:", fetchErr);
      return res.status(502).json({ error: "Failed to fetch email body" });
    }

    // Extract bare email from "Name <email@x.com>" or just "email@x.com"
    const emailMatch = fromRaw.match(/<([^>]+)>/);
    const senderEmail = (emailMatch ? emailMatch[1] : fromRaw)
      .trim()
      .toLowerCase();

    if (!senderEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
      console.warn("Inbound email rejected: invalid sender", fromRaw);
      return res.status(400).json({ error: "Invalid sender" });
    }

    // Strip common forward chrome from the body. Heuristic — keep the
    // first chunk before quoted/forwarded headers.
    const cleanBody = (() => {
      const raw = text || stripHtmlBasic(html);
      if (!raw) return "";
      const cutMarkers = [
        /\n[-]+\s*Forwarded message[-]+/i,
        /\nOn .{0,80} wrote:/,
        /\nFrom:.*\nSent:.*/i,
        /\nBegin forwarded message:/i,
      ];
      let result = raw;
      for (const re of cutMarkers) {
        const m = result.search(re);
        if (m > -1 && m > 30) result = result.slice(0, m);
      }
      return result.trim().replace(/\n{3,}/g, "\n\n");
    })();

    if (!cleanBody && !subject) {
      return res.status(400).json({ error: "Empty email" });
    }

    const adminApp = initializeFirebaseAdmin();
    if (!adminApp) {
      return res.status(500).json({ error: "Database unavailable" });
    }
    // CRITICAL: use the module-level `db` variable that's already been
    // initialized with the project's correct (possibly named) Firestore
    // database. Calling getFirestore(adminApp) here would target the
    // "(default)" database, which doesn't exist for this project and
    // results in gRPC error code 5 NOT_FOUND on writes.
    if (!db) {
      console.error(
        "Module-level Firestore db not initialized — check firebase-applet-config.json deploy",
      );
      return res.status(500).json({ error: "Database unavailable" });
    }
    const firestore = db;
    const auth = getAuth(adminApp);

    let userId: string | null = null;
    try {
      const userRecord = await auth.getUserByEmail(senderEmail);
      userId = userRecord.uid;
    } catch (e) {
      console.warn(`No Zakar user found for ${senderEmail}`);
      return res.status(200).json({ success: true, accepted: false });
    }

    if (!userId) {
      return res.status(200).json({ success: true, accepted: false });
    }

    const rawContent = subject ? `**${subject}**\n\n${cleanBody}` : cleanBody;

    const docRef = await firestore.collection("notes").add({
      userId,
      title: subject || "Captured from email",
      content: rawContent,
      rawContent,
      maskedContent: rawContent,
      category: "Uncategorized",
      tags: [],
      isAutoSorted: false,
      isPinned: false,
      isStarred: false,
      isArchived: false,
      isTrashed: false,
      isPublic: false,
      status: "processing",
      source: "email",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(
      `Inbound email accepted for ${senderEmail} → note ${docRef.id}`,
    );

    // Process inline — DO NOT rely on the polling worker. On Vercel
    // serverless, the worker process doesn't survive between invocations,
    // so a note created here may sit in "processing" status forever if
    // we don't enhance it ourselves before responding.
    try {
      // Look up the user's language preference so the AI organizes the
      // email content in their chosen language. Falls back to English.
      let userLanguage: string | undefined;
      try {
        const userDoc = await firestore.collection("users").doc(userId).get();
        userLanguage = (
          userDoc.data() as { defaultLanguage?: string } | undefined
        )?.defaultLanguage;
      } catch {}

      const sorted = await magicSort(rawContent, "auto", userLanguage);
      // For inbound emails we ALWAYS apply the sorted/structured content,
      // regardless of the user's autoSortEnabled preference. The email IS
      // the only input — user has no opportunity to manually format it
      // before submission, so leaving the raw email body unstructured
      // defeats the entire point of email-to-note. (autoSortEnabled is
      // designed for the in-app capture flow where users CAN format
      // their thoughts manually if they prefer.)
      const updateData: Record<string, unknown> = {
        title: sorted.title,
        content: sorted.content,
        maskedContent: sorted.maskedContent,
        category: sorted.category,
        tags: sorted.tags,
        isAutoSorted: true,
        updatedAt: FieldValue.serverTimestamp(),
        status: sorted.isError ? "error" : "ready",
      };
      await firestore.collection("notes").doc(docRef.id).update(updateData);
      console.log(`Inbound email — note ${docRef.id} processed inline`);
    } catch (procErr) {
      console.error(
        `Inbound email — inline processing failed for ${docRef.id}:`,
        procErr,
      );
      // Mark as error so the user sees something useful instead of an
      // endless processing spinner.
      try {
        await firestore
          .collection("notes")
          .doc(docRef.id)
          .update({
            status: "error",
            error: procErr instanceof Error ? procErr.message : String(procErr),
          });
      } catch {
        /* nothing more we can do */
      }
    }

    return res.status(200).json({ success: true, noteId: docRef.id });
  } catch (err) {
    console.error("Inbound email handler error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/** Crude HTML → text fallback used only when Resend doesn't include `text`. */
function stripHtmlBasic(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// Catch-all for undefined API routes to help debug 404s
app.all("/api/*", (req, res) => {
  console.warn(`404 - Unhandled API request: ${req.method} ${req.url}`);
  res.status(404).json({
    error: "API route not found",
    method: req.method,
    url: req.url,
    suggestion: "Check if the route is correctly registered in server.ts",
  });
});

// Vite middleware for development
console.log(`Server Environment:`, {
  NODE_ENV: process.env.NODE_ENV,
  VERCEL: process.env.VERCEL,
  ENV: process.env.ENV,
  CI: process.env.CI,
  isProduction,
});

if (!isProduction) {
  console.log("Development mode: Loading Vite middleware...");
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.resolve(process.cwd(), "dist");
  const indexPath = path.join(distPath, "index.html");

  console.log(`Production mode detected.`);
  console.log(`process.cwd(): ${process.cwd()}`);
  console.log(`distPath: ${distPath}`);
  console.log(`indexPath: ${indexPath}`);

  if (fs.existsSync(distPath)) {
    console.log("dist directory exists.");
    if (fs.existsSync(indexPath)) {
      console.log("index.html exists in dist.");
    } else {
      console.error("index.html MISSING in dist!");
    }
  } else {
    console.error("dist directory MISSING!");
  }

  app.use(
    express.static(distPath, {
      index: false,
    }),
  );

  app.get("*", (req, res) => {
    // If it's an API route that reached here, it's a 404
    if (req.url.startsWith("/api/")) {
      console.warn(`404 - API route not found: ${req.url}`);
      return res.status(404).json({ error: "API route not found" });
    }

    // In production, we serve index.html for all non-API routes (SPA fallback)
    console.log(`Serving index.html for: ${req.url}`);
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error(`Error sending index.html: ${err.message}`);
          res
            .status(500)
            .send("Internal Server Error - Could not load index.html");
        }
      });
    } else {
      console.error(`index.html not found at ${indexPath}.`);
      res
        .status(404)
        .send(
          "Production build not found. Please ensure 'npm run build' has been executed.",
        );
    }
  });
}

async function startServer() {
  console.log("Starting server initialization...");

  // Start AI Worker (Polling for processing notes)
  if (db) {
    console.log("Initializing AI Worker (Polling)...");

    const processNotes = async () => {
      try {
        const snapshot = await db!
          .collection("notes")
          .where("status", "==", "processing")
          .get();

        const docs = snapshot.docs;
        if (docs.length === 0) return;

        console.log(`AI Worker: Found ${docs.length} notes to process.`);

        for (const doc of docs) {
          const noteData = doc.data();
          const noteId = doc.id;

          try {
            console.log(`AI Worker: Processing note ${noteId}...`);

            // Check for API key
            const apiKey =
              process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
            if (!apiKey) {
              throw new Error(
                "GEMINI_API_KEY or VITE_GEMINI_API_KEY is missing in backend environment.",
              );
            }

            // Get user profile to check autoSortEnabled
            const userProfileDoc = await db!
              .collection("users")
              .doc(noteData.userId)
              .get();
            const profile = userProfileDoc.data();

            const sorted = await magicSort(
              noteData.rawContent || noteData.content,
              "auto",
              (profile as { defaultLanguage?: string } | undefined)
                ?.defaultLanguage,
            );
            console.log(
              `AI Worker: Note ${noteId} result - isError: ${sorted.isError}`,
            );

            const updateData: any = {
              title: sorted.title,
              category: sorted.category,
              tags: sorted.tags,
              maskedContent: sorted.maskedContent,
              updatedAt: FieldValue.serverTimestamp(),
              status: sorted.isError ? "error" : "ready",
            };

            if (profile?.autoSortEnabled) {
              updateData.content = sorted.content;
              updateData.isAutoSorted = true;
            } else {
              updateData.isAutoSorted = false;
            }

            await db!.collection("notes").doc(noteId).update(updateData);
            console.log(`AI Worker: Note ${noteId} processed successfully.`);
          } catch (error) {
            console.error(`AI Worker: Error processing note ${noteId}:`, error);
            await db!
              .collection("notes")
              .doc(noteId)
              .update({
                status: "error",
                error: error instanceof Error ? error.message : String(error),
              });
          }
        }
      } catch (error) {
        console.error("AI Worker: Polling error:", error);
      }
    };

    // Poll every 10 seconds
    setInterval(processNotes, 10000);
    // Run immediately on start
    processNotes();
  } else {
    console.warn(
      "AI Worker skipped: Firestore database instance not available.",
    );
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || "development"} mode`,
    );
    console.log(
      "API routes registered: /api/health, /api/send-welcome, /api/send-goodbye",
    );
  });
}

// Start server if not running on Vercel (Vercel imports the app)
if (!process.env.VERCEL) {
  startServer();
}

export default app;
//testing
