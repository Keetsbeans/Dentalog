# Dentalog

Clinic software for a single-dentist practice: patients, appointments, visit notes and prescriptions, billing and receipts, lab orders, WhatsApp reminders, and A4 printouts on the clinic's own letterhead. Built first for Oyster Dental Care, Chennai.

## Stack

- **App:** React + React Router, built with Vite
- **API:** Hono on Cloudflare Workers (`/api/*`)
- **Data:** Cloudflare D1 (SQLite) via Drizzle ORM; files (X-rays, photos, letterheads) in Cloudflare R2
- **Nightly job:** a cron trigger at 2 AM India time removes anything that has been in Recently deleted for 30 days

## Run it on your computer

```sh
npm install
npm run db:migrate:local   # creates the tables and the clinic's starting numbers
npm run dev                # http://localhost:5173
npm test
```

## Run it on your computer: sign-in

Create a file called `.dev.vars` with `DENTALOG_PASSWORD=any-test-password`. The app asks for it on first load.

## Put it online (Cloudflare Workers Builds)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick this repository.
2. Project name `dentalog`. Build command `npm run build`. Deploy command `npm run deploy`. Leave the rest as it is.
3. The first deploy creates the `dentalog` D1 database and sets up the tables and starting numbers.
4. Worker → **Settings** → **Variables and secrets** → add a **Secret** named `DENTALOG_PASSWORD` with the clinic password.

Every merge to `main` then deploys by itself.

Sign-in: one clinic password. A device stays signed in for 30 days. Changing the password signs every device out. Five wrong tries from one address lock it for 15 minutes.

## Rules the code follows

- Money is stored in paise as whole numbers.
- Times are stored in UTC and shown in India time.
- Deleting only marks a row as deleted. It stays in Recently deleted for 30 days, can be restored, and is then removed for good.
- Patient, file, invoice, receipt and lab numbers continue from the old software (CJ963, DCJ-1986, INV-0029, RCPT27, L-105) and are never reused.
