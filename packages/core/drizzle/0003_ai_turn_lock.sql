ALTER TABLE "ai_sessions" ADD COLUMN "turn_lock" text;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD COLUMN "turn_started_at" timestamp with time zone;