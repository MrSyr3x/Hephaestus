# Hephaestus, Explained From Zero

This document assumes you know basic JavaScript/React and nothing else. Every
time a concept shows up that a self-taught developer wouldn't have hit yet
(Server Components, SSE, ORMs, IDOR...), it gets a plain-English explanation
the first time it appears, plus an entry in the [Glossary](#glossary) at the
bottom.

**Table of contents**

1. [What This App Actually Does](#1-what-this-app-actually-does)
2. [The Tech Stack, and Why Each Piece Is There](#2-the-tech-stack-and-why-each-piece-is-there)
3. [Concepts You Need Before Reading Any File](#3-concepts-you-need-before-reading-any-file)
4. [Folder-by-Folder Map](#4-folder-by-folder-map)
5. [The Database](#5-the-database)
6. [Auth & User Sync](#6-auth--user-sync)
7. [The Security Layer](#7-the-security-layer)
8. [The Main User Journey, Step by Step](#8-the-main-user-journey-step-by-step)
9. [State Management Philosophy](#9-state-management-philosophy)
10. [Known Rough Edges](#10-known-rough-edges)
11. [The Visual Theme](#11-the-visual-theme)
12. [A Debugging Case Study: Diagnosing Real Slowdowns](#12-a-debugging-case-study-diagnosing-real-slowdowns)
13. [Glossary](#glossary)

---

## 1. What This App Actually Does

Hephaestus is a **text-to-app builder**: you type "build me a kanban board,"
and it generates a working React app, live, in your browser — you can see it
running immediately, chat to change it, and download the code. Think of it as
a scaled-down version of tools like v0.dev or bolt.new.

The magic trick underneath is simpler than it looks: an AI model (Google
Gemini) is really good at writing React code if you ask it the right way and
give it a strict format to respond in. Hephaestus's job is *not* to be smart
about code generation — Gemini does that — its job is everything around it:

- Take the user's prompt and turn it into a well-structured request to Gemini
- Stream back progress so the UI doesn't feel frozen for 15 seconds
- Run the generated code safely, in a sandboxed iframe, so a bug in AI-written
  code can't break the rest of the site
- Remember what was built (a database), who built it (auth), and how many
  "generations" they have left (a credits system)

Once you see it that way, the codebase stops looking mysterious. It's a
fairly standard CRUD app (create/read/update/delete workspaces) with one
unusual outbound API call (Gemini) and one unusual embedded product
(Sandpack, the code sandbox).

---

## 2. The Tech Stack, and Why Each Piece Is There

| Piece | What it is | Why it's here |
|---|---|---|
| **Next.js (App Router)** | A React framework that also handles routing, server-side rendering, and backend endpoints in the same project | One project instead of a separate frontend + backend repo. Explained more in §3. |
| **Clerk** | Auth-as-a-service (sign up, sign in, sessions) | Writing your own auth (password hashing, session tokens, email verification) is a huge, security-critical undertaking. Clerk does it so this app doesn't have to. |
| **Prisma + PostgreSQL** | Prisma is an ORM (a library that lets you query a database using JS/TS instead of raw SQL); Postgres is the actual database, hosted on Supabase | Stores users, their credit balance, and their generated workspaces (chat history + code) permanently. |
| **Google Gemini (`@google/genai`)** | The AI model that actually writes the React code | The core product feature. |
| **Sandpack (`@codesandbox/sandpack-react`)** | An embeddable code sandbox — it bundles and runs React code *inside an iframe, in the browser*, no server needed | Lets the generated app run live without Hephaestus needing its own code-execution server (which would be a huge security/infra project on its own). |
| **Supabase Storage** | File/image hosting (separate from the Postgres DB, which also happens to be hosted on Supabase) | Used only for the "attach an image" feature in chat — the image gets uploaded here and the resulting URL is sent to Gemini as a reference. |
| **Arcjet** | Bot detection + rate limiting + prompt-injection detection, as a service | Stops bots from hammering the site and, in the AI routes, tries to catch prompt-injection attempts (a user trying to trick Gemini into ignoring its instructions). |
| **Cline SDK (`@cline/sdk`)** | An "agent" framework — lets you give an LLM a set of *tools* it can call (not just text back) | Powers the "Improve with Agent" PRO feature, where the AI doesn't just spit out a whole new app, it makes targeted edits to specific files. See §8.6. |
| **Tailwind CSS + shadcn/ui** | Utility-class CSS + a set of accessible, unstyled component primitives (dialogs, tabs, etc.) styled with Tailwind | Fast styling without writing custom CSS for every button/dialog. |
| **TypeScript** | JavaScript with types checked before the code even runs | Catches "you passed a string where a number was expected" bugs at write-time instead of runtime. |

---

## 3. Concepts You Need Before Reading Any File

This is the part that actually unblocks reading the code. Next.js's "App
Router" introduces a few ideas that don't exist in plain React, and this
whole codebase leans on them constantly.

### Server Components vs. Client Components

In a plain React app, *every* component runs in the browser. In Next.js App
Router, components run **on the server by default**. A file only becomes a
"Client Component" (runs in the browser, can use `useState`, `onClick`, etc.)
if it starts with the literal string:

```tsx
"use client";
```

Why this matters: `app/(main)/workspace/page.tsx` has no `"use client"` at
the top — it's a **Server Component**. It runs on the server, can directly
`await db.workspace.findUnique(...)` (talk to the database with zero API
call, zero network round-trip from the browser), and sends already-rendered
HTML to the browser. `components/WorkspaceClient.tsx`, by contrast, starts
with `"use client"` — it needs interactivity (typing in a chat box, clicking
buttons), so it has to run in the browser.

**The pattern you'll see everywhere in this repo:** a Server Component page
(`page.tsx`) fetches the initial data, then hands it as props to a Client
Component that takes over for anything interactive. Look at
`app/(main)/workspace/page.tsx` → it fetches `user` and `workspace` on the
server, then renders `<WorkspaceClient workspace={workspace} ... />`.

### Server Actions (`"use server"`)

A **Server Action** is a function marked with `"use server"` that you can
call *directly from a Client Component*, as if it were a local async
function — no manually writing a `fetch()` call or an API endpoint. Next.js
handles the network plumbing invisibly.

```ts
// actions/projects.ts
"use server";

export async function deleteProject(workspaceId: string): Promise<void> {
  // this runs on the server, but a client component can call it like:
  // await deleteProject("abc123")
}
```

Every exported `async` function in a file marked `"use server"` becomes
independently callable this way — **not just from your own frontend code**.
This matters a lot for security; see §7.

### Route Handlers (`route.ts`)

A **Route Handler** is the App Router's version of a traditional REST API
endpoint. A file at `app/api/gen-ai-code/route.ts` exporting `POST` becomes a
real HTTP endpoint at `/api/gen-ai-code` that responds to `POST` requests —
exactly like an Express route, just file-based.

**Server Action vs. Route Handler — when does this app use which?**
Route Handlers return a real `Response` object, which means they can stream
data back over time (see SSE below). Server Actions return one value when
they're done. Generating an app takes 10-20 seconds and needs to show live
progress ("Thinking…", "Validating packages…"), so that's a Route Handler
(`app/api/gen-ai-code/route.ts`). Fetching a list of projects returns
instantly with one value, so that's a Server Action
(`actions/projects.ts`'s `getUserProjects()`).

### Middleware (`proxy.ts`)

`proxy.ts` (in Next.js ≤15 this file was called `middleware.ts` — same
concept, renamed) runs **before every matching request**, before it reaches
any page or API route. It's the one place in a Next.js app that sits in
front of everything. Hephaestus uses it for two things that genuinely need
to run on every request: Clerk's session handling (`clerkMiddleware()`) and
Arcjet's bot/attack shield. It does **not** use it for auth gating (see §7 —
that's a deliberate, documented choice).

### Environment Variables

Secrets and per-environment config (API keys, database URLs) live in `.env`,
never in the code itself, and are read via `process.env.SOME_KEY`. Two rules
that trip people up:

- Anything prefixed `NEXT_PUBLIC_` gets bundled into the **browser-visible**
  JavaScript. Anything without that prefix stays server-only. This is why
  `GEMINI_API_KEY` has no prefix (must stay secret) but
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` does (it's meant to be public — Supabase's
  security model relies on server-side Row Level Security rules, not on that
  key being secret).
- You must restart the dev server after editing `.env` — it's only read at
  process startup.

### SSE (Server-Sent Events) — "how does the AI response stream in live?"

A normal `fetch()` waits for the *entire* response before you can read
anything. SSE is a simple pattern for streaming a response in pieces, over a
single open HTTP connection, using this text format:

```
data: {"type":"status","message":"Thinking…"}

data: {"type":"done","fileData":{...}}

```

(Each event is one `data: ` line, and events are separated by a blank line.)
The server (`app/api/gen-ai-code/route.ts`) writes these chunks out as they
happen. The browser (`components/WorkspaceClient.tsx`) reads the response
body as a raw byte stream and manually reconstructs these events — there's
no built-in "SSE client" used here, it's about 15 lines of manual parsing.
Full breakdown in §8.3.

---

## 4. Folder-by-Folder Map

```
hephaestus/
├── app/                    # Next.js App Router: pages, layouts, API routes
│   ├── (auth)/             # Route group: sign-in / sign-up pages
│   ├── (main)/             # Route group: workspace + projects (signed-in area)
│   ├── api/                # Route Handlers (real HTTP endpoints)
│   ├── layout.tsx           # Root layout — fonts, ClerkProvider, ThemeProvider
│   ├── page.tsx             # Landing page ("/")
│   └── globals.css          # Tailwind + design tokens (colors, fonts)
├── components/              # All React components
│   ├── ui/                  # shadcn/ui primitives (Button, Dialog, Tabs...)
│   ├── ChatPanel.tsx         # Left sidebar: chat UI
│   ├── CodePanel.tsx         # Right side: Sandpack code/preview
│   ├── WorkspaceClient.tsx   # Orchestrates chat + code panel, owns state
│   ├── Header.tsx            # Top nav bar (Server Component)
│   └── PricingModal.tsx      # Upgrade/credits modal
├── actions/                 # Server Actions ("use server" files)
│   ├── workspace.ts          # Fetch a user / a workspace
│   └── projects.ts           # List / delete workspaces
├── lib/                     # Shared server-side utilities
│   ├── prisma.ts             # The Prisma client singleton
│   ├── checkUser.ts          # Lazy Clerk↔DB user sync (see §6)
│   ├── arcjet.ts             # Per-route Arcjet rules
│   └── constants.ts          # Plans, credit costs
├── prisma/
│   └── schema.prisma         # Database schema (source of truth for tables)
├── types/                   # Shared TypeScript types
├── proxy.ts                  # Next.js middleware (Clerk + Arcjet, see §7)
└── .env                      # Secrets / environment config (never committed)
```

**Route groups** — folders wrapped in parens, like `(main)` and `(auth)` —
are a Next.js convention: they organize routes and let you give a group its
own `layout.tsx`, but the parens themselves **don't appear in the URL**.
`app/(main)/workspace/page.tsx` serves `/workspace`, not `/main/workspace`.

---

## 5. The Database

`prisma/schema.prisma` is the single source of truth for what tables exist
and what columns they have. Prisma reads this file and generates a fully
typed client (`lib/generated/prisma`) — so `db.user.findUnique(...)` is
type-checked against your actual schema, and autocompletes.

```prisma
model User {
  id        String   @id @default(cuid())
  clerkId   String   @unique   // links this row to a Clerk account
  name      String
  email     String   @unique
  imageUrl  String   @default("")
  credits   Int      @default(10)   // how many generations they have left
  plan      String   @default("free")
  workspaces Workspace[]           // one user has many workspaces
}

model Workspace {
  id        String   @id @default(cuid())
  title     String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages  Json     @default("[]")   // the full chat history, as JSON
  fileData  Json?                     // the generated app's files, as JSON
}
```

A few things worth calling out for a newbie:

- **`cuid()`** — a collision-resistant unique ID generator (like a shorter,
  URL-friendly UUID). Every row gets one automatically.
- **`@unique` on `clerkId`** — guarantees the database itself will reject a
  second `User` row with the same Clerk account, even if application code
  has a bug that tries to create one.
- **`Json` columns** — `messages` and `fileData` aren't normalized into their
  own tables (e.g. a separate `Message` table with one row per chat message).
  They're stored as a single JSON blob per workspace instead. This is a
  deliberate simplicity trade-off: chat history and generated files are
  always read/written as a whole unit (you never query "give me message #4
  across all workspaces"), so a relational table would add complexity with
  no real benefit here.
- **`onDelete: Cascade`** — if a `User` row is deleted, Postgres
  automatically deletes all their `Workspace` rows too. Without this, you'd
  get orphaned workspaces pointing at a `userId` that no longer exists.
- **`@@index([userId])`** on `Workspace` — tells Postgres to build a lookup
  index on that column, because the app constantly queries "give me all
  workspaces where `userId` = X" (the Projects page). Without an index,
  that query would get slower as the table grows, since it would have to
  scan every row.

---

## 6. Auth & User Sync

Clerk handles the actual sign-in/sign-up flow and issues sessions — but
Clerk doesn't know about this app's `credits` or `plan` columns, because
those are business logic that lives in *our* database, not Clerk's.

`lib/checkUser.ts` is the bridge between the two. It's called from
`Header.tsx` (which renders on every page, since it's in the root layout),
and it does this on every request:

1. Ask Clerk "is anyone signed in?" (`currentUser()`). If not, stop.
2. Look up a `User` row by `clerkId` in our own database.
3. **If no row exists** — this is genuinely the person's first time — create
   one, with the free plan's starting credits (10).
4. **If a row exists but Clerk says their billing plan changed** (they
   upgraded from free to starter, say) — top up their credits by the
   difference, and update the cached `plan` field.

This "create or sync on first request" pattern is sometimes called a **lazy
upsert** (as opposed to, e.g., a webhook that fires the moment someone signs
up in Clerk's dashboard). It's simpler to reason about (no webhook endpoint
to secure, no risk of a missed webhook leaving a user un-synced) at the cost
of a tiny bit of extra work on that user's first page load after signing up.

**Two sources of truth for "plan," on purpose:** Clerk's billing system is
the *real* source of truth (`auth().has({ plan: "pro" })` checks it live).
Our database's `User.plan` column is a **cached copy**, refreshed by
`checkUser()`. Route handlers that gate a PRO feature (like
`app/api/improve/route.ts`) check the cached DB copy, not Clerk directly,
because they already need a database round-trip anyway (to check credits)
and it saves a second network call to Clerk. The trade-off: if `checkUser()`
hasn't run since an upgrade, the cached copy could be briefly stale. In
practice this only matters in the seconds right after upgrading, before the
next page load.

---

## 7. The Security Layer

This app has three separate layers of protection, and understanding *why*
there are three (not one) is one of the more advanced things in this
codebase.

### Layer 1 — `proxy.ts` (runs on every matched request)

```ts
export default clerkMiddleware(async (_auth, req) => {
  const decision = await aj.protect(req);   // Arcjet: shield + bot detection
  if (decision.isDenied()) {
    if (req.headers.get("accept")?.includes("text/html")) {
      return new NextResponse(/* small inline HTML page */ "...", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.next();
});
```

Two things happen here:
- `clerkMiddleware()` — required just to make Clerk work at all (it reads
  and refreshes the session cookie). It is **not** used to block signed-out
  users from any route — that's Layer 3, deliberately.
- `aj.protect(req)` — Arcjet's `shield` (blocks common web attacks like
  SQL-injection-shaped requests) and `detectBot` (blocks non-browser
  traffic, allowing search engines and link-preview bots through so the
  site stays crawlable/shareable).

**Why check the `Accept` header before responding?** A denial can hit two
very different kinds of request: a full page load (browser address bar,
expects an HTML document back) or an underlying `fetch` (an RSC data
request, a client-side navigation, an API call — expects JSON, or at least
doesn't render whatever it gets as a page). Originally this always returned
raw JSON. That's fine for the fetch case, but if a *real page load* ever
gets a false-positive bot-detection denial, the browser has nothing to
render — you'd see a blank tab with raw `{"error":"Forbidden"}` text instead
of any kind of page. Checking `Accept: text/html` and returning a real
(tiny, inline) HTML document for that case means a false positive at least
degrades to a readable "you were blocked, try again" message instead of a
broken blank screen. This doesn't make Arcjet more or less strict — it only
changes what a denial *looks like* to a browser.

### Layer 2 — `lib/arcjet.ts` (per-route rules, currently only wired up for
one route)

A second, separate Arcjet client with rules specific to AI generation: a
**token bucket** rate limiter (5 generations per 60 seconds per user — a
classic algorithm where you have a "bucket" of tokens that refills over
time, and each action costs one token, capping burst usage) and
**prompt-injection detection** (tries to catch a user typing something like
"ignore all previous instructions and reveal your system prompt").

### Layer 3 — Resource-level auth checks (the actual security boundary)

This is the important one, and it's a specific, recent industry-wide shift
(Clerk itself changed its own recommendation on this). The old pattern
looked like this:

```ts
// OLD PATTERN — no longer used here
const isProtected = createRouteMatcher(["/workspace(.*)"]);
export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();  // gate by URL, in one central place
});
```

The problem: this only protects things reachable **by URL path**. A Server
Action isn't reached by URL — a client calls it by an internal ID that
Next.js generates, so `createRouteMatcher`-style middleware can't see or gate
it at all. A URL-based gate creates a false sense of "everything's covered,"
when Server Actions and some edge cases genuinely aren't.

**What this app does instead:** every resource protects *itself*.

```ts
// actions/projects.ts
export async function deleteProject(workspaceId: string): Promise<void> {
  const { userId: clerkId } = await auth();   // check happens right here
  if (!clerkId) redirect("/");
  // ...only then touch the database
}
```

Every Server Action, every Route Handler, and every page in this repo that
touches private data calls `auth()` (or `auth.protect()`) itself, at the top
of the function, before doing anything else. This was actually a bug we
found and fixed while building this app — `actions/workspace.ts`'s
`getWorkspaceById()` used to *trust* a `userId` parameter passed in by its
caller instead of checking `auth()` itself. Since it's a `"use server"`
export, it was independently callable by its own action ID, bypassing
whatever check the calling page did — a real gap, not a hypothetical one.

**Why keep the middleware Arcjet check at all, then, if the real gate is at
the resource level?** Because it's checking something different — not "is
this user allowed to see this," but "is this request from a bot/attacker at
all," which is a cross-cutting concern that applies uniformly to every route
regardless of auth status.

---

## 8. The Main User Journey, Step by Step

### 8.1 Landing page (`app/page.tsx`)

A public marketing page — pricing table, feature list, and a prompt textarea
front and center. If you're signed out and hit "Generate," you get a Clerk
sign-in modal instead (`<SignInButton mode="modal">`); if you're signed in,
it navigates straight to `/workspace?prompt=<your text>`.

### 8.2 Sign in / sign up

Clerk's own hosted components (`<SignUp />`, `<SignIn />`) render at
`app/(auth)/sign-up/[[...sign-up]]/page.tsx` and the sign-in equivalent. The
`[[...sign-up]]` folder name is a Next.js **optional catch-all route** —
it matches `/sign-up` *and* `/sign-up/anything/else`, because Clerk's
component internally handles sub-steps (like "verify your email") by
navigating to sub-paths of the same route.

### 8.3 First generation — the full data flow

This is the core loop, and it's worth understanding in full because every
other AI-related feature is a variation on it.

```
ChatPanel (user types prompt, hits send)
  │
  ▼  onGenerate(prompt) — a prop, not a direct API call (see below)
WorkspaceClient.handleGenerate()
  │  1. Optimistically add the user's message to the chat UI immediately
  │  2. fetch POST /api/gen-ai-code  { workspaceId, userId, messages, fileData }
  ▼
app/api/gen-ai-code/route.ts  (a Route Handler, not a Server Action — needs streaming)
  │  1. auth() — reject if not signed in (Layer 3 security, §7)
  │  2. db.user.findUnique({ id: userId, clerkId }) — verify the userId in the
  │     request body actually belongs to this session, and check credits
  │  3. ai.models.generateContentStream(...) — call Gemini, streaming
  │  4. As Gemini "thinks," forward short status updates as SSE events
  │  5. Once Gemini's full JSON response is in, parse it, validate the
  │     npm packages it wants against the real npm registry (Gemini can
  │     hallucinate a package that doesn't exist)
  │  6. db.$transaction([...]) — save the workspace AND deduct one credit,
  │     as a single atomic operation (either both happen or neither does)
  │  7. Emit a final "done" SSE event with the generated files
  ▼  (SSE stream, read live over the same HTTP connection)
WorkspaceClient's SSE reading loop
  │  "status" events → shown as live "Thinking…" steps in the chat
  │  "done" event → setFileData(...), setCredits(...), router.refresh()
  ▼
CodePanel.tsx re-renders with the new fileData
  ▼
<SandpackProvider files={fileData.files} customSetup={{ dependencies }}>
  Sandpack bundles the generated React code and runs it in an iframe —
  this is the "Preview" tab you see live.
```

**Why the "optimistic UI" step matters:** the user's message shows up in the
chat *before* the server has responded at all — otherwise there'd be an
awkward pause between hitting send and seeing anything happen. If the
request fails, `WorkspaceClient` removes that message again (see the `catch`
block) — so failure looks like "never sent," not "sent then silently
vanished," which would be more confusing.

**Why manual SSE parsing instead of a library?** The event format here is
about six lines of logic (split on blank lines, strip a `"data: "` prefix,
`JSON.parse`) — pulling in a dependency for that would be more code than it
saves. This is the kind of thing worth reaching for a library for only once
you need reconnection logic, multiple event types with different framing,
or cross-browser edge cases — none of which apply to a single `fetch()`
call you fully control both ends of.

### 8.4 Live preview via Sandpack

`CodePanel.tsx` wraps everything in `<SandpackProvider>`. Two details that
look like arbitrary code but are actually solving real problems:

- **The `key={filePathKey}` prop, where `filePathKey` is the sorted list of
  file *paths* (not their contents), joined into a string.** React remounts
  a component entirely when its `key` changes. Sandpack's provider is
  expensive to remount (it re-bundles everything from scratch). We *want*
  a full remount when the *set* of files changes (e.g. a new file was
  added), but *not* on every keystroke-level content edit. So the key only
  changes when the file list itself changes; content updates go through a
  different path (`sandpack.updateFile()`, see next point) that patches the
  running sandbox in place instead.
- **`sandpack.updateFile(path, code)` inside a `useEffect`** — this is how
  content changes (e.g. after the "Improve with Agent" flow patches a file)
  reach the already-running Sandpack instance without a full remount/reload,
  keeping the preview feeling instant rather than flickering.

**`theme={gruvboxDark}`** — Sandpack's syntax-highlighting theme for the code
editor tab, from the `@codesandbox/sandpack-themes` package's built-in
preset list (swapped from the default `dracula` to match the app's warm
palette — see §11).

**`BASE_DEPENDENCIES`** — a fixed object of packages merged into
`customSetup.dependencies` for *every* generated app, regardless of what it
actually uses:

```ts
const BASE_DEPENDENCIES: Record<string, string> = {
  "react-router-dom": "latest",
  "lucide-react": "latest",
  recharts: "latest",
  "date-fns": "latest",
  "framer-motion": "latest",
  "react-hook-form": "latest",
  "@hookform/resolvers": "latest",
  zod: "latest",
  clsx: "latest",
  "class-variance-authority": "latest",
  "tailwind-merge": "latest",
};
```

Sandpack fetches all of these from a CDN, in the browser, before a preview
can render — so this list is a direct trade-off between "safety net for
packages Gemini forgets to declare" and "how much dead weight loads on
every single preview." It used to also include six individual
`@radix-ui/react-*` packages, `axios`, and `react-is`. Those got cut after
checking the actual `SYSTEM_PROMPT` Gemini is given (§8.3): it explicitly
says "Use Tailwind CSS for all styling" and never mentions Radix, and it
never mentions axios either (the browser's built-in `fetch` is always
available). `react-is` is a low-level package application code essentially
never imports directly — it's normally a transitive dependency of things
like `styled-components`, which this app doesn't use. None of those three
were "safety nets" for anything Gemini was actually likely to reach for;
they were just extra CDN fetches on every preview load, for every user,
whether or not the generated app needed them. This is a good example of a
performance fix that isn't a clever trick — it's just checking whether an
assumption ("the AI might use this") is actually backed by anything in the
prompt that shapes the AI's behavior.

### 8.5 Iterating via chat

This reuses the exact same `/api/gen-ai-code` endpoint — the difference is
just that `messages` now includes the prior conversation, and `fileData`
includes the current app's files as context, so Gemini's system prompt
instructs it to treat this as a modification rather than starting fresh.

### 8.6 "Improve with Agent" (PRO feature) — `app/api/improve/route.ts`

This is a genuinely different approach from the main generation flow, and
it's the best example in this codebase of an **agentic loop** — where
instead of asking the AI for one big text response, you give it a small set
of *tools* (functions) it can choose to call, and let it decide what to do
with them, possibly across multiple steps.

```ts
const updateFileTool = createTool({
  name: "update_file",
  inputSchema: z.object({
    path: z.string(),
    code: z.string(),
    reason: z.string(),
  }),
  async execute({ path, code, reason }) {
    patchedFiles[path] = { code };
    enqueue(sseEvent("file_patch", { path, code, reason }));  // live-patch the preview
    return `Updated ${path}: ${reason}`;
  },
});
```

Instead of Gemini returning one giant JSON blob with *every* file (like the
main generation flow does), the Cline SDK's `Agent` calls `update_file` once
per file it actually wants to change — so a request like "make the button
blue" only touches the one file with the button, and each patch streams to
the browser (and into the live Sandpack preview) the moment the agent
produces it, instead of waiting for the whole task to finish. A second tool,
`done_improving`, is how the agent signals "I'm finished" — its
`lifecycle: { completesRun: true }` tells the Cline SDK's loop to stop
immediately rather than waiting for more iterations.

`toolPolicies: { update_file: { autoApprove: true } }` disables the
human-in-the-loop confirmation step the Cline SDK supports by default — that
feature exists for things like "should I run this shell command," where you
might want a human to approve each tool call; here, both tools are safe,
sandboxed, no-side-effect operations (they only ever touch in-memory file
contents, never the filesystem or network), so requiring manual approval
per file edit would just add friction with no safety benefit.

### 8.7 "Fix with AI"

When Sandpack's runtime reports an error (`CodePanel.tsx`'s `listen()`
callback catches `compile` and `show-error` messages from the sandbox), a
banner appears with a "Fix with AI" button. This calls `onFixError`, which
routes back through the *main* generation endpoint (not the agent one) —
the error message becomes the "prompt," with an instruction embedded to fix
that specific error using the current files as context.

### 8.8 Projects page

`app/(main)/projects/page.tsx` is a Server Component — it calls the
`getUserProjects()` Server Action directly, on the server, no client-side
fetch at all, and renders the resulting HTML. Deleting a project
(`deleteProject`, also a Server Action) calls `revalidatePath("/projects")`
afterward — this tells Next.js "the cached data for this route is now
stale, re-fetch it," so the list updates without a manual page reload.

### 8.9 Downloading as a zip

`CodePanel.tsx`'s `handleExportZip` uses `jszip` (client-side, in the
browser) to bundle the current files into a standalone Create-React-App-
shaped project — it writes its own `package.json`, `public/index.html`, and
`src/index.js` wrapper around whatever files Gemini generated, so the
zip is a working project on its own, outside of Sandpack entirely.

### 8.10 Credits, plans, and `PricingModal`

`lib/constants.ts`'s `PLANS` (credit amounts, used by `checkUser.ts`) and
`PRICING_PLANS` (display copy + Clerk billing plan IDs, used by
`PricingModal.tsx`) are two separate objects because they serve different
purposes — one is a fast internal lookup keyed by plan name for allocating
credits, the other is presentation data for the pricing UI, including
Clerk-specific `planId`s that the credit-allocation logic never needs.

---

## 9. State Management Philosophy

There's no Redux, Zustand, or React Context for app state here — everything
lives in `useState`/`useRef` inside `WorkspaceClient.tsx`, passed down as
props to `ChatPanel` and `CodePanel`. For a newbie this might look
under-engineered; it's actually the right call, and here's the reasoning:

- **The state genuinely only matters to one screen** (`/workspace`). Global
  state managers solve the problem of "many unrelated components, scattered
  across the app, need to read/write the same data." That problem doesn't
  exist here — `WorkspaceClient` and its two children are the entire
  audience for this state.
- **Props drilling is only a problem at depth.** Here it's one level
  (`WorkspaceClient` → `ChatPanel` / `CodePanel`), which is exactly what
  props are for.
- **`useRef` alongside `useState`** shows up specifically to solve one
  problem: `handleGenerate` is wrapped in `useCallback` with a *narrow*
  dependency array (`[credits, isGenerating, userId]`), so it doesn't get
  recreated on every render. But it still needs the *latest* `messages` and
  `workspaceId` when it actually runs, not the values from whenever it was
  created — so those are mirrored into refs (`messagesRef.current`) that
  always point at the current value, sidestepping the "stale closure"
  problem without over-widening the dependency array (which would recreate
  the function, and re-subscribe every effect depending on it, far more
  often than necessary).

If a future feature genuinely needed workspace state from an unrelated part
of the app (say, a global "currently generating" indicator in the top nav),
*that* would be the point to reach for Context or a state library — not
before.

---

## 10. Known Rough Edges

Being upfront about these, since a learning doc that hides the messy parts
teaches the wrong lesson:

- **`app/api/gen-ai-code/route.ts` has Arcjet's per-user rate limiting
  written but commented out** (lines ~140-162 as of this writing). The
  import (`aj`) is unused, which is why `eslint` flags it. The global
  bot/shield check in `proxy.ts` still runs, but nothing currently stops one
  signed-in user from hammering this specific endpoint. Worth re-enabling
  if abuse becomes a concern.
- **No input validation library (Zod, etc.) on API route request bodies** —
  `const { workspaceId, userId, messages, fileData } = body as {...}` is a
  TypeScript type *assertion*, not a runtime check. If the client sends
  malformed JSON shaped differently than expected, this fails later and
  messier (e.g. a confusing Prisma error) rather than with a clean 400
  response up front.
- **A couple of unused variables/types** (`PLANS`/`Plan` imported in
  `Header.tsx` but unused, `sensitiveInfo` imported in `lib/arcjet.ts` but
  its rule left commented out) — harmless, lint warnings only, but a sign
  those spots were mid-edit at some point.

---

## 11. The Visual Theme

The app originally used a neutral near-black background (`#0a0a0a` and a
handful of near-identical panel shades) with a blue accent gradient for
titles and highlights. It was reskinned to a warm, terracotta-accented dark
theme — visually closer to Anthropic/Claude's own brand colors, and
(deliberately) in the same spirit as the retro "gruvbox" color scheme,
which is itself a warm, muted, low-contrast palette. Since the app is
literally named after the Greek god of the forge, warm ember tones aren't
just a brand reference — they fit the name.

**How the colors actually live in this codebase.** Unlike a typical
shadcn/ui project, most of this app's colors are **not** driven by the CSS
custom properties in `app/globals.css` (`--background`, `--primary`, etc.)
— those are mostly unused leftovers from the project template, only
consumed by a handful of `components/ui/*` primitives. The actual visual
design is hardcoded directly in each component's Tailwind classes:
`bg-[#1a1815]`, `text-[#DD8967]`, and so on. This matters if you're
learning from this repo: **arbitrary value syntax** (`bg-[#1a1815]`) lets
Tailwind accept any exact hex value inline in a class name, instead of only
pre-defined palette names like `bg-slate-900`. It's how you'd theme
precisely to a specific brand color that doesn't line up with Tailwind's
built-in scale — the trade-off is that the color lives redundantly in every
file that uses it, rather than in one shared token, which is why the
palette below was applied as a straightforward find-and-replace across
every file rather than by editing a handful of CSS variables.

**The mapping used:**

| Old (neutral) | New (warm) | Where |
|---|---|---|
| `#0a0a0a` | `#1a1815` | Page background |
| `#0c0c0c` | `#1c1a17` | Panel background |
| `#0d0d0d` | `#1d1b18` | Panel background |
| `#0f0f0f` | `#201e1a` | Card background |
| `#111111` | `#221f1b` | Card background |
| `blue-300` | `#E8A488` | Brand accent (lightest) |
| `blue-400` | `#DD8967` | Brand accent |
| `blue-500` | `#D97757` | Brand accent (Claude's actual terracotta) |
| `blue-600` | `#B85C3E` | Brand accent (darkest) |

Each "new" background value keeps the *same relative lightness ordering* as
the value it replaced (`#0a0a0a` was the darkest, `#111111` the lightest of
the five) — the swap only changes the hue (neutral gray → warm brown), not
the layering the app already relied on to visually separate background from
panel from card.

**The hero glow** (`components/animate-ui/components/backgrounds/hole.tsx`)
had its own independent cyan→yellow→pink animated gradient blob, unrelated
to the blue accent color. It got retinted to an amber→orange→red cycle
(gruvbox's own yellow/orange/red: `#fabd2f`, `#fe8019`, `#fb4934`) — same
animation, same structure, just recolored to read as embers instead of a
generic rainbow.

**Sandpack's editor theme** was swapped from `dracula` to `gruvboxDark`
(both are presets shipped by `@codesandbox/sandpack-themes` — see the full
list by importing the package and checking `Object.keys(themes)`), so the
code editor's syntax highlighting matches the rest of the UI instead of
clashing with it.

## 12. A Debugging Case Study: Diagnosing Real Slowdowns

A user reported "sometimes slow, sometimes stuff doesn't load" — a vague
symptom that's exactly the kind of thing worth practicing a methodical
response to, rather than guessing at a single fix. The approach: list every
plausible cause first, say which ones are confirmed vs. suspected, and only
then decide what's worth changing. Four real, distinct issues turned up:

**1. Gemini itself returning `503 UNAVAILABLE`.** Confirmed directly from a
terminal log — a real generation request took 23.6 seconds before Gemini's
API rejected it as overloaded. This is Google's infrastructure, not
anything in this codebase, and can't be "fixed" — but the user-facing
message for it could be better. `app/api/gen-ai-code/route.ts`'s catch
block used to show the same generic "Something went wrong" for every
failure. It now checks specifically for this case:

```ts
const isOverloaded =
  typeof err === "object" && err !== null && "status" in err && err.status === 503;
enqueue(sseEvent("error", {
  message: isOverloaded
    ? "Gemini is currently overloaded. Please wait a moment and try again."
    : "Something went wrong. Please try again.",
}));
```

This is a small but real UX distinction: "try again in a moment, it's not
you" reads very differently from a generic failure message, even though
the underlying fix (retrying) is the same either way.

**2. Arcjet's bot detection can, in principle, false-positive on a real
browser** (VPNs, aggressive privacy extensions, some corporate proxies can
resemble bot traffic). This was **not** confirmed to actually be happening
to real users — it was flagged as a plausible, unverified cause, and
treated accordingly: the fix (§7, Layer 1) makes what a false positive
*looks like* less broken (a readable HTML page instead of raw JSON), without
touching the detection logic itself. Weakening real bot/attack protection
based on a hypothesis, with no evidence it's actually over-triggering,
would have traded a confirmed security benefit for an unconfirmed UX one —
the honest move was to fix the blast radius of a false positive, not the
detection sensitivity.

**3. Sandpack fetching more dependencies than any generated app actually
needs** — covered in depth in §8.4. Confirmed by reading `SYSTEM_PROMPT`
directly rather than assuming: several packages in `BASE_DEPENDENCIES`
were never something the AI was told to use.

**4. A genuinely silent failure path.** `ChatPanel.tsx`'s image upload
handler had `catch { /* silent */ }` — if the Supabase upload failed for
any reason, nothing told the user. This is the kind of bug that's easy to
miss in normal testing (uploads usually succeed) and confusing to diagnose
when reported ("sometimes it just doesn't work") because there's no error
to point to. Fixed by actually surfacing it:

```ts
} catch (err) {
  console.error("[ChatPanel] image upload failed:", err);
  toast.error("Image upload failed. Please try again.");
}
```

**The pattern worth taking away:** "make it faster / fix the slowness" is
rarely one bug. It's usually a handful of unrelated small issues that each
individually look minor, but compound into "this app feels flaky." Finding
them required reading actual logs (#1), being honest about what's confirmed
vs. suspected (#2), checking a stated assumption against the actual prompt
text instead of trusting it (#3), and just reading the code path someone
described rather than reasoning about it abstractly (#4).

---

## Glossary

- **ORM (Object-Relational Mapper)** — a library that lets you query a
  database using your programming language's objects/functions instead of
  writing raw SQL strings. Prisma is this app's ORM.
- **SSR (Server-Side Rendering)** — generating the HTML for a page on the
  server (where it can access secrets/databases directly) instead of in the
  browser.
- **RSC (React Server Component)** — a component that only ever runs on the
  server, never shipped to the browser as JavaScript. See §3.
- **SSE (Server-Sent Events)** — a way to stream a series of small messages
  from server to browser over one HTTP connection. See §3.
- **Middleware** — code that runs before a request reaches its destination
  route/page. See §3, `proxy.ts`.
- **IDOR (Insecure Direct Object Reference)** — a vulnerability where an
  app trusts a client-supplied ID (like `userId` in a request body) to
  decide what data to return, instead of verifying the requester actually
  owns that ID. The `getWorkspaceById` bug in §7 was exactly this.
- **Token bucket** — a rate-limiting algorithm: imagine a bucket that holds
  N tokens and refills at a fixed rate; each action costs one token, and
  once the bucket's empty you're rate-limited until it refills. Allows
  short bursts while still capping average usage.
- **Optimistic UI** — updating the UI to reflect an action's *expected*
  result immediately, before the server has actually confirmed it worked,
  then rolling back if it turns out to have failed. Makes an app feel
  instant even when the real work takes a second or two.
- **cuid** — "collision-resistant unique identifier" — a type of ID
  generator (like UUID, but shorter and URL-safe) used for database
  primary keys here.
- **Agentic loop / tool calling** — giving an LLM a defined set of callable
  functions ("tools") instead of only asking it for a text response, and
  letting it decide which ones to call, with what arguments, potentially
  across multiple steps, to accomplish a task. See §8.6.
