const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export async function syncRecord(record) {
  const res = await fetch(`${API_BASE_URL}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uuid: record.id,
      payload: JSON.stringify({ text: record.payload }),
    }),
  });

  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  return res.json();
}

export async function syncAllPending(getUnsyncedRecords, markSynced) {
  const pending = getUnsyncedRecords();
  const results = [];

  for (const record of pending) {
    try {
      const result = await syncRecord(record);
      markSynced(record.id);
      results.push({ id: record.id, ok: true, status: result.status });
    } catch (err) {
      results.push({ id: record.id, ok: false, error: err.message });
    }
  }

  return results;
}