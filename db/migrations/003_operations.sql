alter table patients add column if not exists primary_doctor_id uuid references users(id);
create table if not exists patient_doctor_history(id uuid primary key default gen_random_uuid(), patient_id uuid not null references patients(id),
 doctor_id uuid not null references users(id), started_at timestamptz default now(), ended_at timestamptz, changed_by uuid references users(id));
create table if not exists medical_histories(patient_id uuid primary key references patients(id), clinic_id uuid not null, data jsonb not null default '{}',
 updated_by uuid references users(id), updated_at timestamptz default now());
create table if not exists consultations(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), patient_id uuid not null references patients(id),
 doctor_id uuid not null references users(id), primary_doctor_id uuid references users(id), consulted_at timestamptz not null default now(),
 reason text, diagnosis text, treatment text, teeth int[], cost numeric(14,2) check (cost>=0), notes text, created_by uuid references users(id));
create index if not exists consult_idx on consultations(patient_id, consulted_at desc);
create table if not exists tooth_states(id uuid primary key default gen_random_uuid(), clinic_id uuid not null, patient_id uuid not null references patients(id),
 tooth_fdi smallint not null check (tooth_fdi between 11 and 48 and tooth_fdi%10 between 1 and 8 and tooth_fdi/10 between 1 and 4),
 state text not null check (state in ('saine','carie','extraite','a_extraire','restauree','couronne','implant','bridge','anomalie')), note text,
 doctor_id uuid not null references users(id), consultation_id uuid references consultations(id), recorded_at timestamptz default now());
create index if not exists teeth_idx on tooth_states(patient_id, tooth_fdi, recorded_at desc);
-- Stock
create table if not exists suppliers(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), name text not null, phone text, email text, address text);
create table if not exists products(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), ref text, name text not null, category text,
 unit text not null default 'unité', min_stock numeric(12,3) not null default 0, status text not null default 'active', unique(clinic_id,ref));
create table if not exists purchases(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), supplier_id uuid references suppliers(id),
 currency char(3) not null check (currency in ('HTG','USD')), rate_htg_per_usd numeric(18,6), total numeric(14,2) not null, total_htg numeric(14,2) not null,
 status text not null default 'ordered' check (status in ('ordered','received')), created_by uuid references users(id), created_at timestamptz default now(), received_at timestamptz);
create table if not exists purchase_items(id uuid primary key default gen_random_uuid(), purchase_id uuid not null references purchases(id), product_id uuid not null references products(id),
 qty numeric(12,3) not null check (qty>0), unit_price numeric(14,4) not null check (unit_price>=0), lot_number text, expiry date);
create table if not exists product_lots(id uuid primary key default gen_random_uuid(), clinic_id uuid not null, product_id uuid not null references products(id), lot_number text, expiry date,
 qty_received numeric(12,3) not null, qty_remaining numeric(12,3) not null check (qty_remaining>=0), unit_cost_htg numeric(14,4) not null, received_at timestamptz default now(), purchase_id uuid references purchases(id));
create index if not exists lots_fefo on product_lots(product_id, expiry nulls last) where qty_remaining>0;
create table if not exists stock_movements(id uuid primary key default gen_random_uuid(), clinic_id uuid not null, product_id uuid not null references products(id), lot_id uuid references product_lots(id),
 type text not null check (type in ('in','consume','adjust')), qty numeric(12,3) not null, unit_cost_htg numeric(14,4), patient_id uuid references patients(id),
 consultation_id uuid references consultations(id), doctor_id uuid references users(id), reason text, created_by uuid references users(id), created_at timestamptz default now());
-- Caisse & dépenses
create table if not exists cash_accounts(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), name text not null,
 currency char(3) not null check (currency in ('HTG','USD')), kind text not null default 'cash' check (kind in ('cash','bank')), opening_balance numeric(14,2) not null default 0,
 active boolean not null default true, created_at timestamptz default now());
create table if not exists cash_movements(id uuid primary key default gen_random_uuid(), clinic_id uuid not null, account_id uuid not null references cash_accounts(id),
 kind text not null check (kind in ('in','out','transfer_in','transfer_out')), amount numeric(14,2) not null check (amount>0), ref text not null, reason text,
 related_type text, related_id text, group_id uuid, created_by uuid references users(id), created_at timestamptz default now(), unique(clinic_id,ref));
create table if not exists cash_closures(id uuid primary key default gen_random_uuid(), clinic_id uuid not null, account_id uuid not null references cash_accounts(id), day date not null,
 theoretical numeric(14,2) not null, physical numeric(14,2) not null, diff numeric(14,2) not null, closed_by uuid references users(id), closed_at timestamptz default now(), unique(account_id,day));
create table if not exists expenses(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
 category text not null check (category in ('Salaires','Loyer','Électricité','Eau','Internet','Matériaux dentaires','Fournitures','Laboratoire','Maintenance','Transport','Marketing','Autres')),
 description text, amount numeric(14,2) not null check (amount>0), currency char(3) not null, rate_htg_per_usd numeric(18,6), amount_htg numeric(14,2) not null,
 status text not null default 'committed' check (status in ('committed','paid')), paid_at timestamptz, source_type text, source_id text, created_by uuid references users(id), created_at timestamptz default now());
create unique index if not exists expense_once on expenses(source_type, source_id) where source_type is not null;
create or replace function cash_post(p_clinic uuid, p_cur char, p_kind text, p_amount numeric, p_ref text, p_reason text, p_rtype text, p_rid text, p_user uuid) returns void
language plpgsql as $$ declare a uuid; begin
 select id into a from cash_accounts where clinic_id=p_clinic and currency=p_cur and kind='cash' and active order by created_at limit 1;
 if a is not null then insert into cash_movements(clinic_id,account_id,kind,amount,ref,reason,related_type,related_id,created_by) values(p_clinic,a,p_kind,p_amount,p_ref,p_reason,p_rtype,p_rid,p_user); end if; end $$;
do $$ declare t text; begin foreach t in array array['tooth_states','stock_movements','cash_movements','cash_closures'] loop
 execute format('drop trigger if exists t_imm on %I; create trigger t_imm before update or delete on %I for each row execute function forbid_mutation()', t, t); end loop; end $$;
drop trigger if exists t_consult_del on consultations; create trigger t_consult_del before delete on consultations for each row execute function forbid_mutation();
