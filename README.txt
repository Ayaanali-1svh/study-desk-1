STUDY DESK — CLOUD HOMEWORK PLANNER
===================================

This version uses email address + password accounts. There is NO email code,
verification email, Resend account, or sending domain required.

WHAT IT DOES
------------
- Students create an account with their name, email address, and password.
- Passwords are hashed with bcrypt before they are saved; they are never stored
  as plain text.
- Accounts, assignments, study sessions, and sign-in sessions are stored in
  the hosted PostgreSQL database.
- The same account can sign in from another browser or device and access the
  same planner data, provided they use the same deployed Study Desk website URL.
- While the planner is open, it checks for changes from other browsers every
  15 seconds.
- The dashboard starts empty. It does not add sample homework.

IMPORTANT: THIS IS A FULL-STACK WEBSITE
---------------------------------------
HTML and CSS alone cannot securely create accounts or share data between
browsers. This project includes a Node.js server and needs an online PostgreSQL
database before account creation will work.

SETUP
-----
1. Install Node.js 20 or newer.
2. Use a hosted PostgreSQL database such as your Supabase project.
3. Copy .env.example to a file named .env.
4. Fill in the values in .env:
   - DATABASE_URL: your Supabase PostgreSQL Session Pooler connection string,
     including your actual database password.
   - SESSION_SECRET: a long random secret (at least 32 characters).
   You can generate it in a terminal with:
      node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
5. In a terminal opened in this project folder, run:
      npm install
      npm start
6. Open http://localhost:3000 in your browser.

The server creates the required database tables automatically when it starts.
Do not upload your .env file or share its values. Never put the database
password or session secret in public frontend files.

DEPLOYMENT FOR CROSS-BROWSER USE
-------------------------------
To use the same account on different browsers/devices, deploy this project to
an HTTPS Node.js host and keep the hosted PostgreSQL database connected. Set
DATABASE_URL and SESSION_SECRET in the hosting dashboard. Then open the same
deployed website URL in each browser and sign in with the same email and
password. Each browser gets its own secure sign-in cookie; account and planner
data remain in the shared database.

ACCOUNT / EMAIL NOTE
-------------------
This simpler version does not send a verification code or confirm that the
email address belongs to the person signing up. Enter an email address that
you can access and keep your password safe. There is no password-reset email
flow in this version, so losing the password may mean losing access to that
account. A password-reset feature can be added later if needed.

PROJECT FILES
-------------
public/index.html   Page structure and account forms
public/style.css    Responsive website design
public/app.js       Browser-side interactions and API requests
server.js           Account, session, and planner API
schema.sql          PostgreSQL database tables
package.json        Node.js dependencies and run commands
.env.example        Environment variable template (safe placeholders only)

SECURITY NOTES
--------------
- Use HTTPS when the site is deployed.
- Keep .env private and do not commit it to GitHub.
- Keep SESSION_SECRET private and use a unique, randomly generated value.
- Passwords are hashed using bcrypt.
- Sign-up and sign-in requests are rate-limited.
