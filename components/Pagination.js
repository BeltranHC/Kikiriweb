export default function Pagination({ page, total, hasMore, loading, onPageChange }) {
  return (
    <nav className="pagination" aria-label="Paginación de estudiantes">
      <span>{total} estudiantes · Página {page}</span>
      <div className="pagination-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={loading || page === 1} onClick={() => onPageChange(page - 1)}>Anterior</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={loading || !hasMore} onClick={() => onPageChange(page + 1)}>Siguiente</button>
      </div>
    </nav>
  );
}
