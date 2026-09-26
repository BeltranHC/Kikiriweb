import Navbar from '@/components/Navbar';

export default function MovementsLayout({ children }) {
  return (
    <>
      <Navbar />
      <main style={{
        paddingTop: 'calc(var(--navbar-height) + var(--space-xl))',
        paddingBottom: 'var(--space-3xl)',
        paddingLeft: 'var(--space-lg)',
        paddingRight: 'var(--space-lg)',
        maxWidth: 'var(--max-content-width)',
        margin: '0 auto',
        minHeight: '100vh',
        position: 'relative',
        zIndex: 1,
      }}>
        {children}
      </main>
    </>
  );
}
