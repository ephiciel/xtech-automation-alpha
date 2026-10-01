# XTECH Automation V18

## V18 quantity-only sales update

- Removed monetary values and financial calculations from XTECH workflows.
- Sales Transactions now record customer, products, quantities, status, notes, dates, and the user who processed the transaction.
- Inventory and Sales reports no longer include monetary columns.
- Dashboard sales analytics now show **Total Units Sold** and **Units Sold — Last 7 Days**.
- The Sales report summary now shows transaction counts, units sold, and distinct products sold.
- Legacy monetary fields from older Firestore records are ignored and stripped from API responses used by the current application.
- XTECH no longer writes monetary fields to new product or sales records.
- Financial handling remains outside the scope of XTECH Automation.
- Updated the AI Help Assistant manual so it does not calculate or invent monetary values.

If the Firestore database already contains records created by older versions, V18 includes an optional one-time cleanup command that permanently removes the old monetary fields from product and sales documents:

```powershell
npm.cmd run cleanup:v18 -- --confirm
```

Back up the database first if you may need the old fields later. New V18 records do not create those fields.

## V17 Email OTP update

- Replaced the previous Email Link sign-in option with **Email OTP**.
- Users can choose between **Password + Authenticator** and **Email OTP**.
- Email OTP sends a short-lived 6-digit code to the user's registered email address.
- The user enters the code directly in XTECH before access is granted.
- Email OTP codes are single-use and are stored only as secure hashes in Firestore.
- Codes expire after 10 minutes by default.
- Users have a limited number of incorrect attempts before a new code is required.
- Resending is rate-limited with a 60-second cooldown by default.
- Successful Email OTP verification signs the existing Firebase user in with a server-generated Firebase custom token.
- Successful Email OTP verification also marks the Firebase email as verified because possession of the registered email address was proven.
- Added SMTP configuration for email delivery.

### Email OTP mail setup

Add these values to the project `.env` file:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-sender@gmail.com
SMTP_PASS=YOUR_APP_PASSWORD
MAIL_FROM=XTECH Automation <your-sender@gmail.com>
EMAIL_OTP_EXPIRY_MINUTES=10
EMAIL_OTP_RESEND_SECONDS=60
```

If Gmail is used, `SMTP_PASS` should be a **Gmail App Password**, not the normal Google account password.

After updating V17, run:

```powershell
npm.cmd install
npm.cmd start
```

The new `npm.cmd install` step is required because V17 adds the `nodemailer` package for SMTP email delivery.

## V16 AI Help Assistant update

- Updated the XTECH AI manual to cover the current authentication, validation, reporting, pickup-stock, and Account & Security features.
- Added current-page awareness so questions such as “What can I do here?” use the page the user is viewing.
- Added page-specific quick questions above the chat.
- Added a typing indicator while the assistant is generating a reply.
- Added a Copy button to assistant answers.
- AI requests no longer trigger the full-page loading overlay.
- Improved role-aware instructions and troubleshooting responses.
- Added stronger rules against inventing live stock values, hidden features, permissions, or completed actions.
- Added explicit guidance for V14 pickup stock synchronization and V15 password/security features.
- Existing per-user Firestore chat history and Clear Chat behavior are retained.

## Run the project

1. Run `npm.cmd install` after extracting the project on a new computer.
2. Copy your working `.env` file into the project root.
3. Copy `serviceAccountKey.json` into `backend/`.
4. Run `npm.cmd start`.
5. Open the localhost address shown by the server.
6. Press `Ctrl + C` to stop the server.

## Authentication

XTECH now provides two sign-in choices:

- **Password + Authenticator:** email/password followed by a TOTP Authenticator code.
- **Email OTP:** sends a 6-digit one-time code to the registered email address and verifies it inside XTECH.

### Firebase setup required

For Password + Authenticator:

1. In Firebase Console, upgrade Firebase Authentication to **Authentication with Identity Platform**.
2. Open **Authentication > Sign-in method > Email/Password**.
3. Enable **Email/Password**.
4. Under **Authentication > Settings > Authorized domains**, make sure your development/production domain is authorized. Use `localhost` for local development when needed.
5. Put your normal Firebase configuration in `.env`.
6. Make sure `backend/serviceAccountKey.json` exists.
7. Run:

   `npm.cmd run enable:totp`

8. Restart XTECH with:

   `npm.cmd start`

The old Firebase **Email link (passwordless sign-in)** provider is no longer required for V17 Email OTP.

### Password + Authenticator flow

- The user enters email and password.
- If the email is not verified, XTECH sends a verification email before allowing Authenticator setup.
- On first setup, XTECH shows a QR code and manual setup key.
- The user scans it using Google Authenticator or another TOTP-compatible app.
- The user enters the current 6-digit code to finish enrollment.
- Future Password + Authenticator sign-ins require the current Authenticator code.

### Email OTP flow

- The user chooses **Email OTP**.
- The user enters the email address of an existing active XTECH account.
- XTECH sends a 6-digit one-time code using the configured SMTP account.
- The user enters the code directly on the XTECH website.
- XTECH verifies the code on the backend.
- If valid, XTECH creates a Firebase custom sign-in token for that existing user and opens the pages allowed for the account role.
- The code is deleted after successful use.
- Expired codes, reused codes, and excessive failed attempts are rejected.

## V11 validation retained

V12 keeps the V11 validation improvements, including malformed email rejection, field-length checks, quantity checks, date checks, and backend validation.


## V13 report improvements

V13 improves the Reports section without adding another PDF library or external service.

- Print / Save PDF now creates a clean report-only document instead of printing the whole application screen.
- Inventory and Stock Movement reports automatically print in landscape orientation.
- Sales and Pickup reports print in portrait orientation.
- Printed reports include AGB XTECH Industrial Sales branding, report title, date range, generated date, generated-by name, row count, report-specific summary values, and the selected report table.
- Table headers repeat on additional printed pages and rows are kept together where the browser supports it.
- The export area now downloads the currently selected report as CSV instead of showing four separate CSV buttons.
- If the date filters were changed after the last generation, XTECH refreshes the report before exporting or printing so stale data is not used.

Use the browser print dialog to choose a physical printer or **Save as PDF**.


## V14 pickup stock synchronization

V14 strengthens Ordering / Pickup Schedule stock validation.

- The current product quantity from the admin inventory is the authoritative stock source.
- The pickup quantity field automatically uses the current stock as its maximum.
- XTECH refreshes product stock before adding an item and again immediately before submitting a pickup request.
- The backend performs the final stock check inside a Firestore transaction, so stale browser data cannot create an oversized order.
- A pickup request is rejected if any requested quantity is greater than the current admin inventory quantity.
- Pickup items save the exact product name, unit, and ordered quantity that the admin sees for the request.
- Admin approval rechecks stock again.
- Completing a pickup rechecks stock one final time before deducting inventory.
- If stock has changed and is no longer sufficient, approval/completion is blocked with the current available quantity.

Pending pickup requests do not deduct inventory until the pickup is completed. This keeps the existing XTECH inventory workflow intact while preventing a single pickup request from exceeding current stock.
