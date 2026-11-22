-- Caisse & dépenses avec des données réelles :
-- 1. chaque paiement va dans le bon compte selon le mode : espèces → caisse ; MonCash / NatCash → compte du même nom ;
--    virement, carte, chèque → banque. Les comptes manquants sont créés automatiquement (avant : paiement ignoré s'il n'y avait pas de caisse).
-- 2. l'annulation d'un paiement ressort du compte où il était entré.
-- 3. rattrapage : les paiements, annulations et dépenses payées jamais passés en caisse y sont inscrits à leur date réelle.
create or replace function cash_account_for(p_clinic uuid, p_cur char, p_method text) returns uuid language plpgsql as $$
declare
  k text := case when p_method is null or p_method in ('espèces', 'Autre', '') then 'cash' else 'bank' end;
  n text := case when p_method in ('MonCash', 'NatCash') then p_method || ' ' || p_cur when k = 'cash' then 'Caisse principale ' || p_cur else 'Banque ' || p_cur end;
  a uuid;
begin
  if k = 'cash' then
    select id into a from cash_accounts where clinic_id = p_clinic and currency = p_cur and kind = 'cash' and active order by created_at limit 1;
  elsif p_method in ('MonCash', 'NatCash') then
    select id into a from cash_accounts where clinic_id = p_clinic and currency = p_cur and active and name ilike p_method || '%' order by created_at limit 1;
  else
    select id into a from cash_accounts where clinic_id = p_clinic and currency = p_cur and kind = 'bank' and active and name not ilike 'moncash%' and name not ilike 'natcash%' order by created_at limit 1;
  end if;
  if a is null then insert into cash_accounts(clinic_id, name, currency, kind) values (p_clinic, n, p_cur, k) returning id into a; end if;
  return a;
end $$;

-- sorties et entrées internes (dépenses, salaires, laboratoire, achats…) : caisse de la devise, créée si besoin
create or replace function cash_post(p_clinic uuid, p_cur char, p_kind text, p_amount numeric, p_ref text, p_reason text, p_rtype text, p_rid text, p_user uuid) returns void
language plpgsql as $$ begin
  insert into cash_movements(clinic_id, account_id, kind, amount, ref, reason, related_type, related_id, created_by)
  values (p_clinic, cash_account_for(p_clinic, p_cur, 'espèces'), p_kind, p_amount, p_ref, p_reason, p_rtype, p_rid, p_user);
end $$;

-- encaissement d'un paiement : compte choisi selon le mode de paiement
create or replace function cash_post_m(p_clinic uuid, p_cur char, p_kind text, p_amount numeric, p_ref text, p_reason text, p_rtype text, p_rid text, p_user uuid, p_method text) returns void
language plpgsql as $$ begin
  insert into cash_movements(clinic_id, account_id, kind, amount, ref, reason, related_type, related_id, created_by)
  values (p_clinic, cash_account_for(p_clinic, p_cur, p_method), p_kind, p_amount, p_ref, p_reason, p_rtype, p_rid, p_user);
end $$;

-- annulation d'un paiement : sortie du compte où il était entré
create or replace function cash_void(p_clinic uuid, p_pay uuid, p_ref text, p_reason text, p_user uuid) returns void
language plpgsql as $$ declare m record; p record; begin
  select account_id, amount into m from cash_movements where clinic_id = p_clinic and related_type = 'payment' and related_id = p_pay::text order by created_at limit 1;
  if m.account_id is null then
    select currency, amount, method into p from payments where id = p_pay;
    insert into cash_movements(clinic_id, account_id, kind, amount, ref, reason, related_type, related_id, created_by)
    values (p_clinic, cash_account_for(p_clinic, p.currency, p.method), 'out', p.amount, p_ref, p_reason, 'payment_void', p_pay::text, p_user);
  else
    insert into cash_movements(clinic_id, account_id, kind, amount, ref, reason, related_type, related_id, created_by)
    values (p_clinic, m.account_id, 'out', m.amount, p_ref, p_reason, 'payment_void', p_pay::text, p_user);
  end if;
end $$;

-- rattrapage des paiements jamais passés en caisse (à leur date réelle)
insert into cash_movements(clinic_id, account_id, kind, amount, ref, reason, related_type, related_id, created_by, created_at)
select p.clinic_id, cash_account_for(p.clinic_id, p.currency, p.method), 'in', p.amount, 'RAT-' || p.receipt_number, 'Paiement ' || i.number || ' (rattrapage caisse)', 'payment', p.id::text, p.created_by, p.created_at
from payments p join invoices i on i.id = p.invoice_id
where not exists (select 1 from cash_movements m where m.related_type = 'payment' and m.related_id = p.id::text)
on conflict do nothing;

insert into cash_movements(clinic_id, account_id, kind, amount, ref, reason, related_type, related_id, created_by, created_at)
select p.clinic_id, m.account_id, 'out', m.amount, 'RAT-VOID-' || p.receipt_number, 'Annulation ' || p.receipt_number || ' (rattrapage caisse)', 'payment_void', p.id::text, p.created_by, p.voided_at
from payments p join cash_movements m on m.related_type = 'payment' and m.related_id = p.id::text
where p.voided_at is not null and not exists (select 1 from cash_movements v where v.related_type = 'payment_void' and v.related_id = p.id::text)
on conflict do nothing;

-- dépenses payées jamais sorties de caisse
insert into cash_movements(clinic_id, account_id, kind, amount, ref, reason, related_type, related_id, created_by, created_at)
select e.clinic_id, cash_account_for(e.clinic_id, e.currency, 'espèces'), 'out', e.amount, 'RAT-DEP-' || left(e.id::text, 8), e.category || ' (rattrapage caisse)', 'expense', e.id::text, e.created_by, coalesce(e.paid_at, e.created_at)
from expenses e
where e.status = 'paid' and not exists (select 1 from cash_movements m where m.related_type = 'expense' and m.related_id = e.id::text)
on conflict do nothing;
