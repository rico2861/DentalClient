create sequence if not exists invoice_seq; create sequence if not exists proforma_seq; create sequence if not exists receipt_seq;
create table if not exists invoices(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
 kind text not null check (kind in ('invoice','proforma')), number text not null, patient_id uuid not null references patients(id),
 currency char(3) not null check (currency in ('HTG','USD')), rate_htg_per_usd numeric(18,6),  -- taux figé à la création
 subtotal numeric(14,2) not null, discount numeric(14,2) not null default 0, total numeric(14,2) not null check (total>=0),
 status text not null default 'issued' check (status in ('issued','cancelled','converted')), notes text,
 created_by uuid not null references users(id), created_at timestamptz default now(), unique(clinic_id,number));
create table if not exists invoice_items(id uuid primary key default gen_random_uuid(), invoice_id uuid not null references invoices(id),
 description text not null, qty numeric(12,4) not null check (qty>0), unit_price numeric(14,2) not null check (unit_price>=0), line_total numeric(14,2) not null);
create table if not exists payments(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
 invoice_id uuid not null references invoices(id), receipt_number text not null, amount numeric(14,2) not null check (amount>0), currency char(3) not null,
 rate_htg_per_usd numeric(18,6), applied_amount numeric(14,2) not null, amount_htg numeric(14,2) not null, method text not null,
 idempotency_key text not null, created_by uuid not null references users(id), created_at timestamptz default now(),
 voided_at timestamptz, void_reason text, unique(clinic_id,idempotency_key), unique(clinic_id,receipt_number));
create table if not exists employees(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
 user_id uuid references users(id), matricule text, first_name text not null, last_name text not null, job_title text, hire_date date,
 contract_type text, pay_mode text not null default 'monthly', base_salary numeric(14,2) not null default 0 check (base_salary>=0),
 commission_pct numeric(5,2) default 0, status text not null default 'active' check (status in ('active','inactive')), created_at timestamptz default now());
create table if not exists payroll_records(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
 employee_id uuid not null references employees(id), period char(7) not null check (period ~ '^\d{4}-\d{2}$'),
 base numeric(14,2) not null, commissions numeric(14,2) not null default 0, bonuses numeric(14,2) not null default 0,
 deductions numeric(14,2) not null default 0, advances numeric(14,2) not null default 0, net numeric(14,2) not null,
 paid numeric(14,2) not null default 0, status text not null default 'to_pay' check (status in ('to_pay','partial','paid')),
 unique(employee_id,period), check (paid<=net));
create table if not exists payroll_payments(id uuid primary key default gen_random_uuid(), payroll_id uuid not null references payroll_records(id),
 amount numeric(14,2) not null check (amount>0), method text not null, paid_at timestamptz default now(), created_by uuid not null references users(id));
drop trigger if exists t_pay_del on payments; create trigger t_pay_del before delete on payments for each row execute function forbid_mutation();
drop trigger if exists t_inv_del on invoices; create trigger t_inv_del before delete on invoices for each row execute function forbid_mutation();
