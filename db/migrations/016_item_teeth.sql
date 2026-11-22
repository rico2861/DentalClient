-- Interventions des plans : plusieurs dents par intervention (la colonne « tooth » reste pour compatibilité = première dent)
alter table treatment_plan_items add column if not exists teeth smallint[] not null default '{}';
update treatment_plan_items set teeth = array[tooth] where tooth is not null and cardinality(teeth) = 0;
