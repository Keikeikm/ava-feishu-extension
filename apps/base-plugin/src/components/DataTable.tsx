export function DataTable({
  rows,
  limit = 100,
}: {
  rows: Record<string, unknown>[];
  limit?: number;
}) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (!rows.length) return <div className="empty-table">当前范围没有记录</div>;
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="row-number">#</th>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row, i) => (
              <tr key={i}>
                <td className="row-number">{i + 1}</td>
                {columns.map((c) => (
                  <td key={c}>
                    {row[c] == null ? (
                      <span className="muted">—</span>
                    ) : typeof row[c] === 'object' ? (
                      JSON.stringify(row[c])
                    ) : (
                      String(row[c])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <p className="table-note">
          预览前 {limit} 条，共 {rows.length.toLocaleString()} 条。分析使用全部已加载记录。
        </p>
      )}
    </>
  );
}
