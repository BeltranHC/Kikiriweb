export async function fetchAll(makeQuery, pageSize = 500) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await makeQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
    // Advance by the actual response size, including when the server caps rows.
    offset += data.length;
  }
}
