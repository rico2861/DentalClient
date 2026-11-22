const AMT = /^\d{1,10}(\.\d{1,2})?$/, CATS = ['Salaires','Loyer','Électricité','Eau','Internet','Matériaux dentaires','Fournitures','Laboratoire','Maintenance','Transport','Marketing','Autres']
export default function (app, { pool, q, need, audit, fail, wrap, clean }) {
  const tx = async fn => { const c = await pool.connect(); try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r } catch (e) { await c.query('rollback'); throw e } finally { c.release() } }
  const E = (s, m) => ({ err: [s, m] }), done = (res, o, f) => o.err ? fail(res, ...o.err) : res.json(f ? f(o) : o)
  const BAL = "a.opening_balance+coalesce((select sum(case when m.kind in ('in','transfer_in') then m.amount else -m.amount end) from cash_movements m where m.account_id=a.id),0)"
  const ref = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const rateNow = async (c, cid) => (await c.query('select rate::text from exchange_rates where clinic_id=$1 and effective_at<=now() order by effective_at desc, created_at desc limit 1', [cid])).rows[0]?.rate ?? null
  app.get('/api/cash/accounts', need('view_finances'), wrap(async (req, res) => res.json((await q(`select a.id,a.name,a.currency,a.kind,(${BAL})::text balance from cash_accounts a where a.clinic_id=$1 and a.active order by a.created_at`, [req.user.clinic_id])).rows)))
  app.post('/api/cash/accounts', need('manage_finances'), wrap(async (req, res) => { const n = clean(req.body.name); if (!n || !['HTG', 'USD'].includes(req.body.currency) || !AMT.test(String(req.body.opening_balance ?? '0'))) return fail(res, 400, 'Champs invalides')
    const { rows: [a] } = await q('insert into cash_accounts(clinic_id,name,currency,kind,opening_balance) values($1,$2,$3,$4,$5) returning id', [req.user.clinic_id, n, req.body.currency, req.body.kind === 'bank' ? 'bank' : 'cash', req.body.opening_balance || 0])
    await audit(req, 'CASH_ACCOUNT_CREATED', 'cash_accounts', a.id); res.json(a) }))
  app.get('/api/cash/movements', need('view_finances'), wrap(async (req, res) => res.json((await q(
    "select m.id,m.kind,m.amount::text,m.ref,m.reason,m.related_type,m.created_at,a.name account,a.currency from cash_movements m join cash_accounts a on a.id=m.account_id where m.clinic_id=$1 order by m.created_at desc limit 100", [req.user.clinic_id])).rows)))
  app.post('/api/cash/movements', need('manage_finances'), wrap(async (req, res) => {   // mouvement manuel (revenu/dépense hors facture : à documenter par le motif)
    const { account_id, kind, amount } = req.body, reason = clean(req.body.reason, 200); if (!['in', 'out'].includes(kind) || !AMT.test(String(amount)) || Number(amount) <= 0 || !reason) return fail(res, 400, 'Mouvement invalide')
    const out = await tx(async c => { const a = (await c.query('select id,(' + BAL + ')::numeric bal from cash_accounts a where id=$1 and clinic_id=$2 and active for update', [account_id, req.user.clinic_id])).rows[0]; if (!a) return E(404, 'Caisse introuvable')
      if (kind === 'out' && Number(a.bal) < Number(amount)) return E(409, 'Solde insuffisant')
      return (await c.query('insert into cash_movements(clinic_id,account_id,kind,amount,ref,reason,created_by) values($1,$2,$3,$4,$5,$6,$7) returning id,ref', [req.user.clinic_id, a.id, kind, amount, ref('MAN'), reason, req.user.id])).rows[0] })
    if (!out.err) await audit(req, 'CASH_MOVEMENT', 'cash_movements', out.id, { kind, amount }); done(res, out) }))
  app.post('/api/cash/transfer', need('manage_finances'), wrap(async (req, res) => {   // un transfert n'est ni un revenu ni une dépense
    const { from, to, amount } = req.body; if (!AMT.test(String(amount)) || Number(amount) <= 0 || from === to) return fail(res, 400, 'Transfert invalide')
    const out = await tx(async c => { const as = (await c.query('select id,currency,(' + BAL + ')::numeric bal from cash_accounts a where id=any($1) and clinic_id=$2 and active for update', [[from, to], req.user.clinic_id])).rows
      const f = as.find(a => a.id === from), t = as.find(a => a.id === to); if (!f || !t) return E(404, 'Caisse introuvable'); if (f.currency !== t.currency) return E(400, 'Transfert entre devises différentes non supporté')
      if (Number(f.bal) < Number(amount)) return E(409, 'Solde insuffisant'); const g = crypto.randomUUID()
      await c.query("insert into cash_movements(clinic_id,account_id,kind,amount,ref,reason,group_id,created_by) values($1,$2,'transfer_out',$3,$4,'Transfert',$5,$6)", [req.user.clinic_id, from, amount, ref('TRO'), g, req.user.id])
      await c.query("insert into cash_movements(clinic_id,account_id,kind,amount,ref,reason,group_id,created_by) values($1,$2,'transfer_in',$3,$4,'Transfert',$5,$6)", [req.user.clinic_id, to, amount, ref('TRI'), g, req.user.id]); return { group: g } })
    if (!out.err) await audit(req, 'CASH_TRANSFER', 'cash_movements', out.group, { amount }); done(res, out) }))
  app.post('/api/cash/close', need('manage_finances'), wrap(async (req, res) => {
    const { account_id, day, physical } = req.body; if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !AMT.test(String(physical))) return fail(res, 400, 'Données invalides')
    const out = await tx(async c => { const a = (await c.query(`select id,(a.opening_balance+coalesce((select sum(case when m.kind in ('in','transfer_in') then m.amount else -m.amount end) from cash_movements m where m.account_id=a.id and m.created_at < ($3::date+1)),0))::numeric th from cash_accounts a where id=$1 and clinic_id=$2`, [account_id, req.user.clinic_id, day])).rows[0]
      if (!a) return E(404, 'Caisse introuvable')
      try { return (await c.query('insert into cash_closures(clinic_id,account_id,day,theoretical,physical,diff,closed_by) values($1,$2,$3,$4,$5,$6,$7) returning id,theoretical::text,diff::text', [req.user.clinic_id, a.id, day, a.th, physical, Number(physical) - Number(a.th), req.user.id])).rows[0] } catch (e) { if (e.code === '23505') return E(409, 'Journée déjà clôturée'); throw e } })
    if (!out.err) await audit(req, 'CASH_CLOSED', 'cash_closures', out.id, { day, diff: out.diff }); done(res, out) }))
  app.get('/api/expenses', need('view_finances'), wrap(async (req, res) => res.json((await q('select id,category,description,amount::text,currency,amount_htg::text,status,created_at,paid_at from expenses where clinic_id=$1 order by created_at desc limit 100', [req.user.clinic_id])).rows)))
  app.post('/api/expenses', need('manage_finances'), wrap(async (req, res) => {
    const b = req.body, cur = b.currency === 'USD' ? 'USD' : 'HTG'; if (!CATS.includes(b.category) || !AMT.test(String(b.amount)) || Number(b.amount) <= 0) return fail(res, 400, 'Dépense invalide')
    const out = await tx(async c => { const rate = await rateNow(c, req.user.clinic_id); if (cur === 'USD' && !rate) return E(409, 'Taux de change requis'); const htg = cur === 'USD' ? (Number(b.amount) * Number(rate)).toFixed(2) : b.amount
      const { rows: [e] } = await c.query('insert into expenses(clinic_id,category,description,amount,currency,rate_htg_per_usd,amount_htg,status,paid_at,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id', [req.user.clinic_id, b.category, clean(b.description, 300), b.amount, cur, rate, htg, b.pay_now ? 'paid' : 'committed', b.pay_now ? new Date() : null, req.user.id])
      if (b.pay_now) await c.query("select cash_post($1,$2,'out',$3,$4,$5,'expense',$6,$7)", [req.user.clinic_id, cur, b.amount, ref('DEP'), b.category, e.id, req.user.id]); return e })
    if (!out.err) await audit(req, 'EXPENSE_CREATED', 'expenses', out.id, { amount: b.amount }); done(res, out) }))
  app.post('/api/expenses/:id/pay', need('manage_finances'), wrap(async (req, res) => {
    const out = await tx(async c => { const e = (await c.query("select * from expenses where id=$1 and clinic_id=$2 and status='committed' for update", [req.params.id, req.user.clinic_id])).rows[0]; if (!e) return E(409, 'Dépense introuvable ou déjà payée')
      await c.query("update expenses set status='paid', paid_at=now() where id=$1", [e.id]); await c.query("select cash_post($1,$2,'out',$3,$4,$5,'expense',$6,$7)", [req.user.clinic_id, e.currency, e.amount, ref('DEP'), e.category, e.id, req.user.id]); return {} })
    if (!out.err) await audit(req, 'EXPENSE_PAID', 'expenses', req.params.id); done(res, out, () => ({ ok: true })) }))
  app.get('/api/finance/summary', need('view_finances'), wrap(async (req, res) => {
    const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month + '-01' : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }).slice(0, 7) + '-01', c = req.user.clinic_id
    const W = "$2::date and created_at<($2::date+interval '1 month')"
    res.json((await q(`select
      (select coalesce(sum(case when currency='HTG' then total else total*coalesce(rate_htg_per_usd,0) end),0) from invoices where clinic_id=$1 and kind='invoice' and status='issued' and created_at>=${W})::numeric(14,2)::text invoiced_htg,
      (select coalesce(sum(amount_htg),0) from payments where clinic_id=$1 and voided_at is null and created_at>=${W})::text collected_htg,
      (select coalesce(sum(amount_htg),0) from expenses where clinic_id=$1 and status='paid' and paid_at>=$2::date and paid_at<($2::date+interval '1 month'))::text expenses_paid_htg,
      (select coalesce(sum(amount_htg),0) from expenses where clinic_id=$1 and status='committed' and created_at>=${W})::text expenses_unpaid_htg,
      (select coalesce(sum(-qty*unit_cost_htg),0) from stock_movements where clinic_id=$1 and type='consume' and created_at>=${W})::numeric(14,2)::text materials_cost_htg`, [c, m])).rows[0]) }))
}
