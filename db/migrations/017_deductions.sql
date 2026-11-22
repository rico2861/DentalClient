-- Retenues sur salaire (impôt, ONA, assurance, prêt, autres) : définies par employé, appliquées automatiquement à la paie
create table if not exists employee_deductions(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
  employee_id uuid not null references employees(id), label text not null, kind text not null check (kind in ('pct','fixed')), value numeric(14,2) not null check (value >= 0),
  active boolean not null default true, created_by uuid references users(id), created_at timestamptz default now());
create index if not exists employee_deductions_emp on employee_deductions(employee_id) where active;
-- Détail des retenues sur chaque fiche de paie ; « autres déductions » = montant saisi à la main (conservé)
alter table payroll_records add column if not exists deduction_details jsonb not null default '[]'::jsonb;
alter table payroll_records add column if not exists other_deductions numeric(14,2) not null default 0;
update payroll_records set other_deductions = deductions where other_deductions = 0 and deductions > 0 and deduction_details = '[]'::jsonb;
