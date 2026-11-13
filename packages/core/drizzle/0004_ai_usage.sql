CREATE TABLE "ai_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer,
	"post_id" integer,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
-- keep earlier usage: one row per existing session, dated at the session's creation
INSERT INTO "ai_usage" ("session_id", "post_id", "kind", "provider", "model", "input_tokens", "output_tokens", "created_at")
SELECT "id", "post_id", 'generate', "provider", "model", "input_tokens", "output_tokens", "created_at"
FROM "ai_sessions"
WHERE "input_tokens" > 0 OR "output_tokens" > 0;
