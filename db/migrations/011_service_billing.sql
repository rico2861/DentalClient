-- Facturation automatique des actes et attribution au médecin qui a réalisé l'acte (base des commissions).
alter table invoices add column if not exists doctor_id uuid references users(id);
alter table invoices add column if not exists consultation_id uuid references consultations(id);
alter table invoices add column if not exists plan_item_id uuid references treatment_plan_items(id);
create index if not exists invoices_doctor_idx on invoices(doctor_id, created_at);
create index if not exists invoices_consult_idx on invoices(consultation_id);
-- un employé peut être relié à un compte utilisateur (médecin) : son taux de commission s'applique à ses actes
create unique index if not exists employees_user_uq on employees(user_id) where user_id is not null;
