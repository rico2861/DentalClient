-- Performances : index manquants sur les liens entre tables et les colonnes de date.
-- Mesuré sur 3 ans d'activité (5 000 patients, 30 000 factures, 25 000 paiements) : le tableau de bord de la direction
-- passait 150 s (toute la plateforme bloquée, la base n'ayant qu'une connexion) faute d'index sur payments(invoice_id).
create index if not exists payments_invoice on payments(invoice_id) where voided_at is null;
create index if not exists payments_clinic_date on payments(clinic_id, created_at);
create index if not exists invoice_items_invoice on invoice_items(invoice_id);
create index if not exists invoices_patient on invoices(patient_id);
create index if not exists invoices_clinic_date on invoices(clinic_id, created_at);
create index if not exists invoices_open on invoices(clinic_id, kind, status);
create index if not exists invoices_plan on invoices(plan_id) where plan_id is not null;
create index if not exists invoices_plan_item on invoices(plan_item_id) where plan_item_id is not null;
create index if not exists consultations_clinic_date on consultations(clinic_id, consulted_at);
create index if not exists consultations_doctor_date on consultations(doctor_id, consulted_at);
create index if not exists appointments_patient on appointments(patient_id, starts_at);
create index if not exists appointments_doctor on appointments(doctor_id, starts_at);
create index if not exists cash_movements_account on cash_movements(account_id, created_at);
create index if not exists cash_movements_related on cash_movements(related_type, related_id);
create index if not exists expenses_clinic_paid on expenses(clinic_id, paid_at);
create index if not exists treatment_plans_patient on treatment_plans(patient_id);
create index if not exists treatment_plan_items_plan on treatment_plan_items(plan_id);
create index if not exists treatment_plan_items_doctor on treatment_plan_items(doctor_id);
create index if not exists follow_up_reminders_patient on follow_up_reminders(patient_id);
create index if not exists follow_up_reminders_due on follow_up_reminders(clinic_id, status, due_date);
create index if not exists tooth_states_patient on tooth_states(patient_id, tooth_fdi, recorded_at desc);
create index if not exists prostheses_patient on prostheses(patient_id);
create index if not exists prosthesis_steps_prosthesis on prosthesis_steps(prosthesis_id);
create index if not exists patient_consents_patient on patient_consents(patient_id);
create index if not exists patient_doctor_history_patient on patient_doctor_history(patient_id);
create index if not exists patients_primary_doctor on patients(primary_doctor_id);
create index if not exists stock_movements_product on stock_movements(product_id, created_at);
create index if not exists stock_movements_patient on stock_movements(patient_id);
create index if not exists purchase_items_purchase on purchase_items(purchase_id);
create index if not exists purchase_request_items_request on purchase_request_items(request_id);
create index if not exists payroll_payments_payroll on payroll_payments(payroll_id);
create index if not exists commission_payments_doctor on commission_payments(doctor_id, period);
create index if not exists queue_tickets_patient on queue_tickets(patient_id);
create index if not exists notification_reads_user on notification_reads(user_id);
create index if not exists audit_logs_user on audit_logs(user_id, created_at desc);
analyze;
