-- Un seul propriétaire principal par clinique (inchangé), plus au maximum UN compte propriétaire de secours.
drop index if exists one_owner;
create unique index if not exists one_owner on users(clinic_id) where role = 'OWNER' and not is_emergency;
create unique index if not exists one_emergency on users(clinic_id) where is_emergency;
