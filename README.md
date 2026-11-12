# Feelgood Brothers

Mental-health blog in English (`/`) and Dutch (`/nl/`), with an admin at `admin.feelgoodbrothers.com`.
Everything runs in Docker on its own VPS (Docker Swarm, stack `feelgoodbrothers`).

```
apps/web/        public site: Astro SSR (Node), renders posts from Postgres
apps/admin/      admin: Astro + React, login, posts / authors / categories / media / redirects
packages/core/   shared: Drizzle schema + migrations, queries, image storage, markdown, auth
nginx/           reverse proxy config (TLS, micro-cache, /media, Cloudflare real IP)
docker-stack.yml production stack (nginx, certbot, web, admin, postgres, daily backup)
```

## How it works

- **Posts live in Postgres**, not in files. Publishing or scheduling in the admin is live immediately, with no rebuild.
- **Scheduling needs no cron**: a post is live when `status != 'draft' AND publish_at <= now()`.
- **EN and NL versions** of a story share a `translation_group`. That drives the language switcher, `hreflang` tags and the sitemap.
- **Images** are uploaded in the admin. They are converted once to WebP (480–2000px) plus a 1200×630 OG image, stored in `/opt/feelgoodbrothers/uploads` and served by nginx at `/media/…` with a one-year cache.
- **Guest stories** are posts with `kind = 'guest'`. The only public detail is `guest_name`, a first name or pseudonym. Email, consent date and note are internal and stripped from every public query. Guest stories have no author profile. They are listed between all other blogs and under their categories, with no separate section, and carry a "Guest story" / "Gastblog" badge plus "by <name>". Authors are only the Feelgood Brothers team.
- **Writing assistant** (admin → ✨ Schrijfhulp): pick a category and a recognisable situation (list per category, editable under Situaties, or "random" which picks the least used one). The AI streams a first-person **draft** in the style of the team's own posts, which are sent along as voice samples. You can revise it by chatting, then save it as a post draft. Drafts may contain `[[…]]` placeholders where a real personal detail belongs; publishing is blocked until they are gone,. Providers are OpenAI and Claude behind one layer (`packages/core/src/ai/`), with "mock" for testing without a key. The editor can also create the other-language version with "Vertaal met AI". Token usage is stored per session in `ai_sessions`.
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

## Production (VPS)

One-time setup:

```bash
cp deploy.env.example deploy.env      # VPS_HOST, SSH_KEY, LETSENCRYPT_EMAIL
./setup-vps.sh                        # docker, swarm, firewall, /opt/feelgoodbrothers, .env, docker context
./deploy.sh                           # build (linux/amd64), push to Docker Hub, docker stack deploy
./init-letsencrypt.sh admin.feelgoodbrothers.com new.feelgoodbrothers.com
docker --context feelgoodbrothers exec -it $(docker --context feelgoodbrothers ps -q -f name=feelgoodbrothers_admin) node scripts/import-mdx.mjs
docker --context feelgoodbrothers exec -it $(docker --context feelgoodbrothers ps -q -f name=feelgoodbrothers_admin) node scripts/create-admin.mjs you@example.com "Mick"
```

Every deploy after that is `./deploy.sh`. It does a rolling update with no downtime and needs no `stack rm`.

### Switching from Netlify without downtime

1. Move DNS to Cloudflare (free plan): add the site and change the nameservers at the registrar. Records still point to Netlify, so visitors notice nothing. Check that the MX (mail) records were imported.
2. Point `admin` and `new` to the VPS. Test everything on `https://new.feelgoodbrothers.com` (it is `noindex`).
3. Point `@` and `www` to the VPS, then run `./init-letsencrypt.sh feelgoodbrothers.com www.feelgoodbrothers.com admin.feelgoodbrothers.com new.feelgoodbrothers.com`.
4. Cloudflare: SSL mode **Full (strict)**, proxy on (orange cloud) for `@`, `www` and `new`. Do not turn on "Always use HTTPS", because nginx already redirects and certbot renewals need plain HTTP for `/.well-known/acme-challenge/`.
5. After a few quiet days, delete the Netlify site. Add the site in Google Search Console and Bing Webmaster Tools and submit `https://feelgoodbrothers.com/sitemap.xml`.

Optional in `/opt/feelgoodbrothers/.env`: `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_API_TOKEN` (cache purge on publish) and `INDEXNOW_KEY` (generated by setup-vps.sh).

### Day-to-day

```bash
docker --context feelgoodbrothers stack services feelgoodbrothers
docker --context feelgoodbrothers service logs -f feelgoodbrothers_web
ssh root@VPS ls /opt/feelgoodbrothers/backups     # daily db dump + uploads archive (last 14 kept)
```

Restore a database dump:

```bash
docker exec -i <postgres container> pg_restore -U fgb -d feelgoodbrothers --clean < db-YYYYMMDD-HHMM.dump
```
