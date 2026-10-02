const crypto = require("crypto");
function envNumber(name, fallback, min, max) {
    const value = Number(process.env[name]);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(value)));
}

function otpExpiryMinutes() {
    return envNumber("EMAIL_OTP_EXPIRY_MINUTES", 10, 5, 30);
}

function otpResendSeconds() {
    return envNumber("EMAIL_OTP_RESEND_SECONDS", 60, 30, 300);
}

function getResendConfig() {
    const apiKey = String(process.env.RESEND_API_KEY || "").trim();
    const from = String(process.env.MAIL_FROM || "XTECH Automation <no-reply@xtech-automation.com>").trim();

    if (!apiKey) {
        throw new Error("Email OTP is not configured. Add RESEND_API_KEY to the server environment.");
    }

    return { apiKey, from };
}

function generateOtpCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function createOtpHash(code) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(String(code), salt, 32).toString("hex");
    return { salt, hash };
}

function verifyOtpHash(code, salt, expectedHash) {
    try {
        const actual = crypto.scryptSync(String(code), String(salt), 32);
        const expected = Buffer.from(String(expectedHash), "hex");
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

function emailChallengeId(email) {
    return crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");
}

function maskEmail(email) {
    const [local, domain] = String(email).split("@");
    if (!local || !domain) return email;
    const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
    return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

async function sendOtpEmail(email, code, purpose = "signin") {
    const { apiKey, from } = getResendConfig();
    const minutes = otpExpiryMinutes();

    const registration = purpose === "registration";
    const action = registration ? "finish your XTECH registration" : "sign in to XTECH";
    const subject = registration ? "Verify your XTECH registration" : "Your XTECH sign-in code";
    const text = [
        "XTECH Automation",
        "",
        `Your verification code is: ${code}`,
        "",
        `Use this code to ${action}.`,
        `This code expires in ${minutes} minutes and can only be used once.`,
        "If you did not request this code, you can ignore this email."
    ].join("\n");
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111827">
            <h2 style="margin-bottom:8px">XTECH Automation</h2>
            <p style="margin-top:0;color:#4b5563">Use this verification code to ${action}:</p>
            <div style="font-size:34px;font-weight:700;letter-spacing:8px;padding:18px 20px;background:#f3f4f6;border-radius:12px;text-align:center">${code}</div>
            <p style="color:#4b5563">This code expires in ${minutes} minutes and can only be used once.</p>
            <p style="color:#6b7280;font-size:13px">If you did not request this code, you can ignore this email.</p>
        </div>
    `;

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from,
            to: [email],
            subject,
            text,
            html
        })
    });

    if (!response.ok) {
        let details = "";
        try {
            const body = await response.json();
            details = body?.message || body?.name || JSON.stringify(body);
        } catch {
            details = await response.text().catch(() => "");
        }
        throw new Error(`Resend email delivery failed (${response.status})${details ? `: ${details}` : "."}`);
    }

    return response.json();
}

module.exports = {
    createOtpHash,
    emailChallengeId,
    generateOtpCode,
    maskEmail,
    otpExpiryMinutes,
    otpResendSeconds,
    sendOtpEmail,
    verifyOtpHash
};
