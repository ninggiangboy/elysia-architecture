CREATE TABLE "identity"."oauth_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oauth_accounts_provider_user_unique" UNIQUE("provider","provider_user_id"),
	CONSTRAINT "oauth_accounts_user_provider_unique" UNIQUE("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "identity"."oauth_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"provider" text NOT NULL,
	"code_verifier" text NOT NULL,
	"purpose" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "oauth_states_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."passkeys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint NOT NULL,
	"transports" text[] NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."step_up_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."webauthn_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"challenge" text NOT NULL,
	"purpose" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "identity"."oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."step_up_codes" ADD CONSTRAINT "step_up_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_states_expires_idx" ON "identity"."oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "identity"."passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "step_up_codes_user_created_idx" ON "identity"."step_up_codes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_expires_idx" ON "identity"."webauthn_challenges" USING btree ("expires_at");