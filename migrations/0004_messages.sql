CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text,
	`body` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_ref` ON `messages` (`clinic_id`,`kind`,`ref_id`);