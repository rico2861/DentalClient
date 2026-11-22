import { notify } from './security.js'
const N3 = /^\d{1,9}(\.\d{1,3})?$/, P = /^\d{1,10}(\.\d{1,4})?$/
export default function (app, { pool, q, need, audit, fail, wrap, clean }) {
  const tx = async fn => { const c = await pool.connect(); try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r } catch (e) { await c.query('rollback'); throw e } finally { c.release() } }
  const E = (s, m) => ({ err: [s, m] }), done = (res, o, f) => o.err ? fail(res, ...o.err) : res.json(f ? f(o) : o)
  const resolve = async (c, cid, items) => { const out = []; for (const i of items.slice(0, 50)) { const p = (await c.query('select id from products where clinic_id=$1 and (ref=$2 or name=$2)', [cid, clean(i.product, 80) ?? ''])).rows[0]
    if (!p || !N3.test(String(i.qty)) || Number(i.qty) <= 0 || !P.test(String(i.est_unit_price ?? '0'))) return null; out.push([p.id, i.qty, i.est_unit_price ?? 0]) } return out.length ? out : null }
  app.get('/api/purchase-requests', need('manage_inventory', 'approve_purchases'), wrap(async (req, res) => res.json((await q(
    `select r.id,r.status,r.note,r.decision_note,r.created_at,r.decided_at,r.requested_by=$2 mine,u.first_name||' '||u.last_name requester,d.first_name||' '||d.last_name decider,
     (select string_agg(p.name||' ×'||i.qty||' @'||i.est_unit_price,', ' order by p.name) from purchase_request_items i join products p on p.id=i.product_id where i.request_id=r.id) items
     from purchase_requests r join users u on u.id=r.requested_by left join users d on d.id=r.decided_by where r.clinic_id=$1 order by r.created_at desc limit 100`, [req.user.clinic_id, req.user.id])).rows)))
  app.post('/api/purchase-requests', need('manage_inventory'), wrap(async (req, res) => {
    const out = await tx(async c => { const it = await resolve(c, req.user.clinic_id, Array.isArray(req.body.items) ? req.body.items : []); if (!it) return E(400, 'Produits ou quantités invalides (utilisez la référence ou le nom exact)')
      const { rows: [r] } = await c.query('insert into purchase_requests(clinic_id,requested_by,note) values($1,$2,$3) returning id', [req.user.clinic_id, req.user.id, clean(req.body.note, 300)])
      for (const [p, q_, pr] of it) await c.query('insert into purchase_request_items(request_id,product_id,qty,est_unit_price) values($1,$2,$3,$4)', [r.id, p, q_, pr]); return r })
    if (!out.err) { await audit(req, 'PURCHASE_REQUEST_CREATED', 'purchase_requests', out.id); await notify(q, req.user.clinic_id, 'purchase_request', "Demande d'achat en attente", 'Une nouvelle demande attend votre décision', 'approve_purchases') } done(res, out) }))
  const decide = (status, needNote) => wrap(async (req, res) => {
    const note = clean(req.body.note, 300); if (needNote && !note) return fail(res, 400, 'Motif obligatoire')
    const out = await tx(async c => { const r = (await c.query("select * from purchase_requests where id=$1 and clinic_id=$2 and status='pending' for update", [req.params.id, req.user.clinic_id])).rows[0]; if (!r) return E(409, 'Demande introuvable ou déjà traitée')
      if (r.requested_by === req.user.id && req.user.role !== 'OWNER') return E(403, 'Vous ne pouvez pas décider de votre propre demande')   // séparation des tâches
      await c.query('update purchase_requests set status=$2,decided_by=$3,decided_at=now(),decision_note=$4 where id=$1', [r.id, status, req.user.id, note]); return r })
    if (!out.err) { await audit(req, 'PURCHASE_REQUEST_' + status.toUpperCase(), 'purchase_requests', req.params.id); await notify(q, req.user.clinic_id, 'purchase_request_decision', status === 'approved' ? 'Demande d\'achat approuvée' : 'Demande d\'achat refusée', note || '', null, out.requested_by) } done(res, out, () => ({ ok: true })) })
  app.post('/api/purchase-requests/:id/approve', need('approve_purchases'), decide('approved', false))
  app.post('/api/purchase-requests/:id/reject', need('approve_purchases'), decide('rejected', true))
  app.post('/api/purchase-requests/:id/modify', need('approve_purchases'), wrap(async (req, res) => {
    const out = await tx(async c => { const r = (await c.query("select id from purchase_requests where id=$1 and clinic_id=$2 and status='pending' for update", [req.params.id, req.user.clinic_id])).rows[0]; if (!r) return E(409, 'Seules les demandes en attente sont modifiables')
      const it = await resolve(c, req.user.clinic_id, Array.isArray(req.body.items) ? req.body.items : []); if (!it) return E(400, 'Articles invalides'); await c.query('delete from purchase_request_items where request_id=$1', [r.id])
      for (const [p, q_, pr] of it) await c.query('insert into purchase_request_items(request_id,product_id,qty,est_unit_price) values($1,$2,$3,$4)', [r.id, p, q_, pr]); return {} })
    if (!out.err) await audit(req, 'PURCHASE_REQUEST_MODIFIED', 'purchase_requests', req.params.id); done(res, out, () => ({ ok: true })) }))
  app.post('/api/purchase-requests/:id/order', need('approve_purchases'), wrap(async (req, res) => {   // la commande n'augmente PAS le stock : réception obligatoire ensuite
    const cur = req.body.currency === 'USD' ? 'USD' : 'HTG'
    const out = await tx(async c => { const r = (await c.query("select * from purchase_requests where id=$1 and clinic_id=$2 and status='approved' for update", [req.params.id, req.user.clinic_id])).rows[0]; if (!r) return E(409, "Seule une demande approuvée peut être commandée (une seule fois)")
      const items = (await c.query('select product_id,qty,est_unit_price from purchase_request_items where request_id=$1', [r.id])).rows, ov = new Map((Array.isArray(req.body.items) ? req.body.items : []).map(i => [i.product_id, i]))
      let total = 0; const lines = items.map(i => { const o = ov.get(i.product_id), price = o?.unit_price ?? i.est_unit_price; if (!P.test(String(price))) return null; total += Math.round(Number(i.qty) * Number(price) * 100); return [i.product_id, i.qty, price, clean(o?.lot_number, 60), /^\d{4}-\d{2}-\d{2}$/.test(o?.expiry || '') ? o.expiry : null] })
      if (lines.includes(null)) return E(400, 'Prix invalide')
      const rate = (await c.query('select rate::text from exchange_rates where clinic_id=$1 and effective_at<=now() order by effective_at desc, created_at desc limit 1', [req.user.clinic_id])).rows[0]?.rate ?? null; if (cur === 'USD' && !rate) return E(409, "Définissez d'abord un taux de change")
      const htg = cur === 'USD' ? Math.round(total * Number(rate)) : total
      const { rows: [p] } = await c.query('insert into purchases(clinic_id,supplier_id,currency,rate_htg_per_usd,total,total_htg,created_by) values($1,$2,$3,$4,$5,$6,$7) returning id', [req.user.clinic_id, /^[0-9a-f-]{36}$/.test(req.body.supplier_id || '') ? req.body.supplier_id : null, cur, rate, total / 100, htg / 100, req.user.id])
      for (const l of lines) await c.query('insert into purchase_items(purchase_id,product_id,qty,unit_price,lot_number,expiry) values($1,$2,$3,$4,$5,$6)', [p.id, ...l])
      await c.query("update purchase_requests set status='ordered', purchase_id=$2 where id=$1", [r.id, p.id]); return { purchase_id: p.id } })
    if (!out.err) await audit(req, 'PURCHASE_REQUEST_ORDERED', 'purchase_requests', req.params.id, { purchase_id: out.purchase_id }); done(res, out) }))
}
