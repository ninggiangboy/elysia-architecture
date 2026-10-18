CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE TABLE "billing"."inbox" (
	"message_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_message_id_handler_pk" PRIMARY KEY("message_id","handler")
);
--> statement-breakpoint
CREATE TABLE "billing"."ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"type" text NOT NULL,
	"top_up_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."outbox_messages" (
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
CREATE TABLE "billing"."top_ups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" text NOT NULL,
	"payment_intent_id" text NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."wallet_balances" (
	"user_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallet_balances_user_id_currency_pk" PRIMARY KEY("user_id","currency")
);
--> statement-breakpoint
CREATE INDEX "ledger_entries_user_idx" ON "billing"."ledger_entries" USING btree ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_top_up_idx" ON "billing"."ledger_entries" USING btree ("top_up_id","type");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "billing"."outbox_messages" USING btree ("next_attempt_at") WHERE "billing"."outbox_messages"."published_at" is null and "billing"."outbox_messages"."dead_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "top_ups_payment_intent_idx" ON "billing"."top_ups" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "top_ups_user_idx" ON "billing"."top_ups" USING btree ("user_id","id" DESC NULLS LAST);