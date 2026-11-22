-- Correction demandée par la clinique (17/11/2026) : les soins « Prophylaxie » et « Blanchiment » terminés le 17/11
-- ont été réalisés par le Dr Mak jean mais enregistrés au nom du propriétaire (liste « Réalisée par » par défaut).
-- Ciblage par identifiants exacts : sur toute autre base, cette migration ne modifie rien.
with fix as (
  update treatment_plan_items set doctor_id = 'eb3de5e6-1f8a-45c0-91f0-a3cc798c1190'
  where id in ('a7b4a312-5bbf-43f7-86e4-a25d3e97f75e', '383ee9c6-7c30-4da0-9f53-1494eeced018')
    and doctor_id = 'acd7ec1d-3bd6-4da8-b8bf-ef348e569e9f'
    and exists (select 1 from users where id = 'eb3de5e6-1f8a-45c0-91f0-a3cc798c1190')
  returning id)
insert into audit_logs(clinic_id, user_id, action, table_name, record_id, details)
select (select clinic_id from users where id = 'eb3de5e6-1f8a-45c0-91f0-a3cc798c1190'), null, 'REATTRIBUTED', 'treatment_plan_items', id::text,
  '{"from":"Propriétaire DENTAL","to":"Mak jean","reason":"Correction demandée par la clinique : soin réalisé par Mak jean"}'::jsonb from fix;
with fix as (
  update invoices set doctor_id = 'eb3de5e6-1f8a-45c0-91f0-a3cc798c1190'
  where plan_item_id in ('a7b4a312-5bbf-43f7-86e4-a25d3e97f75e', '383ee9c6-7c30-4da0-9f53-1494eeced018')
    and doctor_id = 'acd7ec1d-3bd6-4da8-b8bf-ef348e569e9f'
    and exists (select 1 from users where id = 'eb3de5e6-1f8a-45c0-91f0-a3cc798c1190')
  returning id, number)
insert into audit_logs(clinic_id, user_id, action, table_name, record_id, details)
select (select clinic_id from users where id = 'eb3de5e6-1f8a-45c0-91f0-a3cc798c1190'), null, 'REATTRIBUTED', 'invoices', id::text,
  jsonb_build_object('invoice', number, 'from', 'Propriétaire DENTAL', 'to', 'Mak jean', 'reason', 'Correction demandée par la clinique : soin réalisé par Mak jean') from fix;
