-- Factures verrouillées : toute correction autorisée est conservée (anciennes et nouvelles valeurs, auteur, date, motif).
create table if not exists invoice_revisions(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
 invoice_id uuid not null references invoices(id), changed_by uuid not null references users(id), changed_at timestamptz not null default now(),
 reason text not null, before jsonb not null, after jsonb not null);
create index if not exists invoice_revisions_idx on invoice_revisions(invoice_id, changed_at);
-- Paiements des commissions des médecins (versés directement, hors fiche de paie)
create table if not exists commission_payments(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
 doctor_id uuid not null references users(id), period char(7) not null check (period ~ '^\d{4}-\d{2}$'), amount numeric(14,2) not null check (amount > 0),
 method text not null, note text, paid_by uuid not null references users(id), created_at timestamptz not null default now());
create index if not exists commission_payments_idx on commission_payments(clinic_id, doctor_id, period);
