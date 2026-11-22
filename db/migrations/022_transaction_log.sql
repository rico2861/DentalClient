-- Journal des transactions (équivalent du « transaction log » de SQL Server) :
-- chaque création, modification ou suppression est enregistrée avec son heure exacte et un numéro d'ordre (LSN).
-- Il permet la sauvegarde du journal (toutes les 15 min) et la restauration à un instant précis (PITR).
-- Les déclencheurs sont posés au démarrage sur toutes les tables métier (voir backend/src/lib/backup-plus.js).
create table if not exists dl_changelog(
  lsn  bigserial primary key,
  at   timestamptz not null default clock_timestamp(),
  tbl  text not null,
  op   char(1) not null check (op in ('I', 'U', 'D')),
  row  jsonb not null
);
create index if not exists dl_changelog_at on dl_changelog(at);

create or replace function dl_log() returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    insert into dl_changelog(tbl, op, row) values (TG_TABLE_NAME, 'D', to_jsonb(OLD)); return OLD;
  elsif TG_OP = 'UPDATE' then
    if to_jsonb(NEW) is distinct from to_jsonb(OLD) then insert into dl_changelog(tbl, op, row) values (TG_TABLE_NAME, 'U', to_jsonb(NEW)); end if; return NEW;
  else
    insert into dl_changelog(tbl, op, row) values (TG_TABLE_NAME, 'I', to_jsonb(NEW)); return NEW;
  end if;
end $$;
