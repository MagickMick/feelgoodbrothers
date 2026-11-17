ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "audio_key" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "audio_duration_sec" integer;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "audio_voice" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "audio_text_hash" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "audio_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "audio_busy_since" timestamp with time zone;