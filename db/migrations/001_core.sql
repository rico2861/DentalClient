create sequence if not exists patient_file_seq;
create table if not exists clinics(id uuid primary key default gen_random_uuid(), name text not null, address text, phone text,
 primary_currency char(3) default 'HTG', secondary_currency char(3) default 'USD', timezone text default 'America/Port-au-Prince',
 active_patient_months int not null default 12, created_at timestamptz default now());
create table if not exists users(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
 matricule text, email text not null unique, password_hash text not null, first_name text not null, last_name text not null,
 phone text, job_title text, role text not null check (role in ('OWNER','ADMIN','ADMIN_MEDICAL','ADMIN_FINANCIER','DENTIST','DENTAL_ASSISTANT','SECRETARY','ACCOUNTANT','STOCK_MANAGER','DENTAL_TECH','STAFF')),
 status text not null default 'active' check (status in ('active','blocked','disabled')),
 must_change_password boolean not null default true, token_version int not null default 0,
 failed_attempts int not null default 0, locked_until timestamptz,
 created_by uuid references users(id), last_login_at timestamptz, created_at timestamptz default now());
create unique index if not exists one_owner on users(clinic_id) where role='OWNER';
create table if not exists user_permissions(user_id uuid references users(id) on delete cascade, perm text not null,
 granted boolean not null default true, can_delegate boolean not null default false, granted_by uuid references users(id),
 granted_at timestamptz default now(), primary key(user_id, perm));
create table if not exists exchange_rates(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
 rate numeric(18,6) not null check (rate>0), effective_at timestamptz not null default now(), justification text,
 created_by uuid not null references users(id), created_at timestamptz default now());
create index if not exists rates_idx on exchange_rates(clinic_id, effective_at desc);
create table if not exists audit_logs(id bigserial primary key, clinic_id uuid, user_id uuid, action text not null, table_name text,
 record_id text, details jsonb, ip inet, created_at timestamptz default now());
create index if not exists audit_idx on audit_logs(clinic_id, created_at desc);
create table if not exists patients(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
 file_number text not null default ('DL-'||lpad(nextval('patient_file_seq')::text,6,'0')), last_name text not null, first_name text not null,
 birth_date date, sex text check (sex in ('M','F')), phone text, phone2 text, address text, department text, zone text, profession text,
 emergency_contact text, status text not null default 'active' check (status in ('active','archived')),
 registered_at date not null default current_date, created_by uuid references users(id), created_at timestamptz default now(),
 unique(clinic_id,file_number));
create index if not exists pat_name on patients(clinic_id,last_name,first_name);
create index if not exists pat_phone on patients(clinic_id,phone);
create or replace function forbid_mutation() returns trigger language plpgsql as $$ begin raise exception 'Historique immuable : %', tg_table_name; end $$;
drop trigger if exists t_audit on audit_logs; create trigger t_audit before update or delete on audit_logs for each row execute function forbid_mutation();
drop trigger if exists t_rates on exchange_rates; create trigger t_rates before update or delete on exchange_rates for each row execute function forbid_mutation();
