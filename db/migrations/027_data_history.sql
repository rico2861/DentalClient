-- Historique des modifications : chaque modification ou suppression d'une donnée sensible laisse une trace IMMUABLE
-- (ancienne valeur → nouvelle valeur, auteur, poste, motif). Posé au niveau de la base : même une modification faite
-- hors de l'application (accès direct à la base) est enregistrée, avec l'auteur « hors application ».
create table if not exists data_history(
  id bigserial primary key,
  at timestamptz not null default now(),
  clinic_id uuid,
  tbl text not null,
  row_id text,
  op text not null,                 -- UPDATE ou DELETE
  patient_id uuid,
  changes jsonb not null,           -- { colonne: [avant, après] } ; DELETE : { _supprime: ligne complète }
  actor_id uuid,
  actor text,
  ip text,
  reason text);
create index if not exists data_history_at on data_history(at desc);
create index if not exists data_history_row on data_history(tbl, row_id);
create index if not exists data_history_patient on data_history(patient_id, at desc);
drop trigger if exists t_hist_imm on data_history;
create trigger t_hist_imm before update or delete on data_history for each row execute function forbid_mutation();

create or replace function dl_history() returns trigger language plpgsql as $$
declare
  o jsonb := to_jsonb(OLD);
  n jsonb := case when TG_OP = 'UPDATE' then to_jsonb(NEW) else null end;
  r jsonb := coalesce(n, o);
  ch jsonb := '{}'::jsonb; k text; a jsonb; raw text;
  ign text[] := array['updated_at','last_seen','last_login_at','failed_attempts','locked_until','token_version'];
  hid text[] := array['password_hash','totp_secret','totp_secret_enc'];
begin
  if TG_OP = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if not (k = any(ign)) and (o -> k) is distinct from (n -> k) then
        ch := ch || jsonb_build_object(k, case when k = any(hid) then '["•••","••• (modifié)"]'::jsonb else jsonb_build_array(o -> k, n -> k) end);
      end if;
    end loop;
    if ch = '{}'::jsonb then return NEW; end if;
  else
    for k in select unnest(hid) loop o := o - k; end loop;
    ch := jsonb_build_object('_supprime', o);
  end if;
  raw := nullif(current_setting('dl.actor', true), '');
  begin a := raw::jsonb; exception when others then a := null; end;
  insert into data_history(clinic_id, tbl, row_id, op, patient_id, changes, actor_id, actor, ip, reason)
  values (nullif(r ->> 'clinic_id', '')::uuid, TG_TABLE_NAME, coalesce(r ->> 'id', r ->> 'patient_id'), TG_OP,
          case when TG_TABLE_NAME = 'patients' then (r ->> 'id')::uuid else nullif(r ->> 'patient_id', '')::uuid end,
          ch, nullif(a ->> 'id', '')::uuid, coalesce(a ->> 'n', 'Hors application (accès direct à la base)'), a ->> 'ip', nullif(a ->> 'r', ''));
  return coalesce(NEW, OLD);
end $$;

do $$ declare t text; begin
  foreach t in array array['patients','medical_histories','dental_examinations','patient_hygiene','consultations','treatment_plans','treatment_plan_items',
    'appointments','invoices','invoice_items','payments','expenses','tariffs','users','user_permissions','employees','employee_deductions','payroll_records',
    'prostheses','documents','clinics','cash_accounts','exchange_rates','products'] loop
    if to_regclass(t) is not null then
      execute format('drop trigger if exists t_history on %I; create trigger t_history after update or delete on %I for each row execute function dl_history()', t, t);
    end if;
  end loop; end $$;
