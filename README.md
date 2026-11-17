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

## First deploy to Cloudflare

```sh
npx wrangler login
npx wrangler d1 create dentalog          # paste the database_id into wrangler.jsonc
npx wrangler r2 bucket create dentalog-files
npm run db:migrate:remote
npm run deploy
```

Do not put real patient data online until login is in place.

## Rules the code follows

- Money is stored in paise as whole numbers.
- Times are stored in UTC and shown in India time.
- Deleting only marks a row as deleted. It stays in Recently deleted for 30 days, can be restored, and is then removed for good.
- Patient, file, invoice, receipt and lab numbers continue from the old software (CJ963, DCJ-1986, INV-0029, RCPT27, L-105) and are never reused.
