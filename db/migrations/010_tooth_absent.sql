-- Nouvel état de dent « absente » : dent non présente en bouche (jamais sortie, agénésie, perdue avant le suivi),
-- distinct de « extraite » (extraction réalisée).
alter table tooth_states drop constraint if exists tooth_states_state_check;
alter table tooth_states drop constraint if exists tooth_states_state_ok;
alter table tooth_states add constraint tooth_states_state_ok check (state in ('saine','carie','extraite','absente','a_extraire','restauree','couronne','implant','bridge','anomalie'));
