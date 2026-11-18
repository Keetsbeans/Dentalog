CREATE TABLE `teeth` (
	`clinic_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`tooth` integer NOT NULL,
	`condition` text DEFAULT 'Healthy' NOT NULL,
	`plan` text,
	`done` integer DEFAULT 0 NOT NULL,
	`billed` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teeth_patient_tooth` ON `teeth` (`patient_id`,`tooth`);--> statement-breakpoint
CREATE TABLE `tooth_events` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`tooth` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tooth_events_patient` ON `tooth_events` (`patient_id`);