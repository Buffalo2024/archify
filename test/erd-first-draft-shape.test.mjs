import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

// Schema-derived first drafts put each column comment in its own field. That
// used to fail schema validation; it now renders after the SQL type.
test('ERD attribute comment renders after its SQL type without rewriting the input', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-erd-comment-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'school.json');
  const output = path.join(dir, 'school.html');
  const doc = {
    schema_version: 1, diagram_type: 'erd',
    meta: { title: '学籍', output: 'school.html', quality_profile: 'showcase' },
    entities: [
      { id: 'students', label: 'students', row: 0, col: 0, attributes: [
        { name: 'id', type: 'bigint', key: 'pk', comment: '学生ID' },
        { name: 'name', type: 'varchar(32)', comment: '姓名' },
        { name: 'class_id', type: 'bigint', key: 'fk', references: 'classes.id', comment: '班级' },
        { name: 'note', comment: '备注' },
      ] },
      { id: 'classes', label: 'classes', row: 0, col: 1, attributes: [
        { name: 'id', type: 'bigint', key: 'pk' },
        { name: 'title', type: 'varchar(64)', comment: '班级名称' },
      ] },
    ],
    relationships: [{ from: 'students', to: 'classes', label: 'belongs to', fromCardinality: 'many', toCardinality: 'one' }],
  };
  const source = JSON.stringify(doc);
  fs.writeFileSync(input, source);
  const result = spawnSync(process.execPath, [cli, 'render', 'erd', input, output, '--quality', 'showcase'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(input, 'utf8'), source);
  const html = fs.readFileSync(output, 'utf8');
  for (const text of ['bigint｜学生ID', 'varchar(32)｜姓名', 'varchar(64)｜班级名称', '>备注<']) {
    assert.ok(html.includes(text), `missing ${text}`);
  }
});

function validate(t, doc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-erd-unplaced-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input.json');
  const source = JSON.stringify(doc);
  fs.writeFileSync(input, source);
  const result = spawnSync(process.execPath, [cli, 'validate', 'erd', input, '--quality', 'showcase', '--json'], { encoding: 'utf8' });
  assert.equal(fs.readFileSync(input, 'utf8'), source, 'automatic placement must not rewrite authored input');
  return { result, receipt: JSON.parse(result.stdout) };
}

const table = (id, tag, attributes) => ({ id, label: id, ...(tag ? { tag } : {}), attributes });
const pk = { name: 'id', type: 'bigint', key: 'pk' };
const fk = (name, references) => ({ name, type: 'bigint', key: 'fk', references });
const rel = (from, to) => ({ from, to, fromCardinality: 'many', toCardinality: 'one' });

// Before: tables without row/col/pos all sat at the origin and the router threw
// "Cannot read properties of undefined" as internal/unclassified.
test('ERD first draft without any placement lays tables out and passes showcase', t => {
  const { result, receipt } = validate(t, {
    schema_version: 1, diagram_type: 'erd',
    meta: { title: 'Store', output: 'store.html', quality_profile: 'showcase' },
    entities: [
      table('customers', 'customers', [pk, { name: 'email', type: 'varchar(255)' }]),
      table('addresses', 'customers', [pk, fk('customer_id', 'customers.id')]),
      table('orders', 'ordering', [pk, fk('customer_id', 'customers.id'), fk('address_id', 'addresses.id')]),
      table('order_items', 'ordering', [fk('order_id', 'orders.id'), fk('product_id', 'products.id')]),
      table('products', 'catalog', [pk, fk('category_id', 'categories.id')]),
      table('categories', 'catalog', [pk, { name: 'name', type: 'varchar(64)' }]),
    ],
    relationships: [
      rel('addresses', 'customers'), rel('orders', 'customers'), rel('orders', 'addresses'),
      rel('order_items', 'orders'), rel('order_items', 'products'), rel('products', 'categories'),
    ],
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.equal(receipt.ok, true);
});

test('ERD first draft without placement or domains passes showcase', t => {
  const { result } = validate(t, {
    schema_version: 1, diagram_type: 'erd',
    meta: { title: 'Blog', output: 'blog.html', quality_profile: 'showcase' },
    entities: [
      table('users', null, [pk]),
      table('posts', null, [pk, fk('author_id', 'users.id')]),
      table('comments', null, [pk, fk('post_id', 'posts.id'), fk('user_id', 'users.id')]),
      table('tags', null, [pk]),
      table('post_tags', null, [fk('post_id', 'posts.id'), fk('tag_id', 'tags.id')]),
    ],
    relationships: [
      rel('posts', 'users'), rel('comments', 'posts'), rel('comments', 'users'),
      rel('post_tags', 'posts'), rel('post_tags', 'tags'),
    ],
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
});
