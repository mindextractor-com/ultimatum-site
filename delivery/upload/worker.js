// Local-only helper: multipart upload into the remote R2 bucket via binding.
export default {
  async fetch(req, env) {
    const u = new URL(req.url), key = u.searchParams.get('key'), op = u.pathname.slice(1);
    if (op === 'create') {
      const m = await env.B.createMultipartUpload(key, { httpMetadata: { contentType: u.searchParams.get('ct') } });
      return Response.json({ uploadId: m.uploadId });
    }
    const m = env.B.resumeMultipartUpload(key, u.searchParams.get('uploadId'));
    if (op === 'part') {
      const p = await m.uploadPart(Number(u.searchParams.get('n')), await req.arrayBuffer());
      return Response.json(p);
    }
    if (op === 'complete') {
      const o = await m.complete(await req.json());
      return Response.json({ size: o.size, etag: o.etag });
    }
    if (op === 'abort') { await m.abort(); return Response.json({ ok: true }); }
    return new Response('?', { status: 400 });
  }
};
