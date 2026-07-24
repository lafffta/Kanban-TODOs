CREATE TABLE "board_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"role" text NOT NULL,
	"invited_by_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "board_invites" ADD CONSTRAINT "board_invites_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_invites" ADD CONSTRAINT "board_invites_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;