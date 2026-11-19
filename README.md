# Feelgood Brothers

Mental-health blog in English (`/`) and Dutch (`/nl/`), with an admin at `admin.feelgoodbrothers.com`.
Everything runs in Docker (Docker Swarm, stack `feelgoodbrothers`) on the Weggeefdeals VPS, behind its nginx.

```
apps/web/        public site: Astro SSR (Node), renders posts from Postgres
apps/admin/      admin: Astro + React, login, posts / authors / categories / media / redirects
packages/core/   shared: Drizzle schema + migrations, queries, image storage, markdown, auth
nginx/           our block for the shared nginx (TLS, micro-cache, Cloudflare real IP)
docker-stack.yml production stack (web, admin, postgres, daily backup)
```

## How it works

- **Posts live in Postgres**, not in files. Publishing or scheduling in the admin is live immediately, with no rebuild.
- **Scheduling needs no cron**: a post is live when `status != 'draft' AND publish_at <= now()`.
- **EN and NL versions** of a story share a `translation_group`. That drives the language switcher, `hreflang` tags and the sitemap.
- **Images** are uploaded in the admin. They are converted once to WebP (480–2000px) plus a 1200×630 OG image, stored in `/opt/feelgoodbrothers/uploads` and served at `/media/…` with a one-year cache (nginx caches them too).
- **Guest stories** are posts with `kind = 'guest'`. The only public detail is `guest_name`, a first name or pseudonym. Email, consent date and note are internal and stripped from every public query. Guest stories have no author profile. They are listed between all other blogs and under their categories, with no separate section, and carry a "Guest story" / "Gastblog" badge plus "by <name>". Authors are only the Feelgood Brothers team.
- **Writing assistant** (admin → ✨ Schrijfhulp): pick a category and a recognisable situation (list per category, editable under Situaties, or "random" which picks the least used one). Pick a **writing style** too (10 to start with, editable under Schrijfstijlen, or 🎲 for a random one): the default "Mick" style sends the team's own latest posts along as voice samples, the others (diary, minute by minute, letter, …) each have their own instructions. The first-person rules, the story structure and the safety rules hold for every style. The AI streams a first-person **draft**. You can revise it by chatting, then save it as a post draft. Drafts may contain `[[…]]` placeholders where a real personal detail belongs; publishing is blocked until they are gone,. Providers are OpenAI and Claude behind one layer (`packages/core/src/ai/`), with "mock" for testing without a key. The editor can also create the other-language version with "Vertaal met AI". Token usage is stored per session in `ai_sessions`.
- **Read aloud** (editor → 🔊 Voorlezen): on request, the saved post is turned into an MP3 with OpenAI text to speech (`gpt-4o-mini-tts`, voice per language via `OPENAI_TTS_VOICE_EN/NL`, about $0.015 per audio minute). The file lands in the uploads folder as `/media/audio-….mp3` and the blog page shows a player ("Read aloud by an AI voice"). Nothing is generated automatically; the editor warns when the text changed since the audio was made. Without an OpenAI key (or with `AI_PROVIDER=mock`) a silent test file is written. Code: `packages/core/src/ai/speech.ts`.
- **Analytics**: Google Analytics 4 on the website (not the admin), consent first: nothing of Google loads until a visitor clicks "Accept" in the cookie banner (`apps/web/src/components/Analytics/Analytics.astro`). Set `GA_MEASUREMENT_ID` (G-…) to turn it on; empty = no banner, no GA. Page views are sent by the site itself (also on client-side navigation), so in GA turn **off** enhanced measurement's "Page changes based on browser history events". Extra events: `blog_read` (75% of a post scrolled) and `audio_play` (first play of the read-aloud audio). Traffic sources come from the referrer and UTM tags (shorts links carry `utm_source=youtube&utm_medium=shorts`). Privacy policy: `/privacy/` and `/nl/privacy/`.
- **Shorts** (editor → 🎬 Maak short, or admin → 🎬 Shorts): a 30–45 sec vertical animated video per post for YouTube Shorts / Reels. The AI writes an editable storyboard (hook, 4–6 scenes with narration, image description, camera motion and effect, end card, YouTube title/description/hashtags). Per scene the server makes an illustration (OpenAI images, `OPENAI_IMAGE_MODEL`, default `gpt-image-2`, one fixed flat style), the voice (same TTS as read aloud) and word timings for the captions (`whisper-1`). The animation is a Remotion composition (`apps/admin/src/shorts-video/`) that is previewed and rendered to MP4 **in the editor's browser** (`@remotion/web-renderer`, Chrome), so the shared server never renders video. Remotion is free for teams of up to 3 people. Code: `packages/core/src/shorts/`.
- **Admin login** has two steps: password, then a 6-digit code by mail (SMTP, `EMAIL_*` in `.env.production`, same setup as TransferNews). "Remember this device" skips the code (never the password) for 30 days. A remembered device is not affected by account or IP locks, so an attacker who locks your account doesn't lock you out on your own laptop; instead it has its own counter (5 wrong passwords and the device is forgotten, with a warning mail). Lockouts are stored in Postgres, so a deploy doesn't reset them:
  - password: 5 wrong per account in 15 min locks it for 15 min; the next lock within 24 h lasts 1 h; 20 wrong per IP locks that IP for 1 h, **only for a public IP**: internal/proxy addresses are never locked. Behind the Swarm ingress of the shared nginx every request arrives as `10.0.0.x`, so until nginx publishes its ports in host mode the per-IP rule is inactive and the per-account rule does the work
  - code: 10 min valid, single use, void after 3 wrong; 10 wrong per hour locks the account for 1 h
  - mail: max 5 codes per hour, 1 minute between resends
  - every lock mails a warning: an account lock to that account, an IP lock to every admin account
  - `create-admin` (setting a password) lifts lockouts and logs out everywhere. Locally, codes appear in `docker compose logs admin`.
- **Changing a slug** of a live post, category or author creates a 301 redirect automatically.
- **Comments** stay on Disqus (`feelgood-brothers.disqus.com`). The embed loads only when the reader scrolls to the comments.
- **SEO** covers canonical URLs, hreflang + x-default, Open Graph/X cards, JSON-LD (BlogPosting, BreadcrumbList, Organization, WebSite, ProfilePage), dynamic `sitemap.xml` (per-language sitemaps with alternates), `robots.txt`, RSS per language, author and category landing pages, related posts, and optional IndexNow pings and Cloudflare cache purge on publish.

## Local development

Astro 7 needs Node ≥ 22.23. The simplest way to run everything is Docker:

```bash
docker compose up -d --build
docker compose exec admin node scripts/import-mdx.mjs        # import the old MDX blogs (once)
docker compose exec -e ADMIN_PASSWORD='a-long-password' admin node scripts/create-admin.mjs you@example.com "Mick"
```

- Site: http://localhost:4321
- Admin: http://localhost:4322
- Uploads go to `./uploads`.

With Node ≥ 22.23 installed locally you can also run the apps with hot reload against the compose database:

```bash
docker compose up -d postgres
export DATABASE_URL=postgres://fgb:fgb_local_dev@localhost:5432/feelgoodbrothers UPLOADS_DIR=../../uploads
npm run db:migrate
npm run dev:web      # :4321
npm run dev:admin    # :4322
```

After changing `packages/core/src/schema.ts`, run `npm run db:generate` and commit the new file in `packages/core/drizzle/`. The admin container applies migrations on startup.

## Production (shared VPS)

The site runs on the **Weggeefdeals VPS** (docker context `weggeefdeals`) as its own stack `feelgoodbrothers`, next to the stacks `weggeefdeals` and `tintexclusive`.

- **nginx and certbot belong to the Weggeefdeals stack**, which owns ports 80/443. `fgb-web` and `fgb-admin` join its network `weggeefdeals_default`. Postgres and the backup job are only on the private network `fgb`.
- All our services are prefixed `fgb-`. Weggeefdeals also has services called `admin` and `postgres`, and short names on a shared network would resolve to the wrong container.
- Our nginx config is [nginx/feelgoodbrothers.conf](nginx/feelgoodbrothers.conf), one block between `# BEGIN/END feelgoodbrothers` markers.
- Our certificate `feelgoodbrothers.com` lives next to the others in `/opt/weggeefdeals/certbot`. The certbot service of Weggeefdeals renews it.
- Data on the server: `/opt/feelgoodbrothers/uploads` and `/opt/feelgoodbrothers/backups`, plus the Docker volume `feelgoodbrothers_postgres_data`.

**`./deploy.sh` never changes, restarts or redeploys Weggeefdeals or Tint Exclusive, and never writes into their repos.** It touches the shared nginx only with `--nginx`:
- It builds the new config from the config **on the server** and replaces only our block. It refuses if anything else would differ.
- It shows the diff, asks for confirmation, makes a backup, runs `nginx -t` and does a graceful reload (no restart).
- On failure it restores the previous config automatically.
- At the end it checks that every other service runs exactly as before.

> A copy of our block is also in `nginx/nginx.conf` of the **Weggeefdeals repo** (with the Tint Exclusive block), because a deploy of Weggeefdeals copies that file to the server. Tint Exclusive's `deploy.sh` syncs the same file. **When you change [nginx/feelgoodbrothers.conf](nginx/feelgoodbrothers.conf), update that copy too (PR in the Weggeefdeals repo)**, or the next Weggeefdeals deploy puts the old block back.
>
> Never deploy a Weggeefdeals config that contains our block before our certificate exists (`/opt/weggeefdeals/certbot/conf/live/feelgoodbrothers.com`): without it, nginx does not start and all three sites go down. The first `./deploy.sh` here requests it.
>
> That deploy also runs `docker stack rm weggeefdeals`, so nginx (and with it Tint Exclusive and Feelgood Brothers) is down for about half a minute.

### First time

```bash
cp deploy.env.example deploy.env          # DOMAINS starts with new + admin
cp .env.example .env.production           # POSTGRES_PASSWORD (openssl rand -hex 24), OPENAI_API_KEY, INDEXNOW_KEY, EMAIL_* (login codes)
```

1. **Cloudflare DNS:** add the A records `new` and `admin` → `187.124.189.127`, as **DNS only** (grey cloud).
2. Run `./deploy.sh --check`. It is read-only and shows what would happen.
3. Run `./deploy.sh`. It builds both images locally (linux/amd64), sends them to the server (no registry), deploys the stack and requests the certificate. Before the certificate request it checks with a probe file that every hostname reaches the VPS. The admin runs the database migrations on start. nginx is not touched yet.
4. Run `./deploy.sh --skip-build --nginx`. This puts our block in the shared nginx and reloads it.
5. Import the 7 old blogs (EN + NL) once and create your login:

   ```bash
   ADMIN=$(docker --context weggeefdeals ps -q -f name=feelgoodbrothers_fgb-admin | head -1)
   docker --context weggeefdeals exec $ADMIN node scripts/import-mdx.mjs
   docker --context weggeefdeals exec -it -e ADMIN_PASSWORD='a-long-password' $ADMIN node scripts/create-admin.mjs you@example.com "Mick"
   ```

6. **Test on https://new.feelgoodbrothers.com** (it is `noindex`): blogs, images, Disqus, old URLs. Then on admin.feelgoodbrothers.com: log in, upload a photo, use the writing assistant.

After that, every update is just `./deploy.sh`. It does a rolling update with no downtime.

### Switching the domain (from the current server)

1. **Move DNS to Cloudflare** (free plan): add the site and change the nameservers at the registrar. The records still point to the current server, so visitors notice nothing. Check that the MX (mail) records were imported.
2. **Point `@` and `www` to `187.124.189.127`** (DNS only for now).
3. **Request the bigger certificate.** In `deploy.env`, set `DOMAINS="feelgoodbrothers.com www.feelgoodbrothers.com new.feelgoodbrothers.com admin.feelgoodbrothers.com"` and run `./deploy.sh --skip-build`. nginx already knows these hostnames, and the new certificate is loaded with a reload.
4. **Turn on the Cloudflare proxy** (orange cloud) for `@`, `www` and `new`, with SSL mode **Full (strict)**. nginx serves `/.well-known/acme-challenge/` over HTTPS too, so renewals keep working behind the proxy.
5. **After a few quiet days:**
   - Keep the old hosting (67.209.118.202): the **mail** for feelgoodbrothers.com runs there (`mail`, `webmail`, `autodiscover`, MX). Those records stay "DNS only" and keep pointing to it. Only cancel it after moving the mail elsewhere.
   - Add the site in Google Search Console and Bing Webmaster Tools and submit `https://feelgoodbrothers.com/sitemap.xml`.
   - Point `new` to the apex, or remove it.

Optional in `.env.production`: `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_API_TOKEN` (cache purge on publish).

### Day-to-day

```bash
docker --context weggeefdeals stack services feelgoodbrothers
docker --context weggeefdeals service logs -f feelgoodbrothers_fgb-web
docker --context weggeefdeals service logs -f feelgoodbrothers_fgb-admin
docker --context weggeefdeals run --rm -v /opt/feelgoodbrothers/backups:/b alpine ls -lh /b   # daily db dump + uploads archive (last 14 kept)
```

Restore a database dump:

```bash
docker --context weggeefdeals exec -i $(docker --context weggeefdeals ps -q -f name=feelgoodbrothers_fgb-postgres) \
  pg_restore -U fgb -d feelgoodbrothers --clean < db-YYYYMMDD-HHMM.dump
```
