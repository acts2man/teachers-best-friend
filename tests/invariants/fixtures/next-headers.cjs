// Stand-in for next/headers: no cookies (so no "view as" session), no headers.
const jar = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };
module.exports = { cookies: async () => jar, headers: async () => new Map() };
