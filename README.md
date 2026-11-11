# Patient Re-engagement Tool: Stage 2 Prototype

> **Prototype: test data only. Do not enter real patient information.**
> Nothing is really sent. Texts and emails are written to a `simulated_deliveries` table.

Staff upload a CSV of discharged patients. The app groups them into segments by time since discharge and drafts one check-in message per eligible patient. Nothing goes out until a named staff member approves it. A simulated inbox shows how replies get sorted.

**Stack:** Next.js 15 (TypeScript, server components and server actions), PostgreSQL through Prisma (migrations checked in), one Dockerfile, plus `docker compose`. It doesn't depend on any hosting platform's database, auth, storage or key-value service.

---

## Quick start (Docker)

```bash
cp .env.example .env
# edit .env: set SEED_USER_PASSWORD to something 12+ characters
docker compose up --build -d
docker compose exec app npm run seed
open http://localhost:3000
```

Sign in as any of the three seeded users. Each one's password is `SEED_USER_PASSWORD`.

| Email | Role | Location |
| --- | --- | --- |
| `admin@example.com` | Admin | all |
| `approver@example.com` | Approver | Northside Physical Therapy |
| `viewer@example.com` | Viewer | all (counts and audit only) |

The app container runs `prisma migrate deploy` every time it starts. To wipe the data and seed again: `docker compose exec app npm run seed -- --reset`.

## Local development (without Docker for the app)

You need Node 22 and a PostgreSQL 16 database.

```bash
npm install
cp .env.example .env            # point DATABASE_URL at your database, set SEED_USER_PASSWORD
npx prisma migrate deploy       # or: npm run migrate:dev while changing the schema
npm run seed
npm run dev                     # http://localhost:3000
```

## Tests

```bash
npm test                        # unit tests: segments, never-contact rules, reply sorting, CSV, templates, log redaction
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/reengage_test npm run test:integration
npm run typecheck
```

The integration tests run the spec's acceptance checks against a real database through the same service layer the web app uses. `TEST_DATABASE_URL` **must point to a database you don't care about**, because the tests wipe it repeatedly. The tests apply migrations themselves.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string (compose builds this from the `POSTGRES_*` values) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose only | Credentials for the compose database container |
| `APP_BASE_URL` | yes | Public URL, used to build email unsubscribe links |
| `COOKIE_SECURE` | no | `true` behind HTTPS. Defaults to `true` when `NODE_ENV=production`; compose sets `false` for plain-http localhost |
| `SESSION_TTL_HOURS` | no | Session length, default 12 |
| `SEED_USER_PASSWORD` | for seeding | Password for the three seeded users, 12+ characters |
| `DISPLAY_TIME_ZONE` | no | Time zone for dates in the UI, default `America/New_York` |
| `APP_PORT` | no | Host port for compose, default 3000 |
| `BCRYPT_ROUNDS` | no | bcrypt cost, default 12 |
| `LOG_LEVEL` | no | `silent` turns application logs off |
| `FAKE_SEND_FAIL` | no | `sms` or `email` makes the fake sender fail, to exercise the `failed` status |
| `TEST_DATABASE_URL` | tests only | Throwaway database for integration tests |

The code holds no secrets. The compose file's defaults are for local test use only.

---

## Workflow and screens

1. **Upload** (`/upload`): choose a CSV and see a preview, plus every rejected row with its reason. Then confirm. A file with a diagnosis, date of birth, insurance, address, body region or notes column is refused outright, and so is a file with any unexpected column.
2. **Segments** (`/segments`): patient counts per segment and location. "Eligible" is the number left after the never-contact rules. **Draft** creates messages in the queue.
3. **Approval queue** (`/queue`): approve, edit then approve (with a live character counter on texts), reject, or approve all selected. Filter by location, therapist, segment and channel.
4. **Outbox** (`/outbox`): approved messages with their simulated send time, status and approver.
5. **Inbox** (`/inbox`): replies with their sorting result and any suggested response. The **test panel** enters a reply on behalf of any patient.
6. **Patient record** (`/patients/[id]`): contact details, opt-in and opt-out flags, and the full message and reply history.
7. **Audit log** (`/audit`): searchable by action, user, entity and date. Includes the **walkthrough report** (see below).
8. **Settings** (`/settings`, admin only): users, locations, therapists, templates (with a live counter and preview) and segment day ranges.

Every page shows the prototype banner.

## Roles

Roles are enforced in the service layer (`src/services/*`) on every call. Pages and server actions check too, but the UI is never the only gate.

| Role | Can do |
| --- | --- |
| Admin | Everything, plus users, locations, therapists, templates and segment ranges. Only an admin can clear an opt-out or do-not-contact flag. |
| Approver | Upload, draft, approve, handle the inbox, set protective flags. **Only for their own location**: other locations' patients are invisible, and acting on them is refused. |
| Viewer | Segment counts and the audit log. Every change is refused. |

## Rules as built

**Segments** (inclusive day ranges, editable in Settings, Segments):

| Segment | Who | Default range |
| --- | --- | --- |
| Check-in | completed care | 14 to 30 days |
| 3-month | completed care | 75 to 105 days |
| 6-month | completed care | 165 to 195 days |
| 12-month | completed care | 350 to 380 days |
| Lapsed | stopped before finishing | 14 to 90 days |

If an admin makes two ranges overlap, a patient goes in the first matching segment, in the order above.

**Never drafted** (`src/lib/rules/eligibility.ts`): do-not-contact; no permitted channel (texts need `sms_opt_in`, no `sms_opt_out` and a mobile number; email needs an address and no `email_opt_out`); anyone with a drafted, approved or sent message for the same segment, ever; anyone sent any message in the last 30 days. A partial unique index in the database also blocks double-drafting if two people press Draft at once.

**Channel:** a text if the patient can be texted, otherwise email. Never both.

**Templates:** merge fields are `{first_name}`, `{therapist_first_name}`, `{location_name}`, `{location_phone}` and `{booking_link}`. Any other field is refused. Texts must include "Reply STOP" wording and fit in 300 characters (checked with realistic long names when saved, and again on every edit before approval). Every email gets an unsubscribe link from the sending layer, even if staff edit the text.

**Reply sorting** (`src/lib/classifier/keyword.ts`):

| Category | Triggers | Result |
| --- | --- | --- |
| Opt-out | stop, stopall, unsubscribe, remove me, opt out; a reply of just cancel/end/quit | Flags set at once, pending drafts withdrawn, one-line confirmation sent automatically |
| Clinical | pain, hurt(s), swelling/swollen, fell/fall, numb, medication/meds, worse, ache, injury, tingling | Urgent in the staff inbox, no suggested reply |
| Booking | book, appointment, schedule, come back in | Suggested reply with the booking link; sent only after staff approve it |
| Other | anything else | Staff inbox |

Clinical always beats booking. A reply that is both clinical and an opt-out ("stop texting me, my back hurts") applies the opt-out but stays an urgent clinical item.

## Swappable interfaces (for the AWS build)

| Interface | File | Prototype implementation |
| --- | --- | --- |
| `SmsSender` | `src/lib/senders/types.ts` | `FakeSmsSender` writes to `simulated_deliveries` |
| `EmailSender` | `src/lib/senders/types.ts` | `FakeEmailSender` writes to `simulated_deliveries` |
| `ReplyClassifier` | `src/lib/classifier/types.ts` | `KeywordReplyClassifier` |

To add Twilio, SES or an AI classifier, implement the interface and return it from `src/lib/senders/index.ts` or `src/lib/classifier/index.ts`. Nothing else changes.

## Privacy and logging

- The schema holds only what a check-in needs. There are no diagnosis, body region, insurance, date of birth, address or notes fields, and uploads with such columns are refused.
- Application logs (`src/lib/log.ts`) pass every field through an allow-list of id, status, count and category keys, and redact any value that looks like free text. Prisma query logging is off. A test checks the real log output for names, emails, phone numbers and message text.
- Audit rows store ids, counts and statuses only. Each one is written in the same transaction as the change it records.
- Passwords use bcrypt. Sessions are random tokens in httpOnly, SameSite=Lax cookies (Secure in production), and only the token's SHA-256 hash is stored. Deactivating a user or resetting their password ends their sessions.

## Fake data

- `npm run seed` creates 4 locations, 12 therapists, 3 users, 10 templates and **600 fictional patients** across every segment and the gaps between them. The patients have a realistic mix of opt-ins, opt-outs, do-not-contact flags, missing contact details and earlier messages. All names are obviously fictional, emails use `@example.com`, and phone numbers sit in the 555-0100 to 555-0199 range. The seed is deterministic.
- `sample-data/sample-patients.csv`: 50 rows. Eight have deliberate errors: missing contact details, a bad date, an unknown location, an unknown therapist, a bad discharge type, a bad mobile number, a duplicate external_id and a future date. Three rows reuse seeded ids `TEST-00001`/`00002`/`00003` (text opt-out, email opt-out, do-not-contact) to show that uploads never clear those flags.
- `sample-data/refused-diagnosis-column.csv` and `refused-date-of-birth-column.csv` should both be refused.
- Discharge dates in the samples are relative to the day they were generated. Run `npm run sample:csv` to refresh them.

## Acceptance checks: where each one is covered

| Check | Covered by |
| --- | --- |
| `docker compose up` + seed gives 600 patients | Quick start above |
| Sample CSV: valid rows accepted, each rejected row listed with a reason | `tests/integration/acceptance.test.ts` › upload |
| Diagnosis or date-of-birth column refused | integration › upload; `tests/unit/csv.test.ts` |
| Re-upload: no duplicates, opt-outs kept | integration › upload |
| Drafting skips the never-contact list | integration › drafting; `tests/unit/eligibility.test.ts` |
| No text opt-in gets an email, never a text | integration › drafting; unit › eligibility |
| Nothing reaches the outbox without a named approver | integration › approval and sending |
| Approver limited to their location; Viewer changes nothing | integration › roles and locations |
| "STOP" sets the opt-out flag and excludes the patient from the next draft | integration › replies |
| "Pain" goes to the inbox as urgent, no suggested reply | integration › replies; `tests/unit/classifier.test.ts` |
| Upload, approval, edit, rejection and send all audited | integration › audit log |
| Logs hold no names, emails, phone numbers or message text | integration › application logs; `tests/unit/log.test.ts` |
| All automated tests pass | `npm test` and `npm run test:integration` |

## Front-desk walkthrough

The **walkthrough report** at the bottom of the Audit log page covers two of the three things to bring back:

- **How long approving a batch took:** each user's approval runs (decisions less than 10 minutes apart) with counts and elapsed time.
- **Which messages were edited:** before-and-after text for every message edited before approval.

**Which filters people wanted** isn't tracked automatically. Capture it by asking or watching during the session.

## Decisions to review

These are places where the spec left room to choose.

- **A "STOP" reply turns off texts *and* email.** If it only stopped the channel they replied on, the next draft would fall back to email. That would break "excluded from the next draft" and isn't what someone typing STOP expects. An admin can clear either flag.
- **Unexpected CSV columns are refused**, not ignored, to keep to "store the minimum."
- **Approvers can import only their own location's rows**, and can't move a patient from another location.
- **A rejected or failed message doesn't block a re-draft** for that segment. Drafted, approved and sent messages do.
- **Opt-out confirmations send automatically**, as the spec says, and are recorded on the reply, not in the outbox. The outbox only ever holds staff-approved messages.
- **Approving sends straight away** (simulated). The spec has no separate send step.
- **The email unsubscribe link** uses the message id as its token and needs a button click, so link scanners can't unsubscribe people.

## Project layout

```
prisma/            schema, migrations, seed, fixtures, sample CSV builder
sample-data/       sample CSVs for the upload checks
src/lib/rules/     pure rules: segments, eligibility, templates, CSV validation
src/lib/classifier ReplyClassifier interface + keyword implementation
src/lib/senders    SmsSender / EmailSender interfaces + fakes
src/lib/auth       permissions, password hashing, session cookies
src/services/      all data access and actions; enforces roles and writes audit rows
src/app/           Next.js pages and server actions (thin wrappers over services)
tests/unit         rule tests (no database)
tests/integration  acceptance checks against PostgreSQL
```
