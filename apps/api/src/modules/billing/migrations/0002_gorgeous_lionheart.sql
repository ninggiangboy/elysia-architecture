CREATE TABLE "billing"."document_counters" (
	"kind" text NOT NULL,
	"year" integer NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "document_counters_kind_year_pk" PRIMARY KEY("kind","year")
);
--> statement-breakpoint
CREATE TABLE "billing"."documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"status" text NOT NULL,
	"top_up_id" uuid NOT NULL,
	"user_id" uuid,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"invoice_id" uuid,
	"reference" text,
	"seller" jsonb NOT NULL,
	"buyer" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "documents_amount_positive" CHECK ("billing"."documents"."amount" > 0),
	CONSTRAINT "documents_kind_known" CHECK ("billing"."documents"."kind" in ('invoice', 'receipt', 'credit_note')),
	CONSTRAINT "documents_status_known" CHECK ("billing"."documents"."status" in ('open', 'paid', 'void', 'issued'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "documents_number_idx" ON "billing"."documents" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_top_up_idx" ON "billing"."documents" USING btree ("top_up_id","kind") WHERE "billing"."documents"."kind" in ('invoice', 'receipt');--> statement-breakpoint
CREATE UNIQUE INDEX "documents_reference_idx" ON "billing"."documents" USING btree ("kind","reference") WHERE "billing"."documents"."reference" is not null;--> statement-breakpoint
CREATE INDEX "documents_user_idx" ON "billing"."documents" USING btree ("user_id","id" DESC NULLS LAST);