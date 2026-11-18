ALTER TABLE `appointments` ADD `confirm_token` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `confirmed_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `reschedule_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_confirm_token` ON `appointments` (`confirm_token`);--> statement-breakpoint
ALTER TABLE `messages` ADD `direction` text DEFAULT 'out' NOT NULL;