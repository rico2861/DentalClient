-- Catalogue : code de prestation ; radiographie enregistrée mais INACTIVE (aucun tarif défini, non opérationnelle).
alter table tariffs add column if not exists code text;
insert into tariffs(clinic_id,name,category,price,currency,sort,active,note)
select c.id,'Radiographie','Imagerie',null,'HTG',80,false,'Non opérationnelle : tarif et fonctionnement à confirmer par la clinique'
from clinics c where exists (select 1 from tariffs t where t.clinic_id=c.id) and not exists (select 1 from tariffs t where t.clinic_id=c.id and lower(t.name)='radiographie');
-- Paiements : référence de transaction (MonCash, virement…)
alter table payments add column if not exists reference text;
-- Factures : traçabilité de l'annulation
alter table invoices add column if not exists cancel_reason text, add column if not exists cancelled_by uuid references users(id), add column if not exists cancelled_at timestamptz;
-- Commissions : base de calcul choisie par l'administrateur (montants encaissés ou facturés)
alter table clinics add column if not exists commission_basis text not null default 'collected';
alter table clinics drop constraint if exists clinics_commission_basis_ok;
alter table clinics add constraint clinics_commission_basis_ok check (commission_basis in ('collected','billed'));
-- Patient : fiche complète
alter table patients add column if not exists email text, add column if not exists id_number text, add column if not exists birth_place text,
  add column if not exists insurance text, add column if not exists insurance_number text, add column if not exists referred_by text, add column if not exists notes text;
