/* Copyright (C) 2026 Darkmine Pty Ltd; SPDX-License-Identifier: GPL-3.0-or-later */
/** Track folder reading as well as parsing, and surface errors in the UI. */
export async function loadProject({ read, ingest, update, previousStatus = 'idle' }) {
  update({ status: 'loading', errors: {} });
  try {
    const result = await read();
    if (result == null) { update({ status: previousStatus }); return false; }
    await ingest(result);
    return true;
  } catch (error) {
    update({ status: 'error', errors: { load: error?.message || String(error) } });
    return false;
  }
}
