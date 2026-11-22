// Matrice des rôles et permissions de DENTAL.
export const ALL = ['view_all_patients','view_assigned_patients','create_patients','edit_patients','view_medical_records','edit_medical_records','view_finances','manage_finances','view_salaries','manage_payroll','manage_inventory','approve_purchases','manage_exchange_rates','manage_users','manage_roles','view_audit_logs','export_reports','manage_appointments','manage_queue','manage_treatment_plans','manage_prostheses','manage_settings']
export const SENSITIVE = new Set(['view_medical_records','edit_medical_records','view_finances','manage_finances','view_salaries','manage_payroll','approve_purchases','manage_exchange_rates','manage_users','manage_roles','view_audit_logs','manage_settings'])
const ADMINISH = ALL.filter(p => p !== 'manage_exchange_rates')
export const ROLES = {
  OWNER: ALL, ADMIN: ADMINISH, ADMIN_MEDICAL: ['view_all_patients','create_patients','edit_patients','view_medical_records','edit_medical_records','manage_appointments','manage_queue','manage_treatment_plans','manage_prostheses'],
  ADMIN_FINANCIER: ['view_finances','manage_finances','view_salaries','export_reports'],
  DENTIST: ['view_all_patients','view_assigned_patients','create_patients','view_medical_records','edit_medical_records','manage_appointments','manage_queue','manage_treatment_plans','manage_prostheses'], DENTAL_ASSISTANT: ['view_assigned_patients','manage_queue'],
  SECRETARY: ['view_all_patients','create_patients','edit_patients','manage_appointments','manage_queue'], ACCOUNTANT: ['view_finances','manage_finances','view_salaries','export_reports'],
  STOCK_MANAGER: ['manage_inventory'], DENTAL_TECH: ['manage_prostheses'], STAFF: [] }

// Patient « assigné » à un médecin : il en est le médecin traitant, ou il l'a en rendez-vous, en consultation ou comme responsable d'un plan de traitement.
// pa = alias SQL de la table patients, up = paramètre SQL contenant l'id du médecin (ex. '$2').
export const assignedSql = (pa, up) => `(${pa}.primary_doctor_id=${up} or exists(select 1 from appointments x where x.patient_id=${pa}.id and x.doctor_id=${up}) or exists(select 1 from consultations x where x.patient_id=${pa}.id and x.doctor_id=${up}) or exists(select 1 from treatment_plans x where x.patient_id=${pa}.id and x.responsible_doctor_id=${up}))`
export const isAssigned = async (q, patientId, userId) => (await q(`select 1 from patients p where p.id=$1 and ${assignedSql('p', '$2')}`, [patientId, userId])).rowCount > 0

export const makePermissions = q => {
  const permsOf = async u => {
    if (u.role === 'OWNER') return new Set(ALL)
    const s = new Set(ROLES[u.role] || [])
    for (const r of (await q('select perm,granted from user_permissions where user_id=$1', [u.id])).rows) r.granted ? s.add(r.perm) : s.delete(r.perm)
    return s
  }
  const canDelegate = async (u, perm) => {
    if (u.role === 'OWNER') return true
    if (!(await permsOf(u)).has(perm)) return false
    if (!SENSITIVE.has(perm)) return true
    return (await q('select 1 from user_permissions where user_id=$1 and perm=$2 and granted and can_delegate', [u.id, perm])).rowCount > 0
  }
  return { permsOf, canDelegate }
}
