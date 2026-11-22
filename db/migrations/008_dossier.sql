-- N° de dossier simple (DL-123456), unique, jamais réutilisé. Dossiers désactivés (jamais supprimés). Dents temporaires. Champs de la fiche.
alter table patients add column if not exists marital_status text, add column if not exists children_count int, add column if not exists emergency_phone text,
  add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid references users(id), add column if not exists delete_reason text;
create or replace function gen_file_number() returns text language plpgsql as $$
declare n text;
begin
  loop
    n := 'DL-' || (100000 + floor(random() * 900000))::int::text;
    exit when not exists (select 1 from patients where file_number = n);
  end loop;
  return n;
end $$;
-- Anciens numéros complexes (ex. DL-YRUNSH3X) : remplacés une seule fois par un numéro simple.
update patients set file_number = gen_file_number() where file_number !~ '^DL-[0-9]{6,7}$';
alter table patients alter column file_number set default gen_file_number();
create or replace function patients_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Un dossier patient ne peut pas être supprimé : désactivez-le (il reste conservé).'; end if;
  if new.file_number <> old.file_number then raise exception 'Le n° de dossier est définitif.'; end if;
  return new;
end $$;
drop trigger if exists t_pat_guard on patients;
create trigger t_pat_guard before update or delete on patients for each row execute function patients_guard();
-- Dents permanentes (11-48) et temporaires (51-55, 61-65, 71-75, 81-85)
alter table tooth_states drop constraint if exists tooth_states_tooth_fdi_check;
alter table tooth_states drop constraint if exists tooth_states_fdi_ok;
alter table tooth_states add constraint tooth_states_fdi_ok check (
  (tooth_fdi between 11 and 48 and tooth_fdi % 10 between 1 and 8 and tooth_fdi / 10 between 1 and 4) or
  (tooth_fdi between 51 and 85 and tooth_fdi % 10 between 1 and 5 and tooth_fdi / 10 between 5 and 8));
