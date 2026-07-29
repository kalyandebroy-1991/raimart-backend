require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('./db'); // initializes DB + seeds defaults on first run

const SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors());
app.use(express.json());

// ============ AUTH MIDDLEWARE ============
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.admin = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ============ AUTH ROUTES ============
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = bcrypt.compareSync(password, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: admin.id, username: admin.username }, SECRET, { expiresIn: '7d' });
  res.json({ token, username: admin.username });
});

app.post('/api/auth/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both fields required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  const ok = bcrypt.compareSync(currentPassword, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(newHash, admin.id);
  res.json({ success: true });
});

// ============ CATEGORY ROUTES ============
app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.json(rows);
});

app.post('/api/categories', requireAdmin, (req, res) => {
  const { name, emoji } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name required' });
  try {
    const info = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)').run(name, emoji || '🛒');
    res.status(201).json({ id: info.lastInsertRowid, name, emoji: emoji || '🛒' });
  } catch (e) {
    res.status(400).json({ error: 'Category already exists' });
  }
});

app.delete('/api/categories/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============ PRODUCT ROUTES ============
function withComputedPrice(p) {
  const hasOffer = !!(p.offer_active && p.offer_percent > 0);
  const finalPrice = hasOffer ? +(p.price * (1 - p.offer_percent / 100)).toFixed(2) : p.price;
  return { ...p, in_stock: !!p.in_stock, offer_active: !!p.offer_active, featured: !!p.featured, final_price: finalPrice };
}

app.get('/api/products', (req, res) => {
  const { category_id, in_stock, featured, search } = req.query;
  let sql = `SELECT p.*, c.name as category_name, c.emoji as category_emoji
             FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1`;
  const params = [];
  if (category_id) { sql += ' AND p.category_id = ?'; params.push(category_id); }
  if (in_stock !== undefined) { sql += ' AND p.in_stock = ?'; params.push(in_stock === 'true' || in_stock === '1' ? 1 : 0); }
  if (featured !== undefined) { sql += ' AND p.featured = ?'; params.push(featured === 'true' || featured === '1' ? 1 : 0); }
  if (search) { sql += ' AND p.name LIKE ?'; params.push(`%${search}%`); }
  sql += ' ORDER BY p.updated_at DESC';
  const rows = db.prepare(sql).all(...params).map(withComputedPrice);
  res.json(rows);
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare(`SELECT p.*, c.name as category_name, c.emoji as category_emoji
                           FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(withComputedPrice(row));
});

app.post('/api/products', requireAdmin, (req, res) => {
  const { name, category_id, unit, price, image_url, in_stock, offer_percent, offer_active, featured } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'name and price are required' });
  const info = db.prepare(`
    INSERT INTO products (name, category_id, unit, price, image_url, in_stock, offer_percent, offer_active, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, category_id || null, unit || 'piece', price, image_url || '',
    in_stock === undefined ? 1 : (in_stock ? 1 : 0),
    offer_percent || 0, offer_active ? 1 : 0, featured ? 1 : 0
  );
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/products/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const merged = { ...existing, ...req.body };
  db.prepare(`
    UPDATE products SET name=?, category_id=?, unit=?, price=?, image_url=?, in_stock=?, offer_percent=?, offer_active=?, featured=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    merged.name, merged.category_id, merged.unit, merged.price, merged.image_url,
    merged.in_stock ? 1 : 0, merged.offer_percent || 0, merged.offer_active ? 1 : 0, merged.featured ? 1 : 0,
    req.params.id
  );
  res.json({ success: true });
});

app.patch('/api/products/:id/stock', requireAdmin, (req, res) => {
  const { in_stock } = req.body;
  db.prepare(`UPDATE products SET in_stock = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(in_stock ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.patch('/api/products/:id/offer', requireAdmin, (req, res) => {
  const { offer_percent, offer_active } = req.body;
  db.prepare(`UPDATE products SET offer_percent = ?, offer_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(offer_percent || 0, offer_active ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/products/bulk-import  (admin) — Excel/CSV upload
// Expected columns: name, category, unit, price, image_url, in_stock, offer_percent
app.post('/api/products/bulk-import', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse file. Use .xlsx, .xls, or .csv' });
  }

  const getCatId = db.prepare('SELECT id FROM categories WHERE name = ?');
  const insertCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
  const insertProduct = db.prepare(`
    INSERT INTO products (name, category_id, unit, price, image_url, in_stock, offer_percent, offer_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let imported = 0, skipped = 0;
  const errors = [];

  db.runInTransaction(() => {
    rows.forEach((row, i) => {
      const name = String(row.name || row.Name || '').trim();
      const price = parseFloat(row.price || row.Price);
      if (!name || isNaN(price)) { skipped++; errors.push(`Row ${i + 2}: missing name or invalid price`); return; }

      const catName = String(row.category || row.Category || '').trim();
      let category_id = null;
      if (catName) {
        const existing = getCatId.get(catName);
        category_id = existing ? existing.id : insertCat.run(catName).lastInsertRowid;
      }

      const in_stock = String(row.in_stock ?? row.InStock ?? '1').toLowerCase();
      const offer = parseFloat(row.offer_percent || row.Offer || 0) || 0;

      insertProduct.run(
        name,
        category_id,
        String(row.unit || row.Unit || 'piece'),
        price,
        String(row.image_url || row.ImageURL || ''),
        (in_stock === '0' || in_stock === 'false' || in_stock === 'no') ? 0 : 1,
        offer,
        offer > 0 ? 1 : 0
      );
      imported++;
    });
  });

  res.json({ imported, skipped, errors: errors.slice(0, 20) });
});

// ============ ADMIN PANEL + MISC ============
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin/', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.get('/', (req, res) => res.send('RAI MART API is running. Admin panel: /admin'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`RAI MART backend running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
