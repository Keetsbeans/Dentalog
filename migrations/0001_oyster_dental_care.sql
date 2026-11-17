-- The clinic, and numbering that carries on from the old software.
INSERT INTO clinics (id, name, doctor_name, qualification, phone, address, website, hours_json)
VALUES (
  'oyster', 'Oyster Dental Care', 'Dr Soosi Christopher', 'BDS',
  '+91 82402 00748 · +91 88072 68748',
  'AL-49, Shanti Colony, Anna Nagar, Chennai 600 040',
  'www.oysterdentalcare.com',
  '{"mon":["15:30","20:30"],"tue":["15:30","20:30"],"wed":["15:30","20:30"],"thu":["15:30","20:30"],"fri":["15:30","20:30"],"sat":["15:30","20:30"],"sun":null}'
);
--> statement-breakpoint
INSERT INTO counters (clinic_id, series, next) VALUES
  ('oyster', 'patient', 963),
  ('oyster', 'file', 1986),
  ('oyster', 'invoice', 29),
  ('oyster', 'receipt', 27),
  ('oyster', 'lab', 105);
