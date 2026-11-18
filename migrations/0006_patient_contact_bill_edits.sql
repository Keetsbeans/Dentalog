CREATE TABLE `invoice_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`reason` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_edits_invoice` ON `invoice_edits` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `visit_addenda` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `visit_addenda_visit` ON `visit_addenda` (`visit_id`);--> statement-breakpoint
ALTER TABLE `patients` ADD `phone_cc` text DEFAULT '91' NOT NULL;--> statement-breakpoint
ALTER TABLE `patients` ADD `email` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `email_confirmed_at` text;