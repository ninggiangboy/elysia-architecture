CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE TABLE "identity"."email_change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"new_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "email_change_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."magic_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"requested_ip" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "magic_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."outbox_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"headers" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"published_at" timestamp with time zone,
	"dead_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "identity"."refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"user_agent" text,
	"ip" text,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "identity"."email_change_requests" ADD CONSTRAINT "email_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "magic_links_email_created_idx" ON "identity"."magic_links" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "magic_links_ip_created_idx" ON "identity"."magic_links" USING btree ("requested_ip","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "identity"."outbox_messages" USING btree ("next_attempt_at") WHERE "identity"."outbox_messages"."published_at" is null and "identity"."outbox_messages"."dead_at" is null;--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "identity"."refresh_tokens" USING btree ("family_id");