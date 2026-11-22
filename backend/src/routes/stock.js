const N3 = /^\d{1,9}(\.\d{1,3})?$/, P = /^\d{1,10}(\.\d{1,4})?$/, k = v => Math.round(Number(v) * 1000)
export default function (app, { pool, q, need, audit, fail, wrap, clean }) {
  const tx = async fn => { const c = await pool.connect(); try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r } catch (e) { await c.query('rollback'); throw e } finally { c.release() } }
  const E = (s, m) => ({ err: [s, m] }), done = (res, o, f) => o.err ? fail(res, ...o.err) : res.json(f ? f(o) : o)
  const rateNow = async (c, cid) => (await c.query('select rate::text from exchange_rates where clinic_id=$1 and effective_at<=now() order by effective_at desc, created_at desc limit 1', [cid])).rows[0]?.rate ?? null
  app.get('/api/products', need('manage_inventory'), wrap(async (req, res) => res.json((await q(
    `select p.id,p.ref,p.name,p.category,p.unit,p.min_stock::text,coalesce(sum(l.qty_remaining) filter (where l.expiry is null or l.expiry>=current_date),0)::numeric(14,3)::text stock,
     coalesce(sum(l.qty_remaining*l.unit_cost_htg),0)::numeric(14,2)::text value, min(l.expiry) filter (where l.qty_remaining>0) next_expiry
     from products p left join product_lots l on l.product_id=p.id where p.clinic_id=$1 group by p.id order by p.name`, [req.user.clinic_id])).rows)))
  app.post('/api/products', need('manage_inventory'), wrap(async (req, res) => {
    const n = clean(req.body.name); if (!n || !N3.test(String(req.body.min_stock ?? '0'))) return fail(res, 400, 'Champs invalides')
    try { const { rows: [p] } = await q('insert into products(clinic_id,ref,name,category,unit,min_stock) values($1,$2,$3,$4,$5,$6) returning id', [req.user.clinic_id, clean(req.body.ref, 40), n, clean(req.body.category, 60), clean(req.body.unit, 20) || 'unité', req.body.min_stock || 0])
      await audit(req, 'PRODUCT_CREATED', 'products', p.id); res.json(p) } catch (e) { if (e.code === '23505') return fail(res, 409, 'Référence déjà utilisée'); throw e } }))
  app.get('/api/suppliers', need('manage_inventory'), wrap(async (req, res) => res.json((await q('select id,name,phone from suppliers where clinic_id=$1 order by name', [req.user.clinic_id])).rows)))
  app.post('/api/suppliers', need('manage_inventory'), wrap(async (req, res) => { const n = clean(req.body.name); if (!n) return fail(res, 400, 'Nom requis')
    res.json((await q('insert into suppliers(clinic_id,name,phone) values($1,$2,$3) returning id', [req.user.clinic_id, n, clean(req.body.phone, 30)])).rows[0]) }))
  app.get('/api/purchases', need('manage_inventory'), wrap(async (req, res) => res.json((await q(
    `select p.id,p.status,p.currency,p.total::text,p.created_at,s.name supplier,(select string_agg(pr.name||' ×'||i.qty,', ') from purchase_items i join products pr on pr.id=i.product_id where i.purchase_id=p.id) items,
     exists(select 1 from expenses e where e.source_type='purchase' and e.source_id=p.id::text) paid from purchases p left join suppliers s on s.id=p.supplier_id where p.clinic_id=$1 order by p.created_at desc limit 50`, [req.user.clinic_id])).rows)))
  app.post('/api/purchases', need('manage_inventory'), wrap(async (req, res) => {   // une commande n'augmente PAS le stock
    const cur = req.body.currency === 'USD' ? 'USD' : 'HTG', items = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : []; if (!items.length) return fail(res, 400, 'Aucun article')
    let total = 0; for (const i of items) { if (!N3.test(String(i.qty)) || Number(i.qty) <= 0 || !P.test(String(i.unit_price)) || !/^[0-9a-f-]{36}$/.test(i.product_id || '')) return fail(res, 400, 'Article invalide'); total += Math.round(Number(i.qty) * Number(i.unit_price) * 100) }
    const out = await tx(async c => {
      const rate = await rateNow(c, req.user.clinic_id); if (cur === 'USD' && !rate) return E(409, "Définissez d'abord un taux de change")
      const htg = cur === 'USD' ? Math.round(total * Number(rate)) : total
      const { rows: [p] } = await c.query('insert into purchases(clinic_id,supplier_id,currency,rate_htg_per_usd,total,total_htg,created_by) values($1,$2,$3,$4,$5,$6,$7) returning id', [req.user.clinic_id, req.body.supplier_id || null, cur, rate, total / 100, htg / 100, req.user.id])
      for (const i of items) await c.query('insert into purchase_items(purchase_id,product_id,qty,unit_price,lot_number,expiry) values($1,$2,$3,$4,$5,$6)', [p.id, i.product_id, i.qty, i.unit_price, clean(i.lot_number, 60), /^\d{4}-\d{2}-\d{2}$/.test(i.expiry || '') ? i.expiry : null])
      return p })
    done(res, out) }))
  app.post('/api/purchases/:id/receive', need('manage_inventory'), wrap(async (req, res) => {
    const out = await tx(async c => {
      const p = (await c.query('select * from purchases where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!p) return E(404, 'Achat introuvable')
      if (p.status !== 'ordered') return E(409, 'Déjà réceptionné')   // empêche la double réception
      const r = p.currency === 'USD' ? Number(p.rate_htg_per_usd) : 1
      for (const i of (await c.query('select * from purchase_items where purchase_id=$1', [p.id])).rows) {
        const cost = (Number(i.unit_price) * r).toFixed(4)
        const { rows: [l] } = await c.query('insert into product_lots(clinic_id,product_id,lot_number,expiry,qty_received,qty_remaining,unit_cost_htg,purchase_id) values($1,$2,$3,$4,$5,$5,$6,$7) returning id', [req.user.clinic_id, i.product_id, i.lot_number, i.expiry, i.qty, cost, p.id])
        await c.query("insert into stock_movements(clinic_id,product_id,lot_id,type,qty,unit_cost_htg,reason,created_by) values($1,$2,$3,'in',$4,$5,'Réception achat',$6)", [req.user.clinic_id, i.product_id, l.id, i.qty, cost, req.user.id]) }
      await c.query("update purchases set status='received', received_at=now() where id=$1", [p.id]); return {} })
    if (!out.err) await audit(req, 'PURCHASE_RECEIVED', 'purchases', req.params.id); done(res, out, () => ({ ok: true })) }))
  app.post('/api/purchases/:id/pay', need('manage_inventory', 'manage_finances'), wrap(async (req, res) => {   // paiement = SEULE dépense de trésorerie
    if (!req.perms.has('manage_finances')) return fail(res, 403, 'Permission refusée')
    const out = await tx(async c => {
      const p = (await c.query('select * from purchases where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!p) return E(404, 'Achat introuvable')
      try { await c.query("savepoint s"); await c.query("insert into expenses(clinic_id,category,description,amount,currency,rate_htg_per_usd,amount_htg,status,paid_at,source_type,source_id,created_by) values($1,'Matériaux dentaires',$2,$3,$4,$5,$6,'paid',now(),'purchase',$7,$8)",
        [req.user.clinic_id, 'Achat matériaux', p.total, p.currency, p.rate_htg_per_usd, p.total_htg, p.id, req.user.id]) } catch (e) { if (e.code === '23505') return E(409, 'Achat déjà payé'); throw e }
      await c.query("select cash_post($1,$2,'out',$3,$4,$5,'purchase',$6,$7)", [req.user.clinic_id, p.currency, p.total, 'ACH-' + p.id.slice(0, 8), 'Paiement achat', p.id, req.user.id]); return {} })
    if (!out.err) await audit(req, 'PURCHASE_PAID', 'purchases', req.params.id); done(res, out, () => ({ ok: true })) }))
  // Consommation FEFO : attribue un coût, ne crée aucune sortie de trésorerie
  app.post('/api/consumptions', need('manage_inventory', 'edit_medical_records'), wrap(async (req, res) => {
    if (!N3.test(String(req.body.qty)) || Number(req.body.qty) <= 0) return fail(res, 400, 'Quantité invalide')
    const out = await tx(async c => {
      const pat = req.body.patient_file ? (await c.query('select id from patients where clinic_id=$1 and file_number=$2', [req.user.clinic_id, clean(req.body.patient_file, 30)])).rows[0] : null
      if (req.body.patient_file && !pat) return E(404, 'Patient introuvable')
      const lots = (await c.query('select id,qty_remaining::text q,unit_cost_htg::text cost from product_lots where product_id=$1 and clinic_id=$2 and qty_remaining>0 and (expiry is null or expiry>=current_date) order by expiry nulls last, received_at for update', [req.body.product_id, req.user.clinic_id])).rows
      let need_ = k(req.body.qty), cost = 0; const used = []
      for (const l of lots) { if (!need_) break; const t = Math.min(need_, k(l.q)); need_ -= t; used.push([l.id, t, l.cost]); cost += t / 1000 * Number(l.cost) }
      if (need_) return E(409, 'Stock insuffisant (lots expirés exclus)')
      for (const [id, t, uc] of used) { await c.query('update product_lots set qty_remaining=qty_remaining-$2 where id=$1', [id, t / 1000])
        await c.query("insert into stock_movements(clinic_id,product_id,lot_id,type,qty,unit_cost_htg,patient_id,doctor_id,reason,created_by) values($1,$2,$3,'consume',$4,$5,$6,$7,$8,$7)", [req.user.clinic_id, req.body.product_id, id, -t / 1000, uc, pat?.id ?? null, req.user.id, clean(req.body.reason, 200)]) }
      return { cost_htg: cost.toFixed(2), lots: used.length } })
    if (!out.err) await audit(req, 'STOCK_CONSUMED', 'stock_movements', null, { product: req.body.product_id }); done(res, out) }))
  app.post('/api/stock-counts', need('manage_inventory'), wrap(async (req, res) => {   // inventaire physique : écart journalisé
    const reason = clean(req.body.reason, 200); if (!reason || !N3.test(String(req.body.counted))) return fail(res, 400, 'Quantité et motif requis')
    const out = await tx(async c => {
      const lots = (await c.query('select id,qty_remaining::text q,unit_cost_htg::text cost from product_lots where product_id=$1 and clinic_id=$2 and qty_remaining>0 order by expiry nulls last for update', [req.body.product_id, req.user.clinic_id])).rows
      const theo = lots.reduce((s, l) => s + k(l.q), 0), diff = k(req.body.counted) - theo; if (!diff) return { diff: 0 }
      if (diff < 0) { let r = -diff; for (const l of lots) { if (!r) break; const t = Math.min(r, k(l.q)); r -= t; await c.query('update product_lots set qty_remaining=qty_remaining-$2 where id=$1', [l.id, t / 1000])
        await c.query("insert into stock_movements(clinic_id,product_id,lot_id,type,qty,unit_cost_htg,reason,created_by) values($1,$2,$3,'adjust',$4,$5,$6,$7)", [req.user.clinic_id, req.body.product_id, l.id, -t / 1000, l.cost, 'Inventaire : ' + reason, req.user.id]) } }
      else { const { rows: [l] } = await c.query("insert into product_lots(clinic_id,product_id,lot_number,qty_received,qty_remaining,unit_cost_htg) values($1,$2,'AJUSTEMENT',$3,$3,$4) returning id", [req.user.clinic_id, req.body.product_id, diff / 1000, lots[0]?.cost ?? 0])
        await c.query("insert into stock_movements(clinic_id,product_id,lot_id,type,qty,unit_cost_htg,reason,created_by) values($1,$2,$3,'adjust',$4,$5,$6,$7)", [req.user.clinic_id, req.body.product_id, l.id, diff / 1000, lots[0]?.cost ?? 0, 'Inventaire : ' + reason, req.user.id]) }
      return { diff: diff / 1000 } })
    await audit(req, 'STOCK_COUNT', 'products', req.body.product_id, { diff: out.diff, reason }); res.json(out) }))
  app.get('/api/stock/alerts', need('manage_inventory'), wrap(async (req, res) => { const c = req.user.clinic_id
    const [low, exp, near] = await Promise.all([
      q("select p.name,p.min_stock::text,coalesce(sum(l.qty_remaining) filter (where l.expiry is null or l.expiry>=current_date),0)::text stock from products p left join product_lots l on l.product_id=p.id where p.clinic_id=$1 group by p.id having coalesce(sum(l.qty_remaining) filter (where l.expiry is null or l.expiry>=current_date),0)<=p.min_stock", [c]),
      q('select p.name,l.lot_number,l.expiry,l.qty_remaining::text qty from product_lots l join products p on p.id=l.product_id where l.clinic_id=$1 and l.qty_remaining>0 and l.expiry<current_date', [c]),
      q("select p.name,l.lot_number,l.expiry,l.qty_remaining::text qty from product_lots l join products p on p.id=l.product_id where l.clinic_id=$1 and l.qty_remaining>0 and l.expiry between current_date and current_date+60", [c])])
    res.json({ low: low.rows, expired: exp.rows, near_expiry: near.rows }) }))
}
