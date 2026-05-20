import { useState, useEffect, useRef } from "react";
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
  isCurrentPassword,
} from "./firebase";

type Stage = "verifying" | "form" | "success" | "error";

export default function ResetPassword() {
  const [stage, setStage] = useState<Stage>("verifying");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const oobCodeRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── parse oobCode from URL and verify it ── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oobCode = params.get("oobCode");

    if (!oobCode) {
      setStage("error");
      setServerError("This link is missing a reset code. Please request a new one.");
      return;
    }

    oobCodeRef.current = oobCode;

    verifyPasswordResetCode(oobCode)
      .then((emailFromCode) => {
        setEmail(emailFromCode);
        setStage("form");
        setTimeout(() => inputRef.current?.focus(), 100);
      })
      .catch(() => {
        setStage("error");
        setServerError(
          "This reset link has expired or already been used. Please request a new one."
        );
      });
  }, []);

  /* ── password strength ── */
  const strength = (() => {
    if (password.length === 0) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return Math.min(s, 4);
  })();

  const strengthLabel = ["", "Weak", "Fair", "Good", "Strong"][strength];
  const strengthColor = ["", "#e53e3e", "#d97706", "#65a30d", "#22c55e"][strength];

  /* ── submit ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);

    if (password.length < 8) {
      setFieldError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setFieldError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      // Block password reuse: try signing in with the candidate password.
      // If it works, that means it matches the current password — reject.
      // The oobCode is NOT consumed by this check.
      const sameAsCurrent = await isCurrentPassword(email, password);
      if (sameAsCurrent) {
        setFieldError(
          "This is your current password. Please choose a different one."
        );
        setSubmitting(false);
        return;
      }

      await confirmPasswordReset(oobCodeRef.current!, password);
      setStage("success");
    } catch (err: any) {
      const msg =
        err?.code === "auth/weak-password"
          ? "Choose a stronger password (8+ characters)."
          : err?.code === "auth/expired-action-code"
          ? "This link has expired. Please request a new password reset."
          : "Something went wrong. Please try again.";
      setServerError(msg);
      setStage("error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.root}>
      {/* ── ambient background ── */}
      <div style={styles.bgOrb1} />
      <div style={styles.bgOrb2} />

      <div style={styles.card}>
        {/* ── wordmark ── */}
        <div style={styles.logoRow}>
          <span style={styles.logoText}>zakar</span>
        </div>

        {/* ── verifying ── */}
        {stage === "verifying" && (
          <div style={styles.centreBlock}>
            <div style={styles.spinner} />
            <p style={styles.mutedText}>Verifying your link…</p>
          </div>
        )}

        {/* ── form ── */}
        {stage === "form" && (
          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.headingBlock}>
              <h1 style={styles.heading}>Set a new password</h1>
              <p style={styles.subheading}>
                Resetting for <span style={styles.emailChip}>{email}</span>
              </p>
            </div>

            {/* new password */}
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="zk-pass">
                New password
              </label>
              <div style={styles.inputWrap}>
                <input
                  id="zk-pass"
                  ref={inputRef}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldError(null);
                  }}
                  placeholder="Min. 8 characters"
                  className="zk-input"
                  style={styles.input}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="zk-eye-btn"
                  style={styles.eyeBtn}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </div>

              {/* strength bar */}
              {password.length > 0 && (
                <div style={styles.strengthWrap}>
                  <div style={styles.strengthTrack}>
                    {[1, 2, 3, 4].map((n) => (
                      <div
                        key={n}
                        style={{
                          ...styles.strengthSeg,
                          background: strength >= n ? strengthColor : "#d1d5db",
                          opacity: strength >= n ? 1 : 0.3,
                          transition: "background 0.3s, opacity 0.3s",
                        }}
                      />
                    ))}
                  </div>
                  <span style={{ ...styles.strengthLabel, color: strengthColor }}>
                    {strengthLabel}
                  </span>
                </div>
              )}
            </div>

            {/* confirm password */}
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="zk-confirm">
                Confirm password
              </label>
              <div style={styles.inputWrap}>
                <input
                  id="zk-confirm"
                  type={showConfirm ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    setFieldError(null);
                  }}
                  placeholder="Repeat your password"
                  className="zk-input"
                  style={{
                    ...styles.input,
                    borderColor:
                      confirm.length > 0 && confirm !== password
                        ? "#e53e3e"
                        : confirm.length > 0 && confirm === password
                        ? "#22c55e"
                        : undefined,
                  }}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="zk-eye-btn"
                  style={styles.eyeBtn}
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  {showConfirm ? <EyeOff /> : <Eye />}
                </button>
              </div>
              {confirm.length > 0 && confirm === password && (
                <p style={{ ...styles.hint, color: "#22c55e" }}>✓ Passwords match</p>
              )}
            </div>

            {/* inline error */}
            {fieldError && <p style={styles.errorBadge}>{fieldError}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="zk-submit-btn"
              style={{
                ...styles.submitBtn,
                opacity: submitting ? 0.7 : 1,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? (
                <span style={styles.btnSpinner} />
              ) : (
                "Reset password"
              )}
            </button>

            <a href="https://use.myzakar.app" className="zk-back-link" style={styles.backLink}>
              <span className="zk-back-arrow" aria-hidden="true">←</span>
              <span> Back to sign in</span>
            </a>
          </form>
        )}

        {/* ── success ── */}
        {stage === "success" && (
          <div style={styles.centreBlock}>
            <div style={styles.successRing}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path
                  d="M7 16l7 7 11-11"
                  stroke="#4f6354"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 style={styles.heading}>Password updated</h1>
            <p style={styles.mutedText}>
              Your password has been changed successfully.
            </p>
            <a href="https://use.myzakar.app" className="zk-submit-btn" style={styles.submitBtn}>
              Sign in to Zakar
            </a>
          </div>
        )}

        {/* ── error ── */}
        {stage === "error" && (
          <div style={styles.centreBlock}>
            <div style={styles.errorRing}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path
                  d="M10 10l12 12M22 10L10 22"
                  stroke="#e53e3e"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h1 style={{ ...styles.heading, fontSize: "1.25rem" }}>Link invalid</h1>
            <p style={styles.mutedText}>{serverError}</p>
            <a
              href="https://use.myzakar.app"
              className="zk-submit-btn"
              style={{ ...styles.submitBtn, background: "#4f6354" }}
            >
              Request a new link
            </a>
          </div>
        )}
      </div>

      <p style={styles.footer}>
        © {new Date().getFullYear()} Zakar · your unorganized brain dump
      </p>
    </div>
  );
}

/* ─── inline SVG icons (no lucide dep needed on this standalone page) ─── */
const Eye = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOff = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

/* ─── styles (CSS-in-JS object — no Tailwind needed on this isolated page) ─── */
const SAGE = "#4f6354";
const SAGE_LIGHT = "#d2e8d5";
const SAGE_MID = "#6b8f72";

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "#f4f7f4",
    fontFamily: "'Manrope', 'Inter', sans-serif",
    padding: "24px 16px",
    position: "relative",
    overflow: "hidden",
  },
  bgOrb1: {
    position: "fixed",
    top: "-120px",
    right: "-80px",
    width: "420px",
    height: "420px",
    borderRadius: "50%",
    background: `radial-gradient(circle, ${SAGE_LIGHT}55 0%, transparent 70%)`,
    pointerEvents: "none",
    zIndex: 0,
  },
  bgOrb2: {
    position: "fixed",
    bottom: "-80px",
    left: "-100px",
    width: "360px",
    height: "360px",
    borderRadius: "50%",
    background: `radial-gradient(circle, ${SAGE_LIGHT}44 0%, transparent 70%)`,
    pointerEvents: "none",
    zIndex: 0,
  },
  card: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: "420px",
    background: "#ffffff",
    borderRadius: "20px",
    boxShadow: "0 4px 24px rgba(79,99,84,0.10), 0 1px 4px rgba(79,99,84,0.06)",
    padding: "40px 36px",
    border: "1px solid #e4ece5",
  },
  logoRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "32px",
  },
  logoText: {
    fontSize: "1.25rem",
    fontWeight: 700,
    color: SAGE,
    letterSpacing: "-0.03em",
    fontFamily: "'Manrope', sans-serif",
  },
  centreBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: "16px",
  },
  headingBlock: {
    marginBottom: "8px",
  },
  heading: {
    fontSize: "1.45rem",
    fontWeight: 700,
    color: "#1a2e1e",
    margin: "0 0 6px",
    letterSpacing: "-0.025em",
    lineHeight: 1.2,
  },
  subheading: {
    fontSize: "0.875rem",
    color: "#6b7a70",
    margin: 0,
    lineHeight: 1.5,
  },
  emailChip: {
    background: SAGE_LIGHT,
    color: SAGE,
    borderRadius: "6px",
    padding: "1px 7px",
    fontWeight: 600,
    fontSize: "0.8rem",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "0.8125rem",
    fontWeight: 600,
    color: "#374740",
    letterSpacing: "0.01em",
  },
  inputWrap: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  input: {
    width: "100%",
    padding: "11px 44px 11px 14px",
    borderRadius: "10px",
    border: "1.5px solid #d0dbd2",
    background: "#f9fbf9",
    fontSize: "0.9375rem",
    color: "#1a2e1e",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
    transition: "border-color 0.2s",
  },
  eyeBtn: {
    position: "absolute",
    right: "12px",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#8fa897",
    display: "flex",
    alignItems: "center",
    padding: "4px",
  },
  strengthWrap: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginTop: "4px",
  },
  strengthTrack: {
    display: "flex",
    gap: "4px",
    flex: 1,
  },
  strengthSeg: {
    flex: 1,
    height: "4px",
    borderRadius: "99px",
  },
  strengthLabel: {
    fontSize: "0.75rem",
    fontWeight: 600,
    minWidth: "36px",
  },
  hint: {
    fontSize: "0.75rem",
    margin: "2px 0 0",
    fontWeight: 500,
  },
  errorBadge: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    borderRadius: "8px",
    padding: "10px 14px",
    fontSize: "0.85rem",
    margin: 0,
    lineHeight: 1.5,
  },
  submitBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    padding: "13px",
    borderRadius: "11px",
    border: "none",
    background: SAGE,
    color: "#ffffff",
    fontSize: "0.9375rem",
    fontWeight: 700,
    letterSpacing: "0.01em",
    textDecoration: "none",
    cursor: "pointer",
    transition: "background 0.2s, transform 0.1s",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  backLink: {
    alignSelf: "center" as const,
    fontSize: "0.8125rem",
    color: SAGE_MID,
    textDecoration: "none",
    fontWeight: 500,
  },
  mutedText: {
    fontSize: "0.9rem",
    color: "#6b7a70",
    lineHeight: 1.6,
    margin: 0,
    maxWidth: "280px",
  },
  successRing: {
    width: "64px",
    height: "64px",
    borderRadius: "50%",
    background: SAGE_LIGHT,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "4px",
  },
  errorRing: {
    width: "64px",
    height: "64px",
    borderRadius: "50%",
    background: "#fef2f2",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "4px",
  },
  spinner: {
    width: "28px",
    height: "28px",
    border: `3px solid ${SAGE_LIGHT}`,
    borderTop: `3px solid ${SAGE}`,
    borderRadius: "50%",
    animation: "zkSpin 0.8s linear infinite",
  },
  btnSpinner: {
    display: "inline-block",
    width: "18px",
    height: "18px",
    border: "2.5px solid rgba(255,255,255,0.4)",
    borderTop: "2.5px solid #ffffff",
    borderRadius: "50%",
    animation: "zkSpin 0.8s linear infinite",
  },
  footer: {
    position: "relative",
    zIndex: 1,
    marginTop: "28px",
    fontSize: "0.75rem",
    color: "#9aaa9f",
    textAlign: "center" as const,
  },
};

/* inject keyframes + interaction styles once */
if (typeof document !== "undefined") {
  const id = "zk-reset-keyframes";
  if (!document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      @keyframes zkSpin { to { transform: rotate(360deg); } }

      /* primary button (also used as <a>) */
      .zk-submit-btn {
        will-change: transform, background-color, box-shadow;
      }
      .zk-submit-btn:hover {
        background: #3f5345 !important;
        box-shadow: 0 4px 14px rgba(79,99,84,0.25);
      }
      .zk-submit-btn:active {
        transform: scale(0.98);
        box-shadow: 0 2px 6px rgba(79,99,84,0.2);
      }
      .zk-submit-btn:focus-visible {
        outline: 2px solid #4f6354;
        outline-offset: 2px;
      }

      /* secondary back-to-sign-in link — arrow animates, no background */
      .zk-back-link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 4px;
        text-decoration: none;
        transition: color 0.15s ease;
      }
      .zk-back-link:hover {
        color: #3f5345 !important;
      }
      .zk-back-link:focus-visible {
        outline: 2px solid #4f6354;
        outline-offset: 4px;
        border-radius: 4px;
      }

      .zk-back-arrow {
        display: inline-block;
        font-size: 1em;
        line-height: 1;
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        transform-origin: center;
        will-change: transform;
      }
      .zk-back-link:hover .zk-back-arrow {
        transform: translateX(-4px) scale(1.25);
      }
      .zk-back-link:active .zk-back-arrow {
        transform: translateX(-6px) scale(1.3);
      }

      /* input focus polish */
      .zk-input:focus {
        border-color: #4f6354 !important;
        background: #ffffff !important;
        box-shadow: 0 0 0 3px rgba(79,99,84,0.12);
      }

      /* eye toggle hover */
      .zk-eye-btn:hover { color: #4f6354; }
    `;
    document.head.appendChild(s);
  }
}
