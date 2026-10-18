CREATE TABLE "billing"."payment_anomalies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payment_intent_id" text NOT NULL,
	"top_up_id" uuid,
	"event_id" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing"."payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"result" text NOT NULL,
	"deliveries" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "billing"."ledger_entries_top_up_idx";--> statement-breakpoint
ALTER TABLE "billing"."ledger_entries" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "billing"."top_ups" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "billing"."top_ups" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_anomalies_kind_idx" ON "billing"."payment_anomalies" USING btree ("payment_intent_id","kind");--> statement-breakpoint
CREATE INDEX "payment_events_intent_idx" ON "billing"."payment_events" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_reference_idx" ON "billing"."ledger_entries" USING btree ("type","reference") WHERE "billing"."ledger_entries"."reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "top_ups_idempotency_idx" ON "billing"."top_ups" USING btree ("user_id","idempotency_key") WHERE "billing"."top_ups"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "top_ups_unsettled_idx" ON "billing"."top_ups" USING btree ("created_at") WHERE "billing"."top_ups"."status" in ('pending', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_top_up_idx" ON "billing"."ledger_entries" USING btree ("top_up_id","type") WHERE "billing"."ledger_entries"."type" = 'topup';--> statement-breakpoint
ALTER TABLE "billing"."ledger_entries" ADD CONSTRAINT "ledger_entries_amount_nonzero" CHECK ("billing"."ledger_entries"."amount" <> 0);--> statement-breakpoint
ALTER TABLE "billing"."ledger_entries" ADD CONSTRAINT "ledger_entries_type_known" CHECK ("billing"."ledger_entries"."type" in ('topup', 'refund', 'chargeback', 'chargeback_reversal'));--> statement-breakpoint
ALTER TABLE "billing"."top_ups" ADD CONSTRAINT "top_ups_amount_positive" CHECK ("billing"."top_ups"."amount" > 0);--> statement-breakpoint
ALTER TABLE "billing"."top_ups" ADD CONSTRAINT "top_ups_status_known" CHECK ("billing"."top_ups"."status" in ('pending', 'succeeded', 'failed', 'canceled'));