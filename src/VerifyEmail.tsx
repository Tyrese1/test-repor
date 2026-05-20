import { useEffect, useRef, useState } from "react";
import { applyActionCode, checkActionCode } from "./firebase";

type Stage = "verifying" | "success" | "already" | "expired" | "invalid";

export default function VerifyEmail() {
  const [stage, setStage] = useState<Stage>("verifying");
  const [email, setEmail] = useState<string | null>(null);
  const oobCodeRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oobCode = params.get("oobCode");

    if (!oobCode) {
      setStage("invalid");
      return;
    }
    oobCodeRef.current = oobCode;

    // Step 1: peek at the code to grab the email and confirm validity
    checkActionCode(oobCode)
      .then((info) => {
        const captured = info?.data?.email || null;
        setEmail(captured);
        // Step 2: actually consume it
        return applyActionCode(oobCode).then(() => "fresh" as const);
      })
      .then((result) => {
        if (result === "fresh") setStage("success");
      })
      .catch((err: any) => {
        const code = err?.code || "";
        if (code === "auth/expired-action-code") {
          setStage("expired");
        } else if (
          code === "auth/invalid-action-code" ||
          code === "auth/user-not-found"
        ) {
          // invalid-action-code can also mean "already used" — show a friendly
          // "already verified" stage so a returning user doesn't get scared.
          setStage("already");
        } else {
          setStage("invalid");
        }
      });
  }, []);

  return (
    <div style={styles.root}>
      <div style={styles.bgOrb1} />
      <div style={styles.bgOrb2} />

      <div style={styles.card}>
        {/* wordmark only — no logo, per spec */}
        <div style={styles.logoRow}>
          <span style={styles.logoText}>zakar</span>
        </div>

        {stage === "verifying" && (
          <div style={styles.centreBlock}>
            <div style={styles.spinner} />
            <p style={styles.mutedText}>Verifying your email…</p>
          </div>
        )}

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
            <h1 style={styles.heading}>Email verified</h1>
            <p style={styles.mutedText}>
              {email ? (
                <>
                  <span style={styles.emailChip}>{email}</span> is confirmed.
                  You can now sign in to Zakar.
                </>
              ) : (
                <>Your email is confirmed. You can now sign in to Zakar.</>
              )}
            </p>
            <a
              href="https://use.myzakar.app"
              className="zk-submit-btn"
              style={styles.submitBtn}
            >
              Sign in to Zakar
            </a>
          </div>
        )}

        {stage === "already" && (
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
            <h1 style={styles.heading}>Already verified</h1>
            <p style={styles.mutedText}>
              This link has already been used. Your account is good to go —
              just sign in.
            </p>
            <a
              href="https://use.myzakar.app"
              className="zk-submit-btn"
              style={styles.submitBtn}
            >
              Sign in to Zakar
            </a>
          </div>
        )}

        {stage === "expired" && (
          <div style={styles.centreBlock}>
            <div style={styles.errorRing}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path
                  d="M16 9v8M16 22h.01"
                  stroke="#c97a2c"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h1 style={{ ...styles.heading, fontSize: "1.25rem" }}>
              Link expired
            </h1>
            <p style={styles.mutedText}>
              This verification link has expired. Sign in and we'll send you a
              fresh one.
            </p>
            <a
              href="https://use.myzakar.app"
              className="zk-submit-btn"
              style={styles.submitBtn}
            >
              Sign in to Zakar
            </a>
          </div>
        )}

        {stage === "invalid" && (
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
            <h1 style={{ ...styles.heading, fontSize: "1.25rem" }}>
              Link invalid
            </h1>
            <p style={styles.mutedText}>
              This verification link is missing or malformed. Sign in and we
              can resend a new one.
            </p>
            <a
              href="https://use.myzakar.app"
              className="zk-submit-btn"
              style={styles.submitBtn}
            >
              Sign in to Zakar
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

/* ─── shared design tokens (kept identical to ResetPassword for visual continuity) ─── */
const SAGE = "#4f6354";
const SAGE_LIGHT = "#d2e8d5";

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
  heading: {
    fontSize: "1.45rem",
    fontWeight: 700,
    color: "#1a2e1e",
    margin: "0 0 6px",
    letterSpacing: "-0.025em",
    lineHeight: 1.2,
  },
  emailChip: {
    background: SAGE_LIGHT,
    color: SAGE,
    borderRadius: "6px",
    padding: "1px 7px",
    fontWeight: 600,
    fontSize: "0.8rem",
  },
  mutedText: {
    fontSize: "0.9rem",
    color: "#6b7a70",
    lineHeight: 1.6,
    margin: 0,
    maxWidth: "320px",
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
    transition: "background 0.2s, transform 0.1s, box-shadow 0.2s",
    fontFamily: "inherit",
    boxSizing: "border-box",
    marginTop: "8px",
  },
  spinner: {
    width: "28px",
    height: "28px",
    border: `3px solid ${SAGE_LIGHT}`,
    borderTop: `3px solid ${SAGE}`,
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

/* inject keyframes + button interaction styles once. Shared id with the reset
   page so the rules are deduplicated across routes. */
if (typeof document !== "undefined") {
  const id = "zk-reset-keyframes";
  if (!document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      @keyframes zkSpin { to { transform: rotate(360deg); } }

      .zk-submit-btn { will-change: transform, background-color, box-shadow; }
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
    `;
    document.head.appendChild(s);
  }
}
