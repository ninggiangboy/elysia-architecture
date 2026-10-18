CREATE SCHEMA "privacy";
--> statement-breakpoint
CREATE TABLE "privacy"."account_deletions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	"nudges" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy"."deletion_steps" (
	"deletion_id" uuid NOT NULL,
	"module" text NOT NULL,
	"confirmed" boolean NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "deletion_steps_deletion_id_module_pk" PRIMARY KEY("deletion_id","module")
);
--> statement-breakpoint
CREATE TABLE "privacy"."export_parts" (
	"export_id" uuid NOT NULL,
	"module" text NOT NULL,
	"done" boolean NOT NULL,
	"key" text,
	"size" bigint DEFAULT 0 NOT NULL,
	"files" jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "export_parts_export_id_module_pk" PRIMARY KEY("export_id","module")
);
--> statement-breakpoint
CREATE TABLE "privacy"."export_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"archive_key" text,
	"archive_size" bigint,
	"failure_reason" text,
	"nudges" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy"."inbox" (
	"message_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_message_id_handler_pk" PRIMARY KEY("message_id","handler")
);
--> statement-breakpoint
CREATE TABLE "privacy"."outbox_messages" (
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
ALTER TABLE "privacy"."deletion_steps" ADD CONSTRAINT "deletion_steps_deletion_id_account_deletions_id_fk" FOREIGN KEY ("deletion_id") REFERENCES "privacy"."account_deletions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy"."export_parts" ADD CONSTRAINT "export_parts_export_id_export_requests_id_fk" FOREIGN KEY ("export_id") REFERENCES "privacy"."export_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_deletions_user_idx" ON "privacy"."account_deletions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletions_one_active_idx" ON "privacy"."account_deletions" USING btree ("user_id") WHERE "privacy"."account_deletions"."status" in ('scheduled', 'running', 'stalled');--> statement-breakpoint
CREATE INDEX "account_deletions_due_idx" ON "privacy"."account_deletions" USING btree ("scheduled_for") WHERE "privacy"."account_deletions"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "account_deletions_running_idx" ON "privacy"."account_deletions" USING btree ("updated_at") WHERE "privacy"."account_deletions"."status" = 'running';--> statement-breakpoint
CREATE INDEX "export_requests_user_idx" ON "privacy"."export_requests" USING btree ("user_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "export_requests_one_active_idx" ON "privacy"."export_requests" USING btree ("user_id") WHERE "privacy"."export_requests"."status" in ('collecting', 'assembling');--> statement-breakpoint
CREATE INDEX "export_requests_active_idx" ON "privacy"."export_requests" USING btree ("updated_at") WHERE "privacy"."export_requests"."status" in ('collecting', 'assembling');--> statement-breakpoint
CREATE INDEX "export_requests_expiry_idx" ON "privacy"."export_requests" USING btree ("expires_at") WHERE "privacy"."export_requests"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "privacy"."outbox_messages" USING btree ("next_attempt_at") WHERE "privacy"."outbox_messages"."published_at" is null and "privacy"."outbox_messages"."dead_at" is null;