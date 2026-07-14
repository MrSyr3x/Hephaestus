# Hephaestus — AI App Builder

Describe an app in plain English and Hephaestus generates working React
code for it, live, with a preview running in the browser. Chat to iterate,
attach a reference image, let a PRO agent make targeted file-by-file edits,
or export the result as a standalone project.

> New to this codebase? [`hephaestus.md`](./hephaestus.md) is a from-scratch,
> in-depth walkthrough of how every part of this app actually works —
> written for someone learning the stack, not just skimming the code.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Auth + Billing | Clerk |
| Database | Postgres via Prisma (hosted on Supabase) |
| Image Storage | Supabase Storage |
| Security | Arcjet (bot detection, shield, rate limiting) |
| AI Model | Gemini 3.5 Flash |
| AI Agent ("Improve") | Cline SDK (`@cline/sdk`) |
| Code Editor + Preview | Sandpack (`@codesandbox/sandpack-react`) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| ORM | Prisma |

## Features

- **Landing page** — prompt box with rotating placeholders, feature grid,
  pricing table (Clerk's `<PricingTable />`)
- **Auth** — Clerk sign-in, a user row lazily created/synced in the database
  on first load, credits top-up on plan upgrade
- **Workspace** — split chat + live code/preview panel, persistent chat
  history, image attachments, streamed AI responses
- **AI generation** (`/api/gen-ai-code`) — Gemini streams live status
  updates while it writes a complete app; generated npm packages are
  validated against the real npm registry before use
- **Improve with Agent** (Starter/Pro) — a Cline SDK agent makes targeted
  edits to individual files instead of regenerating the whole app, streaming
  each patch into the live preview as it happens
- **Fix with AI** — Sandpack runtime/compile errors surface a one-click
  "Fix with AI" action
- **Projects page** — every past workspace, with delete support
- **Export to ZIP** — downloads a standalone, ready-to-run project
- **Credit system** — Free (10), Starter (50), Pro (150) generations/month

## Getting Started

### Prerequisites

- Node.js 20+
- A Supabase project (Postgres database + Storage)
- A Clerk application
- A Google AI Studio API key (Gemini)
- An Arcjet key

### Installation

```bash
npm install
```

Generate the Prisma client and push the schema:

```bash
npx prisma generate
npx prisma db push
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Create a `.env` file in the project root:

```env
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# Database (Supabase Postgres connection strings)
DATABASE_URL=
DIRECT_URL=

# Arcjet
ARCJET_KEY=

# Supabase (Storage — separate from the database connection above)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Google Gemini
GEMINI_API_KEY=
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` must be the **publishable/anon** key from
Supabase's dashboard (Settings → API) — never the `sb_secret_...` key, which
would be exposed client-side.

## Database Setup

`prisma/schema.prisma` defines two models:

**User** — synced from Clerk on first request (see `lib/checkUser.ts`)
```
id, clerkId, name, email, imageUrl, credits, plan, createdAt, updatedAt
```

**Workspace** — one per AI session
```
id, userId (FK), title, messages (JSON), fileData (JSON), createdAt, updatedAt
```

`fileData` stores the generated files and their validated dependencies as a
single JSON blob per workspace.

Supabase Storage bucket used for chat image uploads: `workspace-images`
(public, organized by `userId/workspaceId/`).
