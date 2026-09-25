/** api.js — thin wrappers around the server's REST API. Errors carry the server's message. */

async function request(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new Error('Could not reach the JobTrail server. Is it still running?');
  }

  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

export const api = {
  state: () => request('GET', '/api/state'),

  createJob: (fields) => request('POST', '/api/jobs', fields),
  updateJob: (id, patch) => request('PATCH', `/api/jobs/${id}`, patch),
  deleteJob: (id) => request('DELETE', `/api/jobs/${id}`),
  extract: (text) => request('POST', '/api/jobs/extract', { text }),
  analyze: (id, cvId, language) => request('POST', `/api/jobs/${id}/analyze`, { cvId, language }),
  coverLetter: (id, cvId, options) => request('POST', `/api/jobs/${id}/cover-letter`, { cvId, options }),

  uploadCv: (form) => request('POST', '/api/cvs', form),
  getCv: (id) => request('GET', `/api/cvs/${id}`),
  updateCv: (id, patch) => request('PATCH', `/api/cvs/${id}`, patch),
  deleteCv: (id) => request('DELETE', `/api/cvs/${id}`),

  importBackup: (data) => request('POST', '/api/import', data)
};
