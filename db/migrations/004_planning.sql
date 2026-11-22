create sequence if not exists prosthesis_seq;
create table if not exists appointments(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), patient_id uuid not null references patients(id),
 doctor_id uuid not null references users(id), starts_at timestamptz not null, duration_min int not null check (duration_min between 5 and 480), reason text, chair text,
 status text not null default 'planned' check (status in ('planned','confirmed','cancelled','no_show','done')), created_by uuid references users(id), created_at timestamptz default now());
create index if not exists appt_idx on appointments(clinic_id, starts_at);
create table if not exists follow_up_reminders(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), patient_id uuid not null references patients(id),
 doctor_id uuid references users(id), kind text not null default 'controle', reason text, due_date date not null, status text not null default 'pending' check (status in ('pending','done','cancelled')),
 created_by uuid references users(id), done_at timestamptz, created_at timestamptz default now());
create index if not exists rem_idx on follow_up_reminders(clinic_id, status, due_date);
create table if not exists treatment_plans(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), patient_id uuid not null references patients(id),
 primary_doctor_id uuid references users(id), responsible_doctor_id uuid references users(id), diagnosis text, objective text, teeth int[], sessions int, start_date date, end_date date,
 status text not null default 'draft' check (status in ('draft','pending','approved','in_progress','suspended','done','cancelled')), notes text, created_by uuid references users(id), created_at timestamptz default now());
create table if not exists treatment_plan_items(id uuid primary key default gen_random_uuid(), plan_id uuid not null references treatment_plans(id), description text not null, tooth smallint,
 price numeric(14,2) not null check (price>=0), doctor_id uuid references users(id), status text not null default 'todo' check (status in ('todo','in_progress','done','cancelled')), done_at timestamptz);
alter table invoices add column if not exists plan_id uuid references treatment_plans(id);
create table if not exists prosthesis_types(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), name text not null, unique(clinic_id,name));
create table if not exists laboratories(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), name text not null, phone text, technician text);
create table if not exists prostheses(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), ref text not null, patient_id uuid not null references patients(id),
 primary_doctor_id uuid references users(id), doctor_id uuid not null references users(id), type_id uuid not null references prosthesis_types(id), teeth int[], material text, color text,
 lab_id uuid references laboratories(id), technician text, prescribed_at date default current_date, manufactured_at date, placed_at date,
 material_cost numeric(14,2) not null default 0 check (material_cost>=0), lab_cost numeric(14,2) not null default 0 check (lab_cost>=0), price numeric(14,2) not null default 0 check (price>=0),
 instructions text, step text not null default 'prescription' check (step in ('prescription','impression','preparation','sent_lab','manufacturing','returned','fitting','adjustment','ready','placed')),
 plan_id uuid references treatment_plans(id), created_by uuid references users(id), created_at timestamptz default now(), unique(clinic_id,ref));
create table if not exists prosthesis_steps(id uuid primary key default gen_random_uuid(), prosthesis_id uuid not null references prostheses(id), step text not null, note text, by_user uuid references users(id), at timestamptz default now());
drop trigger if exists t_ps on prosthesis_steps; create trigger t_ps before update or delete on prosthesis_steps for each row execute function forbid_mutation();
