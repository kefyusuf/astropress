import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as ops from './ops.mjs';
import { locales } from './config.mjs';

const col = z.enum(['blog', 'products', 'pages']);
const txt = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

// Paylaşılan factory: stdio + HTTP her oturum için agent'a bağlı server üretir.
// Guardrail: create/update şemalarında `status` YOK; publish yalnız request_publish -> approve (insan).
// Audit gerçek agent.id ile yazılır (human/agent KIND flattening kaldırıldı — issue #9).
export function createMcpServer(agent) {
  const P = agent.perms;
  const ACTOR = agent.id;
  const server = new McpServer({ name: 'astropress', version: '0.1.0' });

  server.registerTool('whoami', {
    description: 'Bu MCP örneğinin agent kimliğini ve yetki matrisini döndürür.',
    inputSchema: {},
  }, async () => txt({ id: agent.id, name: agent.name, perms: P }));

  server.registerTool('list_content', {
    description: 'İçerikleri listeler (blog/products/pages). Durum filtresi opsiyonel.',
    inputSchema: { collection: col.optional(), status: z.enum(['draft', 'review', 'published']).optional() },
  }, async (args) => txt(ops.list(args)));

  server.registerTool('read_content', {
    description: 'Bir içeriğin frontmatter + markdown gövdesini okur.',
    inputSchema: { collection: col, slug: z.string() },
  }, async (args) => txt(ops.read(args)));

  server.registerTool('create_content', {
    description: 'Yeni içerik oluşturur. Guardrail: durum her zaman "draft"; yayına alma insan onayı gerektirir.',
    inputSchema: { collection: col, title: z.string(), excerpt: z.string().optional(), body: z.string().optional(), author: z.string().optional(), lang: z.enum(locales).optional(), translationOf: z.string().optional() },
  }, async (args) => txt(ops.create(args, ACTOR, P)));

  server.registerTool('update_content', {
    description: 'Mevcut içeriği günceller. Guardrail: status değiştirilemez; yayındaki içerik düzenlemesi inceleme revizyonuna düşer; price/stock commerce yetkisi ister (RBAC).',
    inputSchema: { collection: col, slug: z.string(), title: z.string().optional(), excerpt: z.string().optional(), body: z.string().optional(), seoTitle: z.string().optional(), seoDesc: z.string().optional(), price: z.number().optional(), stock: z.number().optional(), lang: z.enum(locales).optional(), translationOf: z.string().optional() },
  }, async (args) => txt(ops.update(args, ACTOR, P)));

  server.registerTool('delete_content', {
    description: 'İçeriği siler (geri alınamaz; yayındaki kayıt için publish yetkisi gerekir; audit kaydı tutulur).',
    inputSchema: { collection: col, slug: z.string() },
  }, async (args) => txt(ops.remove(args, ACTOR, P)));

  server.registerTool('request_publish', {
    description: 'Yayınlama isteği oluşturur (edit yetkisi gerekir); guardrail gereği insan onayı kuyruğuna düşer.',
    inputSchema: { collection: col, slug: z.string() },
  }, async (args) => txt(ops.requestPublish(args, ACTOR, P)));

  server.registerTool('approve_task', {
    description: 'İNSAN onayı (perms.publish gerektirir): bekleyen yayınlama görevini uygular (status=published). İçerik istekten sonra değiştiyse reddedilir.',
    inputSchema: { taskId: z.string() },
  }, async (args) => txt(ops.approve(args, ACTOR, P)));

  server.registerTool('reject_task', {
    description: 'İNSAN reddi (perms.publish gerektirir): onay bekleyen görevi reddeder.',
    inputSchema: { taskId: z.string() },
  }, async (args) => txt(ops.reject(args, ACTOR, P)));

  server.registerTool('list_tasks', {
    description: 'Görev kuyruğunu listeler (onay bekleyenler dahil).',
    inputSchema: { status: z.enum(['approval', 'done', 'rejected']).optional() },
  }, async (args) => txt(ops.tasks(args)));

  server.registerTool('run_build', {
    description: 'astro build çalıştırır (build yetkisi gerekir — RBAC); statik çıktıyı (dist/) üretir.',
    inputSchema: {},
  }, async () => txt(ops.build(ACTOR, P)));

  server.registerTool('audit_log', {
    description: 'Denetim kaydını (gerçek aktör kimlikleriyle) döndürür.',
    inputSchema: { limit: z.number().optional() },
  }, async (args) => txt(ops.audit(args)));

  return server;
}
