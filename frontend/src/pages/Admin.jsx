import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const STATUS_LABEL = {
  pending: '⏳ pending',
  approved: '✓ approved',
  rejected: '✕ rejected',
};

export default function Admin() {
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    try {
      setUsers(await api.adminListUsers());
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => { load(); }, []);

  async function act(id, fn, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusyId(id);
    setErr(null);
    try {
      await fn(id);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (err && !users) return <div className="error">{err}</div>;
  if (!users) return <div className="muted"><span className="spinner" /> &nbsp; loading users</div>;

  const pending = users.filter(u => u.status === 'pending');

  return (
    <>
      <h1>Admin</h1>
      <p className="muted" style={{ marginBottom: '1.25rem' }}>
        {pending.length > 0
          ? `${pending.length} account${pending.length === 1 ? '' : 's'} awaiting approval.`
          : 'No accounts awaiting approval.'}
      </p>

      {err && <div className="error" style={{ marginBottom: '1rem' }}>{err}</div>}

      <div className="col" style={{ gap: '0.6rem' }}>
        {users.map(u => (
          <div key={u.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 600 }}>
                {u.username}
                {u.is_admin && <span className="tag" style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>admin</span>}
              </div>
              <div className="muted small" style={{ marginTop: '0.2rem' }}>
                {STATUS_LABEL[u.status] || u.status} · joined {u.created_at?.slice(0, 10)}
              </div>
            </div>

            {!u.is_admin && (
              <div className="row" style={{ gap: '0.4rem' }}>
                {u.status !== 'approved' && (
                  <button className="primary small" disabled={busyId === u.id}
                          onClick={() => act(u.id, api.adminApproveUser)}>
                    {busyId === u.id ? '…' : 'Approve'}
                  </button>
                )}
                {u.status !== 'rejected' && (
                  <button className="ghost small danger" disabled={busyId === u.id}
                          onClick={() => act(u.id, api.adminRejectUser, `Reject ${u.username}? They won't be able to sign in.`)}>
                    Reject
                  </button>
                )}
                <button className="ghost small danger" disabled={busyId === u.id}
                        onClick={() => act(u.id, api.adminDeleteUser, `Permanently delete ${u.username} and all their data? This cannot be undone.`)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
